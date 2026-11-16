import type { FastifyInstance } from 'fastify'
import {
  decide,
  SAMPLE_STATUSES,
  type PermissionAction,
  type PermissionTarget,
  type UserPrincipal,
  type WorkItem,
} from '@wm/shared'
import type { Db } from '../db/db.js'
import { resolvePrincipal } from '../principal.js'

interface ItemRow {
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

const ITEM_COLUMNS = `w.seq, w.id, w.key, w.kind, w.title, w.status_id, w.status_category,
  w.team_id, w.parent_id, w.client_id, w.assignee_id, w.created_by, w.created_at, w.updated_at,
  w.fields, t.is_private`

const iso = (value: Date | string): string => new Date(value).toISOString()

function toWorkItem(row: ItemRow): WorkItem {
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

function targetOf(row: ItemRow): PermissionTarget {
  return {
    team: { id: row.team_id, isPrivate: row.is_private },
    ...(row.created_by ? { createdBy: row.created_by } : {}),
  }
}

async function audit(
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

  async function loadVisibleItem(
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
    Body: { title?: string; statusId?: string; assigneeId?: string | null; priority?: number }
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
          },
        },
      },
    },
    async (request, reply) => {
      const principal = await resolvePrincipal(db, request, devAuth)
      if (!principal) return reply.code(401).send({ error: 'unauthenticated' })
      const row = await loadVisibleItem(principal, request.params.id)
      if (!row) return reply.code(404).send({ error: 'not_found' })

      const { title, statusId, assigneeId, priority } = request.body
      const needed: PermissionAction[] = []
      if (title !== undefined || priority !== undefined) needed.push('item.edit')
      if (statusId !== undefined) needed.push('item.transition')
      if (assigneeId !== undefined) needed.push('item.assign')
      const target = targetOf(row)
      if (!needed.every((action) => decide(principal, action, target).allowed)) {
        return reply.code(403).send({ error: 'forbidden' })
      }

      const sets: string[] = ['updated_at = now()']
      const params: unknown[] = []
      const param = (value: unknown): string => `$${params.push(value)}`
      if (title !== undefined) sets.push(`title = ${param(title)}`)
      if (priority !== undefined) {
        sets.push(`fields = jsonb_set(fields, '{priority}', to_jsonb(${param(priority)}::int))`)
      }
      if (statusId !== undefined) {
        // Workflows are not designed yet; until then the fixed sample statuses are the only ones.
        const status = SAMPLE_STATUSES.find((s) => s.id === statusId)
        if (!status) return reply.code(400).send({ error: 'unknown_status' })
        sets.push(`status_id = ${param(status.id)}`, `status_category = ${param(status.category)}`)
      }
      if (assigneeId !== undefined) {
        if (assigneeId !== null) {
          const users = await db.query('SELECT 1 FROM users WHERE id = $1', [assigneeId])
          if (users.length === 0) return reply.code(400).send({ error: 'unknown_assignee' })
        }
        sets.push(`assignee_id = ${param(assigneeId)}`)
      }
      await db.query(`UPDATE work_items SET ${sets.join(', ')} WHERE id = ${param(row.id)}`, params)
      const updated = await loadVisibleItem(principal, row.id)
      return { item: updated ? toWorkItem(updated) : null }
    },
  )
}
