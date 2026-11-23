/**
 * Core model routes of the restart (specs/data-model.md): projects, milestones, quick add,
 * planning fields, stage types and allowed moves, and team fields. Moving an item between
 * stages still goes through PATCH /items/:id, which applies the workflow and review rules.
 */
import { randomUUID } from 'node:crypto'
import type { FastifyInstance, FastifyReply } from 'fastify'
import {
  categoryFor,
  checkSubItem,
  decide,
  fieldKeyFrom,
  isProjectColour,
  milestoneFits,
  missingStageTypes,
  MODEL_LIMITS,
  priorityName,
  progressOf,
  type DoneOutcome,
  type FieldType,
  type StageType,
  type UserPrincipal,
} from '@wm/shared'
import type { Db, Queryable } from '../db/db.js'
import { resolvePrincipal } from '../principal.js'
import { audit, iso } from './items.js'

interface TeamRow {
  id: string
  key: string
  name: string
  is_private: boolean
  estimate_unit: 'hours' | 'points'
  weekly_capacity: number
}

interface CoreItemRow {
  id: string
  key: string
  title: string
  team_id: string
  status_id: string
  stage_type: StageType
  done_outcome: DoneOutcome | null
  assignee_id: string | null
  fields: Record<string, unknown>
  due_on: string | Date | null
  estimate: number | null
  labels: string[]
  project_id: string | null
  milestone_id: string | null
  parent_id: string | null
  updated_at: string | Date
  sub_total: number
  sub_done: number
}

const ITEM_SELECT = `
  SELECT w.id, w.key, w.title, w.team_id, w.status_id, s.stage_type, s.done_outcome, w.assignee_id,
         w.fields, w.due_on, w.estimate, w.labels, w.project_id, w.milestone_id, w.parent_id,
         w.updated_at,
         (SELECT count(*)::int FROM work_items c WHERE c.parent_id = w.id AND c.deleted_at IS NULL) AS sub_total,
         (SELECT count(*)::int FROM work_items c JOIN stages cs ON cs.team_id = c.team_id AND cs.key = c.status_id
           WHERE c.parent_id = w.id AND c.deleted_at IS NULL AND cs.stage_type = 'done') AS sub_done
  FROM work_items w JOIN stages s ON s.team_id = w.team_id AND s.key = w.status_id`

const day = (value: string | Date | null): string | null =>
  value === null
    ? null
    : typeof value === 'string'
      ? value.slice(0, 10)
      : value.toISOString().slice(0, 10)

function toCoreItem(row: CoreItemRow) {
  return {
    id: row.id,
    key: row.key,
    title: row.title,
    teamId: row.team_id,
    stageKey: row.status_id,
    stageType: row.stage_type,
    doneOutcome: row.done_outcome,
    assigneeId: row.assignee_id,
    priority: priorityName(row.fields['priority']),
    dueOn: day(row.due_on),
    estimate: row.estimate,
    labels: row.labels,
    projectId: row.project_id,
    milestoneId: row.milestone_id,
    parentId: row.parent_id,
    subItems: { total: row.sub_total, done: row.sub_done },
    fields: row.fields,
    updatedAt: iso(row.updated_at),
  }
}

export function registerCoreRoutes(
  app: FastifyInstance,
  { db, devAuth }: { db: Db; devAuth: boolean },
): void {
  async function principalOr401(
    request: Parameters<typeof resolvePrincipal>[1],
    reply: FastifyReply,
  ) {
    const principal = await resolvePrincipal(db, request, devAuth)
    if (!principal) void reply.code(401).send({ error: 'unauthenticated' })
    return principal
  }

  async function teams(): Promise<TeamRow[]> {
    return db.query<TeamRow>(
      'SELECT id, key, name, is_private, estimate_unit, weekly_capacity FROM teams ORDER BY name',
    )
  }

  function canSee(principal: UserPrincipal, team: Pick<TeamRow, 'id' | 'is_private'>): boolean {
    return decide(principal, 'item.view', { team: { id: team.id, isPrivate: team.is_private } })
      .allowed
  }

  function can(
    principal: UserPrincipal,
    action: Parameters<typeof decide>[1],
    team: Pick<TeamRow, 'id' | 'is_private'>,
  ) {
    return decide(principal, action, { team: { id: team.id, isPrivate: team.is_private } }).allowed
  }

  async function visibleTeamIds(principal: UserPrincipal): Promise<string[]> {
    return (await teams()).filter((t) => canSee(principal, t)).map((t) => t.id)
  }

  async function loadTeam(principal: UserPrincipal, teamId: string): Promise<TeamRow | null> {
    const team = (await teams()).find((t) => t.id === teamId)
    return team && canSee(principal, team) ? team : null
  }

  async function itemsWhere(
    where: string,
    params: unknown[],
  ): Promise<ReturnType<typeof toCoreItem>[]> {
    const rows = await db.query<CoreItemRow>(
      `${ITEM_SELECT} WHERE w.deleted_at IS NULL AND ${where} ORDER BY w.seq`,
      params,
    )
    return rows.map(toCoreItem)
  }

  async function projectProgress(projectId: string, teamIds: string[]) {
    const rows = await db.query<{ stage_type: StageType; done_outcome: DoneOutcome | null }>(
      `SELECT s.stage_type, s.done_outcome FROM work_items w
       JOIN stages s ON s.team_id = w.team_id AND s.key = w.status_id
       WHERE w.project_id = $1 AND w.deleted_at IS NULL AND w.parent_id IS NULL AND w.team_id = ANY($2)`,
      [projectId, teamIds],
    )
    return progressOf(rows.map((r) => ({ type: r.stage_type, outcome: r.done_outcome })))
  }

  /* ---------- Teams, stages and allowed moves ---------- */

  app.get('/core/teams', async (request, reply) => {
    const principal = await principalOr401(request, reply)
    if (!principal) return
    const visible = (await teams()).filter((t) => canSee(principal, t))
    const stages = await db.query<{
      team_id: string
      key: string
      name: string
      position: number
      stage_type: StageType
      done_outcome: DoneOutcome | null
      item_limit: number | null
      target_hours: number | null
      review_send_back_to: string | null
    }>(
      'SELECT team_id, key, name, position, stage_type, done_outcome, item_limit, target_hours, review_send_back_to FROM stages ORDER BY team_id, position',
    )
    const transitions = await db.query<{ team_id: string; from_key: string; to_key: string }>(
      'SELECT team_id, from_key, to_key FROM stage_transitions',
    )
    const members = await db.query<{ team_id: string; user_id: string; role: string }>(
      'SELECT team_id, user_id, role FROM team_members',
    )
    return {
      teams: visible.map((t) => ({
        id: t.id,
        key: t.key,
        name: t.name,
        estimateUnit: t.estimate_unit,
        weeklyCapacity: t.weekly_capacity,
        canConfigure: can(principal, 'team.config.edit', t),
        canCreate: can(principal, 'item.create', t),
        members: members
          .filter((m) => m.team_id === t.id)
          .map((m) => ({ userId: m.user_id, role: m.role })),
        stages: stages
          .filter((s) => s.team_id === t.id)
          .map((s) => ({
            key: s.key,
            name: s.name,
            position: s.position,
            type: s.stage_type,
            doneOutcome: s.done_outcome,
            itemLimit: s.item_limit,
            targetHours: s.target_hours,
            sendBackTo: s.review_send_back_to,
          })),
        transitions: transitions
          .filter((x) => x.team_id === t.id)
          .map((x) => ({ from: x.from_key, to: x.to_key })),
      })),
    }
  })

  app.get<{ Params: { teamId: string } }>('/core/teams/:teamId/items', async (request, reply) => {
    const principal = await principalOr401(request, reply)
    if (!principal) return
    const team = await loadTeam(principal, request.params.teamId)
    if (!team) return reply.code(404).send({ error: 'not_found' })
    return { items: await itemsWhere('w.team_id = $1', [team.id]) }
  })

  async function configTeam(
    principal: UserPrincipal,
    teamId: string,
    reply: FastifyReply,
  ): Promise<TeamRow | null> {
    const team = await loadTeam(principal, teamId)
    if (!team) {
      void reply.code(404).send({ error: 'not_found' })
      return null
    }
    if (!can(principal, 'team.config.edit', team)) {
      void reply.code(403).send({ error: 'forbidden' })
      return null
    }
    return team
  }

  app.post<{
    Params: { teamId: string }
    Body: { name: string; type: StageType; doneOutcome?: DoneOutcome }
  }>(
    '/core/teams/:teamId/stages',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['name', 'type'],
          properties: {
            name: { type: 'string', minLength: 1, maxLength: 60 },
            type: { type: 'string', enum: ['waiting', 'doing', 'review', 'done'] },
            doneOutcome: { type: 'string', enum: ['completed', 'cancelled'] },
          },
        },
      },
    },
    async (request, reply) => {
      const principal = await principalOr401(request, reply)
      if (!principal) return
      const team = await configTeam(principal, request.params.teamId, reply)
      if (!team) return
      const existing = await db.query<{ key: string; position: number }>(
        'SELECT key, position FROM stages WHERE team_id = $1',
        [team.id],
      )
      if (existing.length >= MODEL_LIMITS.stagesPerTeam)
        return reply.code(400).send({ error: 'too_many_stages' })
      const { name, type } = request.body
      const outcome = type === 'done' ? (request.body.doneOutcome ?? 'completed') : null
      let key = fieldKeyFrom(name)
      for (let n = 2; existing.some((s) => s.key === key); n++) key = `${fieldKeyFrom(name)}_${n}`
      const position = Math.max(0, ...existing.map((s) => s.position)) + 1
      await db.query(
        'INSERT INTO stages (team_id, key, name, category, position, stage_type, done_outcome) VALUES ($1, $2, $3, $4, $5, $6, $7)',
        [team.id, key, name.trim(), categoryFor(type, outcome), position, type, outcome],
      )
      await audit(db, principal, 'team.stage.add', team.id, key, { name, type })
      return reply.code(201).send({ key })
    },
  )

  app.patch<{
    Params: { teamId: string; key: string }
    Body: { name?: string; type?: StageType; doneOutcome?: DoneOutcome }
  }>(
    '/core/teams/:teamId/stages/:key',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          minProperties: 1,
          properties: {
            name: { type: 'string', minLength: 1, maxLength: 60 },
            type: { type: 'string', enum: ['waiting', 'doing', 'review', 'done'] },
            doneOutcome: { type: 'string', enum: ['completed', 'cancelled'] },
          },
        },
      },
    },
    async (request, reply) => {
      const principal = await principalOr401(request, reply)
      if (!principal) return
      const team = await configTeam(principal, request.params.teamId, reply)
      if (!team) return
      const stages = await db.query<{
        key: string
        stage_type: StageType
        done_outcome: DoneOutcome | null
      }>('SELECT key, stage_type, done_outcome FROM stages WHERE team_id = $1', [team.id])
      const stage = stages.find((s) => s.key === request.params.key)
      if (!stage) return reply.code(404).send({ error: 'not_found' })
      const { name, type, doneOutcome } = request.body
      const nextType = type ?? stage.stage_type
      const nextOutcome =
        nextType === 'done' ? (doneOutcome ?? stage.done_outcome ?? 'completed') : null
      const typeChanges = nextType !== stage.stage_type || nextOutcome !== stage.done_outcome
      if (typeChanges) {
        // Rule 13: a stage's type changes only while it is empty.
        const used = await db.query(
          'SELECT 1 FROM work_items WHERE team_id = $1 AND status_id = $2 AND deleted_at IS NULL LIMIT 1',
          [team.id, stage.key],
        )
        if (used.length > 0) return reply.code(409).send({ error: 'stage_not_empty' })
        const after = stages.map((s) => (s.key === stage.key ? nextType : s.stage_type))
        const missing = missingStageTypes(after)
        if (missing.length > 0)
          return reply.code(409).send({ error: 'stage_types_missing', missing })
      }
      await db.query(
        'UPDATE stages SET name = COALESCE($3, name), stage_type = $4, done_outcome = $5, category = $6 WHERE team_id = $1 AND key = $2',
        [
          team.id,
          stage.key,
          name?.trim() ?? null,
          nextType,
          nextOutcome,
          categoryFor(nextType, nextOutcome),
        ],
      )
      await audit(db, principal, 'team.stage.edit', team.id, stage.key, request.body)
      return { key: stage.key, name: name ?? null, type: nextType, doneOutcome: nextOutcome }
    },
  )

  app.put<{ Params: { teamId: string }; Body: { transitions: { from: string; to: string }[] } }>(
    '/core/teams/:teamId/transitions',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['transitions'],
          properties: {
            transitions: {
              type: 'array',
              maxItems: 900,
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['from', 'to'],
                properties: {
                  from: { type: 'string', maxLength: 64 },
                  to: { type: 'string', maxLength: 64 },
                },
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const principal = await principalOr401(request, reply)
      if (!principal) return
      const team = await configTeam(principal, request.params.teamId, reply)
      if (!team) return
      const keys = new Set(
        (
          await db.query<{ key: string }>('SELECT key FROM stages WHERE team_id = $1', [team.id])
        ).map((s) => s.key),
      )
      const list = request.body.transitions
      if (list.some((t) => !keys.has(t.from) || !keys.has(t.to) || t.from === t.to)) {
        return reply.code(400).send({ error: 'unknown_stage' })
      }
      await db.transaction(async (tx: Queryable) => {
        await tx.query('DELETE FROM stage_transitions WHERE team_id = $1', [team.id])
        for (const t of list) {
          await tx.query(
            'INSERT INTO stage_transitions (team_id, from_key, to_key) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
            [team.id, t.from, t.to],
          )
        }
      })
      await audit(db, principal, 'team.transitions.set', team.id, null, { count: list.length })
      return { transitions: list }
    },
  )

  /* ---------- Fields ---------- */

  interface FieldRow {
    id: string
    team_id: string | null
    key: string
    label: string
    type: FieldType
    options: string[]
    position: number
    enabled: boolean | null
  }

  async function teamFields(teamId: string): Promise<FieldRow[]> {
    return db.query<FieldRow>(
      `SELECT f.id, f.team_id, f.key, f.label, f.type, f.options, f.position, s.enabled
       FROM field_defs f LEFT JOIN team_field_settings s ON s.field_id = f.id AND s.team_id = $1
       WHERE f.team_id IS NULL OR f.team_id = $1 ORDER BY f.team_id NULLS FIRST, f.position, f.label`,
      [teamId],
    )
  }

  const fieldOut = (f: FieldRow) => ({
    id: f.id,
    key: f.key,
    label: f.label,
    type: f.type,
    options: f.options,
    scope: f.team_id === null ? 'library' : 'team',
    // Team fields are on unless turned off; library fields are off unless turned on.
    enabled: f.enabled ?? f.team_id !== null,
  })

  app.get<{ Params: { teamId: string } }>('/core/teams/:teamId/fields', async (request, reply) => {
    const principal = await principalOr401(request, reply)
    if (!principal) return
    const team = await loadTeam(principal, request.params.teamId)
    if (!team) return reply.code(404).send({ error: 'not_found' })
    return { fields: (await teamFields(team.id)).map(fieldOut) }
  })

  app.put<{ Params: { teamId: string; fieldId: string }; Body: { enabled: boolean } }>(
    '/core/teams/:teamId/fields/:fieldId',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['enabled'],
          properties: { enabled: { type: 'boolean' } },
        },
      },
    },
    async (request, reply) => {
      const principal = await principalOr401(request, reply)
      if (!principal) return
      const team = await configTeam(principal, request.params.teamId, reply)
      if (!team) return
      const field = (await teamFields(team.id)).find((f) => f.id === request.params.fieldId)
      if (!field) return reply.code(404).send({ error: 'not_found' })
      // Rule 18: turning a field off hides it; its values stay in the items.
      await db.query(
        `INSERT INTO team_field_settings (team_id, field_id, enabled) VALUES ($1, $2, $3)
         ON CONFLICT (team_id, field_id) DO UPDATE SET enabled = EXCLUDED.enabled`,
        [team.id, field.id, request.body.enabled],
      )
      return { id: field.id, enabled: request.body.enabled }
    },
  )

  app.post<{
    Params: { teamId: string }
    Body: { label: string; type: FieldType; options?: string[] }
  }>(
    '/core/teams/:teamId/fields',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['label', 'type'],
          properties: {
            label: { type: 'string', minLength: 1, maxLength: 60 },
            type: {
              type: 'string',
              enum: [
                'short_text',
                'long_text',
                'number',
                'date',
                'pick_one',
                'pick_many',
                'person',
                'link',
              ],
            },
            options: {
              type: 'array',
              maxItems: 100,
              items: { type: 'string', minLength: 1, maxLength: 60 },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const principal = await principalOr401(request, reply)
      if (!principal) return
      const team = await configTeam(principal, request.params.teamId, reply)
      if (!team) return
      const fields = await teamFields(team.id)
      if (fields.filter((f) => f.team_id !== null).length >= MODEL_LIMITS.teamFields) {
        return reply.code(400).send({ error: 'too_many_fields' })
      }
      const { label, type } = request.body
      const options =
        type === 'pick_one' || type === 'pick_many' ? [...new Set(request.body.options ?? [])] : []
      if ((type === 'pick_one' || type === 'pick_many') && options.length === 0) {
        return reply.code(400).send({ error: 'options_required' })
      }
      const key = fieldKeyFrom(label)
      if (fields.some((f) => f.key === key) || key === 'priority')
        return reply.code(409).send({ error: 'field_exists' })
      const id = randomUUID()
      await db.query(
        'INSERT INTO field_defs (id, team_id, key, label, type, options, position) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)',
        [id, team.id, key, label.trim(), type, JSON.stringify(options), fields.length + 1],
      )
      await audit(db, principal, 'team.field.add', team.id, id, { label, type })
      return reply.code(201).send({ id, key })
    },
  )

  /* ---------- Projects and milestones ---------- */

  interface ProjectRow {
    id: string
    name: string
    colour: number
    owner_id: string
    starts_on: string | Date | null
    ends_on: string | Date | null
    archived_at: string | Date | null
  }

  const projectOut = (p: ProjectRow) => ({
    id: p.id,
    name: p.name,
    colour: p.colour,
    ownerId: p.owner_id,
    startsOn: day(p.starts_on),
    endsOn: day(p.ends_on),
    archived: p.archived_at !== null,
  })

  async function loadProject(id: string): Promise<ProjectRow | null> {
    const rows = await db.query<ProjectRow>(
      'SELECT id, name, colour, owner_id, starts_on, ends_on, archived_at FROM projects WHERE id = $1 AND deleted_at IS NULL',
      [id],
    )
    return rows[0] ?? null
  }

  const canEditProject = (principal: UserPrincipal, p: ProjectRow) =>
    principal.orgRole === 'org_admin' || p.owner_id === principal.id

  app.get('/core/projects', async (request, reply) => {
    const principal = await principalOr401(request, reply)
    if (!principal) return
    const rows = await db.query<ProjectRow>(
      'SELECT id, name, colour, owner_id, starts_on, ends_on, archived_at FROM projects WHERE deleted_at IS NULL ORDER BY archived_at NULLS FIRST, name',
    )
    const teamIds = await visibleTeamIds(principal)
    return {
      projects: await Promise.all(
        rows.map(async (p) => ({
          ...projectOut(p),
          progress: await projectProgress(p.id, teamIds),
        })),
      ),
    }
  })

  app.post<{
    Body: { name: string; colour: number; startsOn?: string | null; endsOn?: string | null }
  }>(
    '/core/projects',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['name', 'colour'],
          properties: {
            name: { type: 'string', minLength: 1, maxLength: 120 },
            colour: { type: 'integer' },
            startsOn: { type: ['string', 'null'], format: 'date' },
            endsOn: { type: ['string', 'null'], format: 'date' },
          },
        },
      },
    },
    async (request, reply) => {
      const principal = await principalOr401(request, reply)
      if (!principal) return
      // Rule 5: any member may create a project; viewers may not.
      if (principal.orgRole === 'viewer') return reply.code(403).send({ error: 'forbidden' })
      const { name, colour, startsOn = null, endsOn = null } = request.body
      if (!isProjectColour(colour)) return reply.code(400).send({ error: 'bad_colour' })
      if (startsOn && endsOn && endsOn < startsOn)
        return reply.code(400).send({ error: 'ends_before_start' })
      const id = randomUUID()
      await db.query(
        'INSERT INTO projects (id, name, colour, owner_id, starts_on, ends_on) VALUES ($1, $2, $3, $4, $5, $6)',
        [id, name.trim(), colour, principal.id, startsOn, endsOn],
      )
      await audit(db, principal, 'project.create', null, id, { name })
      return reply.code(201).send({ project: projectOut((await loadProject(id)) as ProjectRow) })
    },
  )

  app.get<{ Params: { id: string } }>('/core/projects/:id', async (request, reply) => {
    const principal = await principalOr401(request, reply)
    if (!principal) return
    const project = await loadProject(request.params.id)
    if (!project) return reply.code(404).send({ error: 'not_found' })
    const teamIds = await visibleTeamIds(principal)
    const milestones = await db.query<{
      id: string
      name: string
      due_on: string | Date | null
      position: number
      done_on: string | Date | null
    }>(
      'SELECT id, name, due_on, position, done_on FROM milestones WHERE project_id = $1 ORDER BY position, due_on NULLS LAST',
      [project.id],
    )
    const items = await itemsWhere('w.project_id = $1 AND w.team_id = ANY($2)', [
      project.id,
      teamIds,
    ])
    return {
      project: { ...projectOut(project), canEdit: canEditProject(principal, project) },
      progress: await projectProgress(project.id, teamIds),
      milestones: milestones.map((m) => {
        const mine = items.filter((i) => i.milestoneId === m.id && i.parentId === null)
        return {
          id: m.id,
          name: m.name,
          dueOn: day(m.due_on),
          doneOn: day(m.done_on),
          left: mine.filter((i) => i.stageType !== 'done').length,
          total: mine.length,
        }
      }),
      items,
    }
  })

  app.patch<{
    Params: { id: string }
    Body: {
      name?: string
      colour?: number
      startsOn?: string | null
      endsOn?: string | null
      archived?: boolean
    }
  }>(
    '/core/projects/:id',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          minProperties: 1,
          properties: {
            name: { type: 'string', minLength: 1, maxLength: 120 },
            colour: { type: 'integer' },
            startsOn: { type: ['string', 'null'], format: 'date' },
            endsOn: { type: ['string', 'null'], format: 'date' },
            archived: { type: 'boolean' },
          },
        },
      },
    },
    async (request, reply) => {
      const principal = await principalOr401(request, reply)
      if (!principal) return
      const project = await loadProject(request.params.id)
      if (!project) return reply.code(404).send({ error: 'not_found' })
      if (!canEditProject(principal, project)) return reply.code(403).send({ error: 'forbidden' })
      const { name, colour, startsOn, endsOn, archived } = request.body
      if (colour !== undefined && !isProjectColour(colour))
        return reply.code(400).send({ error: 'bad_colour' })
      await db.query(
        `UPDATE projects SET name = COALESCE($2, name), colour = COALESCE($3, colour),
           starts_on = CASE WHEN $4::boolean THEN $5::date ELSE starts_on END,
           ends_on = CASE WHEN $6::boolean THEN $7::date ELSE ends_on END,
           archived_at = CASE WHEN $8::boolean IS NULL THEN archived_at WHEN $8 THEN COALESCE(archived_at, now()) ELSE NULL END,
           updated_at = now()
         WHERE id = $1`,
        [
          project.id,
          name?.trim() ?? null,
          colour ?? null,
          startsOn !== undefined,
          startsOn ?? null,
          endsOn !== undefined,
          endsOn ?? null,
          archived ?? null,
        ],
      )
      await audit(db, principal, 'project.edit', null, project.id, request.body)
      return { project: projectOut((await loadProject(project.id)) as ProjectRow) }
    },
  )

  app.post<{ Params: { id: string }; Body: { name: string; dueOn?: string | null } }>(
    '/core/projects/:id/milestones',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['name'],
          properties: {
            name: { type: 'string', minLength: 1, maxLength: 120 },
            dueOn: { type: ['string', 'null'], format: 'date' },
          },
        },
      },
    },
    async (request, reply) => {
      const principal = await principalOr401(request, reply)
      if (!principal) return
      const project = await loadProject(request.params.id)
      if (!project) return reply.code(404).send({ error: 'not_found' })
      if (!canEditProject(principal, project)) return reply.code(403).send({ error: 'forbidden' })
      const id = randomUUID()
      const [pos] = await db.query<{ n: number }>(
        'SELECT count(*)::int AS n FROM milestones WHERE project_id = $1',
        [project.id],
      )
      await db.query(
        'INSERT INTO milestones (id, project_id, name, due_on, position) VALUES ($1, $2, $3, $4, $5)',
        [id, project.id, request.body.name.trim(), request.body.dueOn ?? null, (pos?.n ?? 0) + 1],
      )
      return reply.code(201).send({ id })
    },
  )

  /* ---------- Items: quick add and planning ---------- */

  app.post<{
    Body: {
      teamId: string
      title: string
      stageKey?: string
      projectId?: string | null
      milestoneId?: string | null
      parentId?: string | null
    }
  }>(
    '/core/items',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['teamId', 'title'],
          properties: {
            teamId: { type: 'string', maxLength: 64 },
            title: { type: 'string', minLength: 1, maxLength: MODEL_LIMITS.titleLength },
            stageKey: { type: 'string', maxLength: 64 },
            projectId: { type: ['string', 'null'], maxLength: 64 },
            milestoneId: { type: ['string', 'null'], maxLength: 64 },
            parentId: { type: ['string', 'null'], maxLength: 64 },
          },
        },
      },
    },
    async (request, reply) => {
      const principal = await principalOr401(request, reply)
      if (!principal) return
      const team = await loadTeam(principal, request.body.teamId)
      if (!team) return reply.code(404).send({ error: 'not_found' })
      if (!can(principal, 'item.create', team)) return reply.code(403).send({ error: 'forbidden' })
      let projectId = request.body.projectId ?? null
      const milestoneId = request.body.milestoneId ?? null
      const parentId = request.body.parentId ?? null
      const title = request.body.title.trim()
      if (!title) return reply.code(400).send({ error: 'title_required' })

      let parentRowId: string | null = null
      if (parentId) {
        const [parent] = await db.query<{
          id: string
          team_id: string
          project_id: string | null
          parent_id: string | null
        }>(
          'SELECT id, team_id, project_id, parent_id FROM work_items WHERE (id = $1 OR key = $1) AND deleted_at IS NULL',
          [parentId],
        )
        if (!parent) return reply.code(400).send({ error: 'unknown_parent' })
        parentRowId = parent.id
        // A sub-item always follows its parent's project.
        projectId = parent.project_id
        const error = checkSubItem(
          { id: '', teamId: team.id, projectId },
          {
            id: parent.id,
            teamId: parent.team_id,
            projectId: parent.project_id,
            parentId: parent.parent_id,
          },
        )
        if (error) return reply.code(400).send({ error })
      }
      if (projectId && !(await loadProject(projectId)))
        return reply.code(400).send({ error: 'unknown_project' })
      if (milestoneId) {
        const [m] = await db.query<{ project_id: string }>(
          'SELECT project_id FROM milestones WHERE id = $1',
          [milestoneId],
        )
        if (!m || !milestoneFits(projectId, m.project_id))
          return reply.code(400).send({ error: 'milestone_not_in_project' })
      }
      const stages = await db.query<{ key: string; category: string; stage_type: StageType }>(
        'SELECT key, category, stage_type FROM stages WHERE team_id = $1 ORDER BY position',
        [team.id],
      )
      // Rule 10: new items start in the first Waiting stage unless told otherwise.
      const stage = request.body.stageKey
        ? stages.find((s) => s.key === request.body.stageKey)
        : (stages.find((s) => s.stage_type === 'waiting') ?? stages[0])
      if (!stage) return reply.code(400).send({ error: 'unknown_stage' })

      const id = randomUUID()
      const key = await db.transaction(async (tx: Queryable) => {
        const [seq] = await tx.query<{ item_seq: number; key: string }>(
          `UPDATE teams SET item_seq = GREATEST(item_seq,
             (SELECT COALESCE(max(substring(key FROM '[0-9]+$')::int), 0) FROM work_items WHERE team_id = $1)) + 1
           WHERE id = $1 RETURNING item_seq, key`,
          [team.id],
        )
        const itemKey = `${seq?.key ?? team.key}-${seq?.item_seq ?? 1}`
        await tx.query(
          `INSERT INTO work_items (id, key, kind, title, status_id, status_category, team_id, parent_id,
             created_by, project_id, milestone_id, fields)
           VALUES ($1, $2, 'task', $3, $4, $5, $6, $7, $8, $9, $10, '{"priority": 0}'::jsonb)`,
          [
            id,
            itemKey,
            title,
            stage.key,
            stage.category,
            team.id,
            parentRowId,
            principal.id,
            projectId,
            milestoneId,
          ],
        )
        await tx.query(
          'INSERT INTO stage_history (item_id, stage_key, owner_id, moved_by) VALUES ($1, $2, NULL, $3)',
          [id, stage.key, principal.id],
        )
        return itemKey
      })
      await audit(db, principal, 'item.create', team.id, id, { key })
      const [item] = await itemsWhere('w.id = $1', [id])
      return reply.code(201).send({ item })
    },
  )

  app.patch<{
    Params: { id: string }
    Body: {
      projectId?: string | null
      milestoneId?: string | null
      dueOn?: string | null
      estimate?: number | null
      labels?: string[]
    }
  }>(
    '/core/items/:id/plan',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          minProperties: 1,
          properties: {
            projectId: { type: ['string', 'null'], maxLength: 64 },
            milestoneId: { type: ['string', 'null'], maxLength: 64 },
            dueOn: { type: ['string', 'null'], format: 'date' },
            estimate: { type: ['integer', 'null'], minimum: 0, maximum: 10000 },
            labels: {
              type: 'array',
              maxItems: 20,
              items: { type: 'string', minLength: 1, maxLength: 40 },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const principal = await principalOr401(request, reply)
      if (!principal) return
      const [row] = await db.query<{
        id: string
        team_id: string
        is_private: boolean
        project_id: string | null
        milestone_id: string | null
        parent_id: string | null
      }>(
        `SELECT w.id, w.team_id, t.is_private, w.project_id, w.milestone_id, w.parent_id FROM work_items w
         JOIN teams t ON t.id = w.team_id WHERE (w.id = $1 OR w.key = $1) AND w.deleted_at IS NULL`,
        [request.params.id],
      )
      if (!row || !canSee(principal, { id: row.team_id, is_private: row.is_private })) {
        return reply.code(404).send({ error: 'not_found' })
      }
      if (!can(principal, 'item.edit', { id: row.team_id, is_private: row.is_private })) {
        return reply.code(403).send({ error: 'forbidden' })
      }
      const body = request.body
      let projectId = row.project_id
      let milestoneId = row.milestone_id
      if (body.projectId !== undefined) {
        if (row.parent_id) return reply.code(400).send({ error: 'sub_item_follows_parent' })
        if (body.projectId && !(await loadProject(body.projectId)))
          return reply.code(400).send({ error: 'unknown_project' })
        if (body.projectId !== projectId) milestoneId = null // Rule 8.
        projectId = body.projectId
      }
      if (body.milestoneId !== undefined) {
        if (body.milestoneId) {
          const [m] = await db.query<{ project_id: string }>(
            'SELECT project_id FROM milestones WHERE id = $1',
            [body.milestoneId],
          )
          if (!m || !milestoneFits(projectId, m.project_id))
            return reply.code(400).send({ error: 'milestone_not_in_project' })
        }
        milestoneId = body.milestoneId
      }
      const labels = body.labels
        ? [...new Set(body.labels.map((l) => l.trim().toLowerCase()).filter(Boolean))]
        : undefined
      await db.transaction(async (tx: Queryable) => {
        await tx.query(
          `UPDATE work_items SET project_id = $2, milestone_id = $3,
             due_on = CASE WHEN $4::boolean THEN $5::date ELSE due_on END,
             estimate = CASE WHEN $6::boolean THEN $7::int ELSE estimate END,
             labels = COALESCE($8::text[], labels), updated_at = now()
           WHERE id = $1`,
          [
            row.id,
            projectId,
            milestoneId,
            body.dueOn !== undefined,
            body.dueOn ?? null,
            body.estimate !== undefined,
            body.estimate ?? null,
            labels ?? null,
          ],
        )
        if (projectId !== row.project_id) {
          // Sub-items move with their parent.
          await tx.query(
            'UPDATE work_items SET project_id = $2, milestone_id = NULL, updated_at = now() WHERE parent_id = $1',
            [row.id, projectId],
          )
        }
      })
      await audit(db, principal, 'item.plan', row.team_id, row.id, body)
      const [item] = await itemsWhere('w.id = $1', [row.id])
      return { item }
    },
  )
}
