import type { FastifyInstance } from 'fastify'
import {
  allowedDestinations,
  checkMove,
  decide,
  isFilled,
  REVIEW_REQUIREMENT,
  type PermissionAction,
  type PermissionTarget,
  type UserPrincipal,
  type Stage,
  type StageTransition,
  type WorkItem,
} from '@wm/shared'
import type { Db, Queryable } from '../db/db.js'
import { resolvePrincipal } from '../principal.js'
import { canLinkRecord } from './records.js'

export interface ItemRow {
  seq: string
  id: string
  key: string
  kind: WorkItem['kind']
  title: string
  status_id: string
  status_category: WorkItem['statusCategory']
  team_id: string
  parent_id: string | null
  client_id: string | null
  assignee_id: string | null
  created_by: string | null
  created_at: Date | string
  updated_at: Date | string
  fields: Record<string, unknown>
  is_private: boolean
}

export const ITEM_COLUMNS = `w.seq, w.id, w.key, w.kind, w.title, w.status_id, w.status_category,
  w.team_id, w.parent_id, w.client_id, w.assignee_id, w.created_by, w.created_at, w.updated_at,
  w.fields, t.is_private`

export const iso = (value: Date | string): string => new Date(value).toISOString()

export function toWorkItem(row: ItemRow): WorkItem {
  return {
    id: row.id,
    key: row.key,
    kind: row.kind,
    title: row.title,
    statusId: row.status_id,
    statusCategory: row.status_category,
    parentId: row.parent_id,
    teamId: row.team_id,
    clientId: row.client_id,
    assigneeId: row.assignee_id,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    fields: row.fields,
  }
}

export function targetOf(row: ItemRow): PermissionTarget {
  return {
    team: { id: row.team_id, isPrivate: row.is_private },
    ...(row.created_by ? { createdBy: row.created_by } : {}),
  }
}

export async function audit(
  db: Db,
  actor: UserPrincipal,
  action: string,
  teamId: string | null,
  objectId: string | null,
  detail: Record<string, unknown> = {},
): Promise<void> {
  await db.query(
    'INSERT INTO audit_log (actor_id, action, team_id, object_id, detail) VALUES ($1, $2, $3, $4, $5::jsonb)',
    [actor.id, action, teamId, objectId, JSON.stringify(detail)],
  )
}

interface StepState {
  id: string
  label: string
  ticked: boolean
  tickedBy: string | null
  tickedAt: string | null
}

interface WorkflowState {
  stages: Stage[]
  transitions: StageTransition[]
  /** The current pass: the open stage_history row. */
  passSeq: string | null
  steps: StepState[]
  requiredFields: { key: string; label: string; filled: boolean }[]
  /** Set when the current stage is a review stage (specs/reviews.md). */
  review: { sendBackTo: string; approved: boolean } | null
  /** Labels of unmet requirements: steps, then fields, then the review. */
  missing: string[]
}

/** The current stage's rules and how far this item has got with them. */
export async function loadWorkflow(
  db: Queryable,
  row: Pick<ItemRow, 'id' | 'team_id' | 'status_id' | 'fields'>,
  fields: Record<string, unknown> = row.fields,
): Promise<WorkflowState> {
  const stageRows = await db.query<{
    key: string
    name: string
    category: Stage['category']
    position: number
    review_send_back_to: string | null
  }>(
    'SELECT key, name, category, position, review_send_back_to FROM stages WHERE team_id = $1 ORDER BY position',
    [row.team_id],
  )
  const transitions = await db.query<{ from_key: string; to_key: string }>(
    'SELECT from_key, to_key FROM stage_transitions WHERE team_id = $1',
    [row.team_id],
  )
  const pass = await db.query<{ seq: string }>(
    'SELECT seq FROM stage_history WHERE item_id = $1 AND left_at IS NULL ORDER BY seq DESC LIMIT 1',
    [row.id],
  )
  const passSeq = pass[0]?.seq ?? null
  const steps = await db.query<{
    id: string
    label: string
    ticked: boolean | null
    actor_id: string | null
    at: Date | string | null
  }>(
    `SELECT s.id, s.label, e.ticked, e.actor_id, e.at FROM stage_steps s
     LEFT JOIN LATERAL (
       SELECT ticked, actor_id, at FROM step_events
       WHERE history_seq = $3 AND step_id = s.id ORDER BY seq DESC LIMIT 1
     ) e ON true
     WHERE s.team_id = $1 AND s.stage_key = $2 ORDER BY s.position, s.id`,
    [row.team_id, row.status_id, passSeq],
  )
  const required = await db.query<{ field_key: string; label: string }>(
    'SELECT field_key, label FROM stage_required_fields WHERE team_id = $1 AND stage_key = $2 ORDER BY label',
    [row.team_id, row.status_id],
  )
  const stepState = steps.map((step): StepState => ({
    id: String(step.id),
    label: step.label,
    ticked: step.ticked === true,
    tickedBy: step.ticked ? step.actor_id : null,
    tickedAt: step.ticked && step.at ? iso(step.at) : null,
  }))
  const fieldState = required.map((field) => ({
    key: field.field_key,
    label: field.label,
    filled: isFilled(fields[field.field_key]),
  }))
  // A review stage needs an approved round in this pass (specs/reviews.md, rules 1 and 7).
  const sendBackTo = stageRows.find((s) => s.key === row.status_id)?.review_send_back_to ?? null
  let review: WorkflowState['review'] = null
  if (sendBackTo !== null) {
    const approved =
      passSeq !== null &&
      (
        await db.query(
          "SELECT 1 FROM review_rounds WHERE item_id = $1 AND history_seq = $2 AND state = 'approved'",
          [row.id, passSeq],
        )
      ).length > 0
    review = { sendBackTo, approved }
  }
  return {
    stages: stageRows.map((stage) => ({
      teamId: row.team_id,
      key: stage.key,
      name: stage.name,
      category: stage.category,
      position: stage.position,
    })),
    transitions: transitions.map((t) => ({ from: t.from_key, to: t.to_key })),
    passSeq,
    steps: stepState,
    requiredFields: fieldState,
    review,
    missing: [
      ...stepState.filter((step) => !step.ticked).map((step) => step.label),
      ...fieldState.filter((field) => !field.filled).map((field) => field.label),
      ...(review && !review.approved ? [REVIEW_REQUIREMENT] : []),
    ],
  }
}

/** The item, if this person may see it. A hidden item looks exactly like a missing one. */
export async function loadVisibleItemIn(
  db: Db,
  principal: UserPrincipal,
  idOrKey: string,
): Promise<ItemRow | null> {
  const rows = await db.query<ItemRow>(
    `SELECT ${ITEM_COLUMNS} FROM work_items w JOIN teams t ON t.id = w.team_id
     WHERE (w.id = $1 OR w.key = $1) AND w.deleted_at IS NULL`,
    [idOrKey],
  )
  const row = rows[0]
  if (!row) return null
  const decision = decide(principal, 'item.view', targetOf(row))
  if (!decision.allowed) return null
  if (decision.audit) await audit(db, principal, 'item.view', row.team_id, row.id)
  return row
}

export interface ItemRouteOptions {
  db: Db
  devAuth: boolean
}

export function registerItemRoutes(app: FastifyInstance, { db, devAuth }: ItemRouteOptions): void {
  /** Who the caller is, so the client can show the right name and teams. */
  app.get('/me', async (request, reply) => {
    const principal = await resolvePrincipal(db, request, devAuth)
    if (!principal) return reply.code(401).send({ error: 'unauthenticated' })
    const rows = await db.query<{ name: string }>('SELECT name FROM users WHERE id = $1', [
      principal.id,
    ])
    return {
      id: principal.id,
      name: rows[0]?.name ?? principal.id,
      orgRole: principal.orgRole,
      teams: principal.teams,
    }
  })

  /** Internal people, for assignee names and pickers. Any signed-in internal user may list them. */
  app.get('/users', async (request, reply) => {
    const principal = await resolvePrincipal(db, request, devAuth)
    if (!principal) return reply.code(401).send({ error: 'unauthenticated' })
    return {
      users: await db.query<{ id: string; name: string }>(
        'SELECT id, name FROM users ORDER BY name',
      ),
    }
  })

  /** Teams the caller may see, each with its workflow stages in order. */
  app.get('/teams', async (request, reply) => {
    const principal = await resolvePrincipal(db, request, devAuth)
    if (!principal) return reply.code(401).send({ error: 'unauthenticated' })
    const teams = await db.query<{
      id: string
      name: string
      is_private: boolean
      hand_off_clears_owner: boolean
    }>('SELECT id, name, is_private, hand_off_clears_owner FROM teams ORDER BY name')
    const visible = teams.filter(
      (team) =>
        decide(principal, 'item.view', { team: { id: team.id, isPrivate: team.is_private } })
          .allowed,
    )
    const stages = await db.query<{
      team_id: string
      key: string
      name: string
      category: Stage['category']
      position: number
      review_send_back_to: string | null
      item_limit: number | null
      target_hours: number | null
    }>(
      'SELECT team_id, key, name, category, position, review_send_back_to, item_limit, target_hours FROM stages ORDER BY team_id, position',
    )
    const transitions = await db.query<{ team_id: string; from_key: string; to_key: string }>(
      'SELECT team_id, from_key, to_key FROM stage_transitions',
    )
    return {
      teams: visible.map((team) => ({
        id: team.id,
        name: team.name,
        isPrivate: team.is_private,
        handOffClearsOwner: team.hand_off_clears_owner,
        stages: stages
          .filter((stage) => stage.team_id === team.id)
          .map((stage): Stage => ({
            teamId: stage.team_id,
            key: stage.key,
            name: stage.name,
            category: stage.category,
            position: stage.position,
          })),
        transitions: transitions
          .filter((t) => t.team_id === team.id)
          .map((t): StageTransition => ({ from: t.from_key, to: t.to_key })),
        reviewStages: stages
          .filter((stage) => stage.team_id === team.id && stage.review_send_back_to !== null)
          .map((stage) => ({ stageKey: stage.key, sendBackTo: stage.review_send_back_to })),
        stageLimits: stages
          .filter(
            (stage) =>
              stage.team_id === team.id &&
              (stage.item_limit !== null || stage.target_hours !== null),
          )
          .map((stage) => ({
            stageKey: stage.key,
            itemLimit: stage.item_limit,
            targetHours: stage.target_hours,
          })),
      })),
    }
  })

  /** Who owned each stage of an item, oldest first. */
  app.get<{ Params: { id: string } }>('/items/:id/stages', async (request, reply) => {
    const principal = await resolvePrincipal(db, request, devAuth)
    if (!principal) return reply.code(401).send({ error: 'unauthenticated' })
    const row = await loadVisibleItem(principal, request.params.id)
    if (!row) return reply.code(404).send({ error: 'not_found' })
    const history = await db.query<{
      stage_key: string
      owner_id: string | null
      entered_at: Date | string
      left_at: Date | string | null
      moved_by: string | null
      kind: 'move' | 'forced' | 'reopen' | 'sent_back'
      reason: string | null
    }>(
      'SELECT stage_key, owner_id, entered_at, left_at, moved_by, kind, reason FROM stage_history WHERE item_id = $1 ORDER BY seq',
      [row.id],
    )
    return {
      history: history.map((entry) => ({
        stageKey: entry.stage_key,
        ownerId: entry.owner_id,
        enteredAt: iso(entry.entered_at),
        leftAt: entry.left_at ? iso(entry.left_at) : null,
        movedBy: entry.moved_by,
        kind: entry.kind,
        reason: entry.reason,
      })),
    }
  })

  /** The current stage's checklist, required fields, and where the item can go next. */
  app.get<{ Params: { id: string } }>('/items/:id/workflow', async (request, reply) => {
    const principal = await resolvePrincipal(db, request, devAuth)
    if (!principal) return reply.code(401).send({ error: 'unauthenticated' })
    const row = await loadVisibleItem(principal, request.params.id)
    if (!row) return reply.code(404).send({ error: 'not_found' })
    return workflowPayload(principal, row, await loadWorkflow(db, row))
  })

  /** Tick or untick one checklist step of the item's current stage, for the current pass. */
  app.post<{ Params: { id: string; stepId: string }; Body: { ticked: boolean } }>(
    '/items/:id/steps/:stepId',
    {
      schema: {
        params: {
          type: 'object',
          properties: {
            id: { type: 'string', maxLength: 64 },
            stepId: { type: 'string', pattern: '^[0-9]{1,18}$' },
          },
          required: ['id', 'stepId'],
        },
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['ticked'],
          properties: { ticked: { type: 'boolean' } },
        },
      },
    },
    async (request, reply) => {
      const principal = await resolvePrincipal(db, request, devAuth)
      if (!principal) return reply.code(401).send({ error: 'unauthenticated' })
      const row = await loadVisibleItem(principal, request.params.id)
      if (!row) return reply.code(404).send({ error: 'not_found' })
      if (!decide(principal, 'item.tickStep', targetOf(row)).allowed) {
        return reply.code(403).send({ error: 'forbidden' })
      }
      const state = await loadWorkflow(db, row)
      const step = state.steps.find((s) => s.id === request.params.stepId)
      if (!step || state.passSeq === null) {
        return reply.code(400).send({ error: 'step_not_in_stage' })
      }
      await db.query(
        'INSERT INTO step_events (history_seq, step_id, ticked, actor_id) VALUES ($1, $2, $3, $4)',
        [state.passSeq, step.id, request.body.ticked, principal.id],
      )
      return workflowPayload(principal, row, await loadWorkflow(db, row))
    },
  )

  function workflowPayload(principal: UserPrincipal, row: ItemRow, state: WorkflowState) {
    return {
      stageKey: row.status_id,
      steps: state.steps,
      requiredFields: state.requiredFields,
      review: state.review,
      missing: state.missing,
      allowedMoves: allowedDestinations(state.stages, row.status_id, state.transitions),
      canForce: decide(principal, 'item.forceMove', targetOf(row)).allowed,
    }
  }

  /** List items the caller may view. Hidden teams are filtered out in the query itself. */
  app.get<{ Querystring: { team?: string; q?: string; limit?: number; after?: string } }>(
    '/items',
    {
      schema: {
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            team: { type: 'string', maxLength: 64 },
            q: { type: 'string', maxLength: 200 },
            limit: { type: 'integer', minimum: 1, maximum: 200, default: 50 },
            after: { type: 'string', pattern: '^[0-9]{1,18}$' },
          },
        },
      },
    },
    async (request, reply) => {
      const principal = await resolvePrincipal(db, request, devAuth)
      if (!principal) return reply.code(401).send({ error: 'unauthenticated' })

      const { team, q, after } = request.query
      const limit = request.query.limit ?? 50
      const where = ['w.deleted_at IS NULL']
      const params: unknown[] = []
      const param = (value: unknown): string => `$${params.push(value)}`

      if (principal.orgRole !== 'org_admin') {
        where.push(
          `(t.is_private = false OR t.id = ANY(${param(Object.keys(principal.teams))}::text[]))`,
        )
      }
      if (team) where.push(`w.team_id = ${param(team)}`)
      if (q) where.push(`(w.title ILIKE ${param(`%${q}%`)} OR w.key ILIKE ${param(`${q}%`)})`)
      if (after) where.push(`w.seq > ${param(after)}::bigint`)

      const rows = await db.query<ItemRow>(
        `SELECT ${ITEM_COLUMNS} FROM work_items w JOIN teams t ON t.id = w.team_id
         WHERE ${where.join(' AND ')} ORDER BY w.seq LIMIT ${param(limit + 1)}`,
        params,
      )
      const page = rows.slice(0, limit)
      // Second check through the permission layer, in case the query above is ever wrong.
      const decisions = page.map((row) => decide(principal, 'item.view', targetOf(row)))
      const visible = page.filter((_, index) => decisions[index]?.allowed)
      const auditedTeams = [
        ...new Set(page.filter((_, index) => decisions[index]?.audit).map((row) => row.team_id)),
      ]
      if (auditedTeams.length > 0) {
        await audit(db, principal, 'item.list', null, null, { privateTeams: auditedTeams })
      }
      const last = page[page.length - 1]
      return {
        items: visible.map(toWorkItem),
        nextAfter: rows.length > limit && last ? String(last.seq) : null,
      }
    },
  )

  const loadVisibleItem = (principal: UserPrincipal, idOrKey: string) =>
    loadVisibleItemIn(db, principal, idOrKey)

  /** A hidden item looks exactly like a missing one: 404, never 403. */
  app.get<{ Params: { id: string } }>('/items/:id', async (request, reply) => {
    const principal = await resolvePrincipal(db, request, devAuth)
    if (!principal) return reply.code(401).send({ error: 'unauthenticated' })
    const row = await loadVisibleItem(principal, request.params.id)
    if (!row) return reply.code(404).send({ error: 'not_found' })
    return { item: toWorkItem(row) }
  })

  app.patch<{
    Params: { id: string }
    Body: {
      title?: string
      statusId?: string
      assigneeId?: string | null
      priority?: number
      fields?: Record<string, string | number | boolean | null>
      reason?: string
      force?: boolean
      recordId?: string | null
    }
  }>(
    '/items/:id',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          minProperties: 1,
          properties: {
            title: { type: 'string', minLength: 1, maxLength: 500 },
            statusId: { type: 'string', maxLength: 64 },
            assigneeId: { type: ['string', 'null'], maxLength: 64 },
            priority: { type: 'integer', minimum: 0, maximum: 4 },
            fields: {
              type: 'object',
              minProperties: 1,
              maxProperties: 20,
              propertyNames: { pattern: '^[a-z][a-z0-9_]{0,39}$', not: { enum: ['priority'] } },
              additionalProperties: {
                type: ['string', 'number', 'boolean', 'null'],
                maxLength: 2000,
              },
            },
            reason: { type: 'string', maxLength: 500 },
            force: { type: 'boolean' },
            recordId: { type: ['string', 'null'], maxLength: 80 },
          },
        },
      },
    },
    async (request, reply) => {
      const principal = await resolvePrincipal(db, request, devAuth)
      if (!principal) return reply.code(401).send({ error: 'unauthenticated' })
      const row = await loadVisibleItem(principal, request.params.id)
      if (!row) return reply.code(404).send({ error: 'not_found' })

      const { title, statusId, assigneeId, priority, fields, reason, force, recordId } =
        request.body
      const stageChanged = statusId !== undefined && statusId !== row.status_id
      const fromEnd = row.status_category === 'done' || row.status_category === 'cancelled'
      const needed: PermissionAction[] = []
      // Linking a record is editing the item (specs/records.md, rule 5).
      if (
        title !== undefined ||
        priority !== undefined ||
        fields !== undefined ||
        recordId !== undefined
      ) {
        needed.push('item.edit')
      }
      // Leaving a done or cancelled stage is reopening (specs/workflow.md, rule 8).
      if (statusId !== undefined) {
        needed.push(stageChanged && fromEnd ? 'item.reopen' : 'item.transition')
      }
      if (assigneeId !== undefined) needed.push('item.assign')
      const target = targetOf(row)
      if (!needed.every((action) => decide(principal, action, target).allowed)) {
        return reply.code(403).send({ error: 'forbidden' })
      }

      const sets: string[] = ['updated_at = now()']
      const params: unknown[] = []
      const param = (value: unknown): string => `$${params.push(value)}`
      if (title !== undefined) sets.push(`title = ${param(title)}`)
      if (recordId !== undefined) {
        // Only a new link is checked; keeping an existing one (even archived) is fine (rule 4).
        const linked = await db.query<{ record_id: string | null }>(
          'SELECT record_id FROM work_items WHERE id = $1',
          [row.id],
        )
        const isNewLink = recordId !== null && recordId !== (linked[0]?.record_id ?? null)
        if (isNewLink && !(await canLinkRecord(db, principal, recordId))) {
          return reply.code(400).send({ error: 'unknown_record' })
        }
        sets.push(`record_id = ${param(recordId)}`)
      }
      let fieldsSql = 'fields'
      if (fields !== undefined) {
        fieldsSql = `(${fieldsSql} || ${param(JSON.stringify(fields))}::jsonb)`
      }
      if (priority !== undefined) {
        fieldsSql = `jsonb_set(${fieldsSql}, '{priority}', to_jsonb(${param(priority)}::int))`
      }
      if (fieldsSql !== 'fields') sets.push(`fields = ${fieldsSql}`)
      // The stage must belong to the item's own team.
      if (statusId !== undefined) {
        const stages = await db.query<{ category: string }>(
          'SELECT category FROM stages WHERE team_id = $1 AND key = $2',
          [row.team_id, statusId],
        )
        const stage = stages[0]
        if (!stage) return reply.code(400).send({ error: 'unknown_status' })
        sets.push(`status_id = ${param(statusId)}`, `status_category = ${param(stage.category)}`)
      }
      // Stage rules (specs/workflow.md). Fields filled in by this same request count.
      let moveKind: 'move' | 'forced' | 'reopen' = 'move'
      let moveMissing: readonly string[] = []
      if (stageChanged && statusId !== undefined) {
        const state = await loadWorkflow(db, row, { ...row.fields, ...(fields ?? {}) })
        const check = checkMove({
          stages: state.stages,
          transitions: state.transitions,
          fromKey: row.status_id,
          toKey: statusId,
          missing: state.missing,
          force: force === true,
          canForce: decide(principal, 'item.forceMove', target).allowed,
          reason,
        })
        if (!check.ok) {
          return reply.code(409).send({
            error: check.error,
            ...(check.missing ? { missing: check.missing } : {}),
          })
        }
        moveKind = check.kind
        moveMissing = state.missing
      }
      const moveReason = moveKind === 'move' ? null : (reason ?? '').trim()
      // The owner after this change: as given, or cleared on a hand-over if the team works that way.
      let nextOwner = row.assignee_id
      if (assigneeId !== undefined) {
        if (assigneeId !== null) {
          const users = await db.query('SELECT 1 FROM users WHERE id = $1', [assigneeId])
          if (users.length === 0) return reply.code(400).send({ error: 'unknown_assignee' })
        }
        nextOwner = assigneeId
      } else if (stageChanged) {
        const teams = await db.query<{ hand_off_clears_owner: boolean }>(
          'SELECT hand_off_clears_owner FROM teams WHERE id = $1',
          [row.team_id],
        )
        if (teams[0]?.hand_off_clears_owner) nextOwner = null
      }
      if (nextOwner !== row.assignee_id) sets.push(`assignee_id = ${param(nextOwner)}`)

      await db.transaction(async (tx) => {
        await tx.query(
          `UPDATE work_items SET ${sets.join(', ')} WHERE id = ${param(row.id)}`,
          params,
        )
        if (stageChanged) {
          await tx.query(
            'UPDATE stage_history SET left_at = now() WHERE item_id = $1 AND left_at IS NULL',
            [row.id],
          )
          await tx.query(
            'INSERT INTO stage_history (item_id, stage_key, owner_id, moved_by, kind, reason) VALUES ($1, $2, $3, $4, $5, $6)',
            [row.id, statusId, nextOwner, principal.id, moveKind, moveReason],
          )
          // Leaving the stage closes an open review round (specs/reviews.md, rule 8).
          await tx.query(
            `UPDATE review_rounds SET state = 'withdrawn', closed_at = now(), closed_by = $2
             WHERE item_id = $1 AND state = 'open'`,
            [row.id, principal.id],
          )
          if (moveKind === 'forced') {
            await tx.query(
              'INSERT INTO audit_log (actor_id, action, team_id, object_id, detail) VALUES ($1, $2, $3, $4, $5::jsonb)',
              [
                principal.id,
                'item.forceMove',
                row.team_id,
                row.id,
                JSON.stringify({
                  from: row.status_id,
                  to: statusId,
                  reason: moveReason,
                  missing: moveMissing,
                }),
              ],
            )
          }
        } else if (nextOwner !== row.assignee_id) {
          await tx.query(
            'UPDATE stage_history SET owner_id = $2 WHERE item_id = $1 AND left_at IS NULL',
            [row.id, nextOwner],
          )
        }
      })
      const updated = await loadVisibleItem(principal, row.id)
      return { item: updated ? toWorkItem(updated) : null }
    },
  )
}
