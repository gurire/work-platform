/**
 * Views (phase 4): calendar, workload and the dashboard, plus intake forms and the triage list.
 */
import { randomUUID } from 'node:crypto'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import {
  categoryFor,
  decide,
  progressOf,
  type DoneOutcome,
  type StageType,
  type UserPrincipal,
} from '@wm/shared'
import type { Db, Queryable } from '../db/db.js'
import { notify } from '../inbox.js'
import { resolvePrincipal } from '../principal.js'
import { audit, iso } from './items.js'

interface Team {
  id: string
  key: string
  name: string
  is_private: boolean
  weekly_capacity: number
  estimate_unit: string
}

interface Question {
  key: string
  label: string
  type: 'short_text' | 'long_text' | 'date' | 'pick_one'
  required: boolean
  options?: string[]
}

const day = (v: string | Date | null) =>
  v === null ? null : typeof v === 'string' ? v.slice(0, 10) : v.toISOString().slice(0, 10)

export function registerViewRoutes(
  app: FastifyInstance,
  { db, devAuth }: { db: Db; devAuth: boolean },
): void {
  async function who(request: FastifyRequest, reply: FastifyReply): Promise<UserPrincipal | null> {
    const principal = await resolvePrincipal(db, request, devAuth)
    if (!principal) void reply.code(401).send({ error: 'unauthenticated' })
    return principal
  }
  async function visibleTeams(principal: UserPrincipal): Promise<Team[]> {
    const teams = await db.query<Team>(
      'SELECT id, key, name, is_private, weekly_capacity, estimate_unit FROM teams ORDER BY name',
    )
    return teams.filter(
      (t) =>
        decide(principal, 'item.view', { team: { id: t.id, isPrivate: t.is_private } }).allowed,
    )
  }
  const isTeamMember = (principal: UserPrincipal, teamId: string) =>
    principal.orgRole === 'org_admin' || teamId in principal.teams
  const isTeamAdmin = (principal: UserPrincipal, team: Team) =>
    decide(principal, 'team.config.edit', { team: { id: team.id, isPrivate: team.is_private } })
      .allowed

  /* ---------- Calendar ---------- */

  app.get<{ Querystring: { from: string; to: string; teamId?: string; projectId?: string } }>(
    '/core/calendar',
    {
      schema: {
        querystring: {
          type: 'object',
          required: ['from', 'to'],
          properties: {
            from: { type: 'string', format: 'date' },
            to: { type: 'string', format: 'date' },
            teamId: { type: 'string' },
            projectId: { type: 'string' },
          },
        },
      },
    },
    async (request, reply) => {
      const principal = await who(request, reply)
      if (!principal) return
      const { from, to, teamId, projectId } = request.query
      let teamIds = (await visibleTeams(principal)).map((t) => t.id)
      if (teamId) teamIds = teamIds.filter((t) => t === teamId)
      const items = await db.query<{
        id: string
        key: string
        title: string
        team_id: string
        due_on: string | Date
        stage_type: StageType
        assignee_id: string | null
        project_id: string | null
      }>(
        `SELECT w.id, w.key, w.title, w.team_id, w.due_on, s.stage_type, w.assignee_id, w.project_id
         FROM work_items w JOIN stages s ON s.team_id = w.team_id AND s.key = w.status_id
         WHERE w.deleted_at IS NULL AND w.due_on BETWEEN $1 AND $2 AND w.team_id = ANY($3)
           AND ($4::text IS NULL OR w.project_id = $4) ORDER BY w.due_on, w.seq LIMIT 1000`,
        [from, to, teamIds, projectId ?? null],
      )
      const milestones = await db.query<{
        id: string
        name: string
        due_on: string | Date
        project_id: string
        project_name: string
      }>(
        `SELECT m.id, m.name, m.due_on, m.project_id, p.name AS project_name FROM milestones m JOIN projects p ON p.id = m.project_id
         WHERE p.deleted_at IS NULL AND m.due_on BETWEEN $1 AND $2 AND ($3::text IS NULL OR m.project_id = $3) ORDER BY m.due_on`,
        [from, to, projectId ?? null],
      )
      return {
        items: items.map((i) => ({
          id: i.id,
          key: i.key,
          title: i.title,
          teamId: i.team_id,
          dueOn: day(i.due_on),
          stageType: i.stage_type,
          assigneeId: i.assignee_id,
          projectId: i.project_id,
        })),
        milestones: milestones.map((m) => ({
          id: m.id,
          name: m.name,
          dueOn: day(m.due_on),
          projectId: m.project_id,
          projectName: m.project_name,
        })),
      }
    },
  )

  /* ---------- Workload: open estimates per person per week, against capacity ---------- */

  app.get<{ Querystring: { teamId?: string; weeks?: number } }>(
    '/core/workload',
    {
      schema: {
        querystring: {
          type: 'object',
          properties: {
            teamId: { type: 'string' },
            weeks: { type: 'integer', minimum: 1, maximum: 12 },
          },
        },
      },
    },
    async (request, reply) => {
      const principal = await who(request, reply)
      if (!principal) return
      const weeks = request.query.weeks ?? 4
      let teams = await visibleTeams(principal)
      if (request.query.teamId) teams = teams.filter((t) => t.id === request.query.teamId)
      // Weeks start on Monday, in India time.
      const [start] = await db.query<{ monday: string | Date }>(
        "SELECT (date_trunc('week', (now() AT TIME ZONE 'Asia/Kolkata')))::date AS monday",
      )
      const monday = day(start?.monday ?? new Date()) as string
      const rows = await db.query<{
        assignee_id: string
        team_id: string
        week: number
        load: number
        items: number
      }>(
        `SELECT w.assignee_id, w.team_id,
           GREATEST(0, floor((w.due_on - $1::date) / 7))::int AS week,
           sum(COALESCE(w.estimate, 0))::int AS load, count(*)::int AS items
         FROM work_items w JOIN stages s ON s.team_id = w.team_id AND s.key = w.status_id
         WHERE w.deleted_at IS NULL AND w.assignee_id IS NOT NULL AND s.stage_type <> 'done'
           AND w.due_on IS NOT NULL AND w.due_on < $1::date + $2 * 7 AND w.team_id = ANY($3)
         GROUP BY 1, 2, 3`,
        [monday, weeks, teams.map((t) => t.id)],
      )
      const people = await db.query<{ id: string; name: string }>(
        'SELECT id, name FROM users ORDER BY name',
      )
      const members = await db.query<{ user_id: string; team_id: string }>(
        'SELECT user_id, team_id FROM team_members WHERE team_id = ANY($1)',
        [teams.map((t) => t.id)],
      )
      const ids = new Set([...members.map((m) => m.user_id), ...rows.map((r) => r.assignee_id)])
      return {
        weekStarts: Array.from({ length: weeks }, (_, i) => {
          const d = new Date(`${monday}T00:00:00Z`)
          d.setUTCDate(d.getUTCDate() + i * 7)
          return d.toISOString().slice(0, 10)
        }),
        people: people
          .filter((p) => ids.has(p.id))
          .map((p) => {
            const myTeams = teams.filter((t) =>
              members.some((m) => m.user_id === p.id && m.team_id === t.id),
            )
            const team = myTeams[0] ?? teams[0]
            return {
              id: p.id,
              name: p.name,
              teams: myTeams.map((t) => t.name),
              unit: team?.estimate_unit ?? 'hours',
              capacity: team?.weekly_capacity ?? 30,
              weeks: Array.from({ length: weeks }, (_, w) => {
                const mine = rows.filter((r) => r.assignee_id === p.id && r.week === w)
                return {
                  load: mine.reduce((a, r) => a + r.load, 0),
                  items: mine.reduce((a, r) => a + r.items, 0),
                }
              }),
            }
          }),
      }
    },
  )

  /* ---------- Dashboard ---------- */

  app.get<{ Querystring: { teamId?: string } }>('/core/dashboard', async (request, reply) => {
    const principal = await who(request, reply)
    if (!principal) return
    let teams = await visibleTeams(principal)
    if (request.query.teamId) teams = teams.filter((t) => t.id === request.query.teamId)
    const teamIds = teams.map((t) => t.id)
    const projects = await db.query<{ id: string; name: string; colour: number }>(
      'SELECT id, name, colour FROM projects WHERE deleted_at IS NULL AND archived_at IS NULL ORDER BY name',
    )
    const rows = await db.query<{
      project_id: string | null
      assignee_id: string | null
      stage_type: StageType
      done_outcome: DoneOutcome | null
    }>(
      `SELECT w.project_id, w.assignee_id, s.stage_type, s.done_outcome FROM work_items w
       JOIN stages s ON s.team_id = w.team_id AND s.key = w.status_id
       WHERE w.deleted_at IS NULL AND w.parent_id IS NULL AND w.team_id = ANY($1)`,
      [teamIds],
    )
    const doneThisWeek = await db.query<{ n: number }>(
      `SELECT count(DISTINCT h.item_id)::int AS n FROM stage_history h
       JOIN work_items w ON w.id = h.item_id JOIN stages s ON s.team_id = w.team_id AND s.key = h.stage_key
       WHERE s.stage_type = 'done' AND s.done_outcome = 'completed' AND h.entered_at > now() - interval '7 days' AND w.team_id = ANY($1)`,
      [teamIds],
    )
    const stuck = await db.query<{
      id: string
      key: string
      title: string
      team_id: string
      status_id: string
      assignee_id: string | null
      days: number
    }>(
      `SELECT w.id, w.key, w.title, w.team_id, w.status_id, w.assignee_id,
         floor(extract(epoch FROM now() - h.entered_at) / 86400)::int AS days
       FROM work_items w JOIN stage_history h ON h.item_id = w.id AND h.left_at IS NULL
       JOIN stages s ON s.team_id = w.team_id AND s.key = w.status_id
       WHERE w.deleted_at IS NULL AND s.stage_type <> 'done' AND h.entered_at < now() - interval '5 days' AND w.team_id = ANY($1)
       ORDER BY h.entered_at LIMIT 15`,
      [teamIds],
    )
    const people = await db.query<{ id: string; name: string }>(
      'SELECT id, name FROM users ORDER BY name',
    )
    const [stuckCount] = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM work_items w JOIN stage_history h ON h.item_id = w.id AND h.left_at IS NULL
       JOIN stages s ON s.team_id = w.team_id AND s.key = w.status_id
       WHERE w.deleted_at IS NULL AND s.stage_type <> 'done' AND h.entered_at < now() - interval '5 days' AND w.team_id = ANY($1)`,
      [teamIds],
    )
    const open = rows.filter((r) => r.stage_type !== 'done')
    return {
      tiles: {
        open: open.length,
        inReview: open.filter((r) => r.stage_type === 'review').length,
        doneThisWeek: doneThisWeek[0]?.n ?? 0,
        stuck: stuckCount?.n ?? 0,
      },
      projects: projects
        .map((p) => ({
          id: p.id,
          name: p.name,
          colour: p.colour,
          progress: progressOf(
            rows
              .filter((r) => r.project_id === p.id)
              .map((r) => ({ type: r.stage_type, outcome: r.done_outcome })),
          ),
        }))
        .filter((p) => p.progress.total > 0),
      people: people
        .map((p) => {
          const mine = open.filter((r) => r.assignee_id === p.id)
          return {
            id: p.id,
            name: p.name,
            waiting: mine.filter((r) => r.stage_type === 'waiting').length,
            doing: mine.filter((r) => r.stage_type === 'doing').length,
            review: mine.filter((r) => r.stage_type === 'review').length,
          }
        })
        .filter((p) => p.waiting + p.doing + p.review > 0)
        .sort((a, b) => b.waiting + b.doing + b.review - (a.waiting + a.doing + a.review)),
      stuck: stuck.map((s) => ({
        id: s.id,
        key: s.key,
        title: s.title,
        teamId: s.team_id,
        stageKey: s.status_id,
        assigneeId: s.assignee_id,
        days: s.days,
      })),
    }
  })

  /* ---------- Intake forms ---------- */

  interface FormRow {
    id: string
    team_id: string
    name: string
    intro: string | null
    questions: Question[]
    start_stage: string
  }
  const formOut = (f: FormRow, teams: Team[]) => ({
    id: f.id,
    teamId: f.team_id,
    teamName: teams.find((t) => t.id === f.team_id)?.name ?? f.team_id,
    name: f.name,
    intro: f.intro,
    questions: f.questions,
    startStage: f.start_stage,
  })

  app.get('/core/forms', async (request, reply) => {
    const principal = await who(request, reply)
    if (!principal) return
    const teams = await db.query<Team>(
      'SELECT id, key, name, is_private, weekly_capacity, estimate_unit FROM teams',
    )
    const forms = await db.query<FormRow>(
      'SELECT id, team_id, name, intro, questions, start_stage FROM intake_forms WHERE archived_at IS NULL ORDER BY name',
    )
    // Anyone can fill in any form (data model rule 28).
    return { forms: forms.map((f) => formOut(f, teams)) }
  })

  const questionSchema = {
    type: 'array',
    maxItems: 20,
    items: {
      type: 'object',
      additionalProperties: false,
      required: ['label', 'type'],
      properties: {
        key: { type: 'string', maxLength: 40 },
        label: { type: 'string', minLength: 1, maxLength: 120 },
        type: { type: 'string', enum: ['short_text', 'long_text', 'date', 'pick_one'] },
        required: { type: 'boolean' },
        options: {
          type: 'array',
          maxItems: 30,
          items: { type: 'string', minLength: 1, maxLength: 60 },
        },
      },
    },
  }

  app.post<{
    Params: { teamId: string }
    Body: { name: string; intro?: string; questions: Question[]; startStage: string }
  }>(
    '/core/teams/:teamId/forms',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['name', 'questions', 'startStage'],
          properties: {
            name: { type: 'string', minLength: 1, maxLength: 80 },
            intro: { type: 'string', maxLength: 1000 },
            questions: questionSchema,
            startStage: { type: 'string', maxLength: 64 },
          },
        },
      },
    },
    async (request, reply) => {
      const principal = await who(request, reply)
      if (!principal) return
      const [team] = await db.query<Team>(
        'SELECT id, key, name, is_private, weekly_capacity, estimate_unit FROM teams WHERE id = $1',
        [request.params.teamId],
      )
      if (!team) return reply.code(404).send({ error: 'not_found' })
      if (!isTeamAdmin(principal, team)) return reply.code(403).send({ error: 'forbidden' })
      const [stage] = await db.query('SELECT 1 FROM stages WHERE team_id = $1 AND key = $2', [
        team.id,
        request.body.startStage,
      ])
      if (!stage) return reply.code(400).send({ error: 'unknown_stage' })
      const questions = request.body.questions.map((q, i) => ({
        key: q.key ?? `q${i + 1}`,
        label: q.label.trim(),
        type: q.type,
        required: q.required === true,
        ...(q.type === 'pick_one' ? { options: q.options ?? [] } : {}),
      }))
      if (questions.some((q) => q.type === 'pick_one' && (q.options?.length ?? 0) === 0))
        return reply.code(400).send({ error: 'options_required' })
      const id = randomUUID()
      await db.query(
        'INSERT INTO intake_forms (id, team_id, name, intro, questions, start_stage, created_by) VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)',
        [
          id,
          team.id,
          request.body.name.trim(),
          request.body.intro?.trim() || null,
          JSON.stringify(questions),
          request.body.startStage,
          principal.id,
        ],
      )
      await audit(db, principal, 'team.form.add', team.id, id, { name: request.body.name })
      return reply.code(201).send({ id })
    },
  )

  app.post<{ Params: { id: string }; Body: { title: string; answers: Record<string, string> } }>(
    '/core/forms/:id/requests',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['title', 'answers'],
          properties: {
            title: { type: 'string', minLength: 1, maxLength: 200 },
            answers: {
              type: 'object',
              maxProperties: 20,
              additionalProperties: { type: 'string', maxLength: 5000 },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const principal = await who(request, reply)
      if (!principal) return
      const [form] = await db.query<FormRow>(
        'SELECT id, team_id, name, intro, questions, start_stage FROM intake_forms WHERE id = $1 AND archived_at IS NULL',
        [request.params.id],
      )
      if (!form) return reply.code(404).send({ error: 'not_found' })
      const answers = request.body.answers
      const missing = form.questions
        .filter((q) => q.required && !(answers[q.key] ?? '').trim())
        .map((q) => q.label)
      if (missing.length) return reply.code(400).send({ error: 'required_missing', missing })
      for (const q of form.questions) {
        const v = answers[q.key]
        if (v && q.type === 'pick_one' && !(q.options ?? []).includes(v))
          return reply.code(400).send({ error: 'invalid_value', field: q.label })
        if (v && q.type === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(v))
          return reply.code(400).send({ error: 'invalid_value', field: q.label })
      }
      const id = randomUUID()
      const clean = Object.fromEntries(
        form.questions
          .filter((q) => answers[q.key])
          .map((q) => [q.key, (answers[q.key] ?? '').trim()]),
      )
      await db.query(
        'INSERT INTO requests (id, form_id, requester_id, title, answers) VALUES ($1, $2, $3, $4, $5::jsonb)',
        [id, form.id, principal.id, request.body.title.trim(), JSON.stringify(clean)],
      )
      const admins = await db.query<{ user_id: string }>(
        "SELECT user_id FROM team_members WHERE team_id = $1 AND role = 'admin'",
        [form.team_id],
      )
      await notify(
        db,
        admins.map((a) => ({
          userId: a.user_id,
          kind: 'request_new' as const,
          itemId: null,
          requestId: id,
          actorId: principal.id,
        })),
      )
      return reply.code(201).send({ id })
    },
  )

  interface RequestRow {
    id: string
    form_id: string
    form_name: string
    team_id: string
    requester_id: string
    title: string
    answers: Record<string, string>
    status: 'new' | 'needs_info' | 'accepted' | 'declined'
    note: string | null
    item_id: string | null
    item_key: string | null
    created_at: string | Date
    updated_at: string | Date
    questions: Question[]
  }
  const REQUEST_SELECT = `SELECT r.id, r.form_id, f.name AS form_name, f.team_id, r.requester_id, r.title, r.answers, r.status, r.note,
      r.item_id, w.key AS item_key, r.created_at, r.updated_at, f.questions
    FROM requests r JOIN intake_forms f ON f.id = r.form_id LEFT JOIN work_items w ON w.id = r.item_id`
  const requestOut = (r: RequestRow) => ({
    id: r.id,
    formId: r.form_id,
    formName: r.form_name,
    teamId: r.team_id,
    requesterId: r.requester_id,
    title: r.title,
    answers: r.questions
      .filter((q) => r.answers[q.key])
      .map((q) => ({ label: q.label, value: r.answers[q.key] })),
    status: r.status,
    note: r.note,
    itemKey: r.item_key,
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  })

  app.get<{ Params: { teamId: string } }>(
    '/core/teams/:teamId/requests',
    async (request, reply) => {
      const principal = await who(request, reply)
      if (!principal) return
      if (!isTeamMember(principal, request.params.teamId))
        return reply.code(403).send({ error: 'forbidden' })
      const rows = await db.query<RequestRow>(
        `${REQUEST_SELECT} WHERE f.team_id = $1 ORDER BY (r.status IN ('new', 'needs_info')) DESC, r.created_at DESC LIMIT 200`,
        [request.params.teamId],
      )
      return { requests: rows.map(requestOut) }
    },
  )

  app.get('/core/me/requests', async (request, reply) => {
    const principal = await who(request, reply)
    if (!principal) return
    const rows = await db.query<RequestRow>(
      `${REQUEST_SELECT} WHERE r.requester_id = $1 ORDER BY r.created_at DESC LIMIT 100`,
      [principal.id],
    )
    return { requests: rows.map(requestOut) }
  })

  async function triage(
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply,
  ): Promise<{ principal: UserPrincipal; row: RequestRow } | null> {
    const principal = await who(request, reply)
    if (!principal) return null
    const [row] = await db.query<RequestRow>(`${REQUEST_SELECT} WHERE r.id = $1`, [
      request.params.id,
    ])
    if (!row) {
      void reply.code(404).send({ error: 'not_found' })
      return null
    }
    if (!isTeamMember(principal, row.team_id)) {
      void reply.code(403).send({ error: 'forbidden' })
      return null
    }
    if (row.status === 'accepted' || row.status === 'declined') {
      void reply.code(409).send({ error: 'already_decided' })
      return null
    }
    return { principal, row }
  }

  app.post<{
    Params: { id: string }
    Body: { projectId?: string | null; ownerId?: string | null }
  }>(
    '/core/requests/:id/accept',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          properties: {
            projectId: { type: ['string', 'null'] },
            ownerId: { type: ['string', 'null'] },
          },
        },
      },
    },
    async (request, reply) => {
      const ok = await triage(request, reply)
      if (!ok) return
      const { principal, row } = ok
      const [form] = await db.query<{ start_stage: string }>(
        'SELECT start_stage FROM intake_forms WHERE id = $1',
        [row.form_id],
      )
      const [stage] = await db.query<{ stage_type: StageType; done_outcome: DoneOutcome | null }>(
        'SELECT stage_type, done_outcome FROM stages WHERE team_id = $1 AND key = $2',
        [row.team_id, form?.start_stage ?? ''],
      )
      if (!form || !stage) return reply.code(400).send({ error: 'unknown_stage' })
      const description = [
        ...row.questions
          .filter((q) => row.answers[q.key])
          .map((q) => `${q.label}: ${row.answers[q.key]}`),
        '',
        `From a request on the “${row.form_name}” form.`,
      ].join('\n')
      const itemId = randomUUID()
      const projectId = request.body?.projectId ?? null
      const key = await db.transaction(async (tx: Queryable) => {
        const [seq] = await tx.query<{ item_seq: number; key: string }>(
          `UPDATE teams SET item_seq = GREATEST(item_seq,
             (SELECT COALESCE(max(substring(key FROM '[0-9]+$')::int), 0) FROM work_items WHERE team_id = $1)) + 1
           WHERE id = $1 RETURNING item_seq, key`,
          [row.team_id],
        )
        const itemKey = `${seq?.key}-${seq?.item_seq}`
        await tx.query(
          `INSERT INTO work_items (id, key, kind, title, status_id, status_category, team_id, assignee_id, created_by, project_id, description, fields)
           VALUES ($1, $2, 'task', $3, $4, $5, $6, $7, $8, $9, $10, '{"priority": 0}'::jsonb)`,
          [
            itemId,
            itemKey,
            row.title,
            form.start_stage,
            categoryFor(stage.stage_type, stage.done_outcome),
            row.team_id,
            request.body?.ownerId ?? null,
            principal.id,
            projectId,
            description,
          ],
        )
        await tx.query(
          'INSERT INTO stage_history (item_id, stage_key, owner_id, moved_by) VALUES ($1, $2, $3, $4)',
          [itemId, form.start_stage, request.body?.ownerId ?? null, principal.id],
        )
        await tx.query(
          "UPDATE requests SET status = 'accepted', item_id = $2, decided_by = $3, updated_at = now() WHERE id = $1",
          [row.id, itemId, principal.id],
        )
        return itemKey
      })
      await notify(db, [
        {
          userId: row.requester_id,
          kind: 'request_update',
          itemId,
          requestId: row.id,
          actorId: principal.id,
        },
      ])
      await audit(db, principal, 'request.accept', row.team_id, row.id, { itemKey: key })
      return { itemKey: key }
    },
  )

  for (const [path, status] of [
    ['ask', 'needs_info'],
    ['decline', 'declined'],
  ] as const) {
    app.post<{ Params: { id: string }; Body: { note: string } }>(
      `/core/requests/:id/${path}`,
      {
        schema: {
          body: {
            type: 'object',
            additionalProperties: false,
            required: ['note'],
            properties: { note: { type: 'string', minLength: 1, maxLength: 2000 } },
          },
        },
      },
      async (request, reply) => {
        const ok = await triage(request, reply)
        if (!ok) return
        await db.query(
          'UPDATE requests SET status = $2, note = $3, decided_by = $4, updated_at = now() WHERE id = $1',
          [ok.row.id, status, request.body.note.trim(), ok.principal.id],
        )
        await notify(db, [
          {
            userId: ok.row.requester_id,
            kind: 'request_update',
            itemId: null,
            requestId: ok.row.id,
            actorId: ok.principal.id,
          },
        ])
        return { status }
      },
    )
  }
}
