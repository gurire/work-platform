/**
 * Records (specs/records.md). Seeing a record is `item.view` on its home team; editing,
 * creating and archiving use the record actions. A record the caller may not see is 404.
 */
import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import {
  checkRecordValues,
  decide,
  recordChanges,
  type PermissionTarget,
  type RecordType,
  type RecordValue,
  type UserPrincipal,
} from '@wm/shared'
import type { Db } from '../db/db.js'
import { resolvePrincipal } from '../principal.js'
import { iso, loadVisibleItemIn, targetOf } from './items.js'

interface RecordRow {
  id: string
  type_key: string
  team_id: string
  title: string
  values: Record<string, RecordValue>
  created_by: string | null
  created_at: Date | string
  updated_at: Date | string
  archived_at: Date | string | null
  is_private: boolean
}

const RECORD_COLUMNS = `r.id, r.type_key, r.team_id, r.title, r.values, r.created_by, r.created_at,
  r.updated_at, r.archived_at, t.is_private`

const homeOf = (row: Pick<RecordRow, 'team_id' | 'is_private'>): PermissionTarget => ({
  team: { id: row.team_id, isPrivate: row.is_private },
})

function summary(row: RecordRow) {
  return {
    id: row.id,
    typeKey: row.type_key,
    teamId: row.team_id,
    title: row.title,
    values: row.values,
    archived: row.archived_at !== null,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  }
}

const valueSchema = { type: ['string', 'number', 'null'], maxLength: 2000 } as const
const valuesSchema = {
  type: 'object',
  maxProperties: 50,
  propertyNames: { pattern: '^[a-z][a-z0-9_]{0,39}$' },
  additionalProperties: valueSchema,
} as const

export function registerRecordRoutes(
  app: FastifyInstance,
  { db, devAuth }: { db: Db; devAuth: boolean },
): void {
  async function loadTypes(): Promise<Map<string, RecordType>> {
    const rows = await db.query<{ key: string; name: string; fields: RecordType['fields'] }>(
      'SELECT key, name, fields FROM record_types ORDER BY name',
    )
    return new Map(
      rows.map((row) => [row.key, { key: row.key, name: row.name, fields: row.fields }]),
    )
  }

  async function loadVisibleRecord(
    principal: UserPrincipal,
    id: string,
  ): Promise<RecordRow | null> {
    const rows = await db.query<RecordRow>(
      `SELECT ${RECORD_COLUMNS} FROM records r JOIN teams t ON t.id = r.team_id WHERE r.id = $1`,
      [id],
    )
    const row = rows[0]
    if (!row || !decide(principal, 'item.view', homeOf(row)).allowed) return null
    return row
  }

  async function detail(principal: UserPrincipal, row: RecordRow) {
    const types = await loadTypes()
    const home = homeOf(row)
    const linked = await db.query<{
      id: string
      key: string
      title: string
      status_id: string
      team_id: string
      is_private: boolean
    }>(
      `SELECT w.id, w.key, w.title, w.status_id, w.team_id, t.is_private FROM work_items w
       JOIN teams t ON t.id = w.team_id
       WHERE w.record_id = $1 AND w.deleted_at IS NULL ORDER BY w.seq LIMIT 500`,
      [row.id],
    )
    const events = await db.query<{
      actor_id: string | null
      action: string
      changes: unknown
      at: Date | string
    }>(
      'SELECT actor_id, action, changes, at FROM record_events WHERE record_id = $1 ORDER BY seq DESC LIMIT 200',
      [row.id],
    )
    const archived = row.archived_at !== null
    return {
      record: summary(row),
      type: types.get(row.type_key) ?? null,
      canEdit: !archived && decide(principal, 'record.edit', home).allowed,
      canArchive: !archived && decide(principal, 'record.archive', home).allowed,
      // Only the linked items this person may see.
      items: linked
        .filter(
          (item) =>
            decide(principal, 'item.view', {
              team: { id: item.team_id, isPrivate: item.is_private },
            }).allowed,
        )
        .map((item) => ({
          id: item.id,
          key: item.key,
          title: item.title,
          statusId: item.status_id,
          teamId: item.team_id,
        })),
      history: events.map((event) => ({
        actorId: event.actor_id,
        action: event.action,
        changes: event.changes,
        at: iso(event.at),
      })),
    }
  }

  app.get('/record-types', async (request, reply) => {
    const principal = await resolvePrincipal(db, request, devAuth)
    if (!principal) return reply.code(401).send({ error: 'unauthenticated' })
    return { types: [...(await loadTypes()).values()] }
  })

  /** Records the caller may see, for lists and pickers. Archived records are left out (rule 4). */
  app.get<{ Querystring: { type?: string; q?: string; team?: string } }>(
    '/records',
    {
      schema: {
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            type: { type: 'string', maxLength: 64 },
            q: { type: 'string', maxLength: 200 },
            team: { type: 'string', maxLength: 64 },
          },
        },
      },
    },
    async (request, reply) => {
      const principal = await resolvePrincipal(db, request, devAuth)
      if (!principal) return reply.code(401).send({ error: 'unauthenticated' })
      const { type, q, team } = request.query
      const where = ['r.archived_at IS NULL']
      const params: unknown[] = []
      const param = (value: unknown) => `$${params.push(value)}`
      if (type) where.push(`r.type_key = ${param(type)}`)
      if (team) where.push(`r.team_id = ${param(team)}`)
      if (q) where.push(`r.title ILIKE ${param(`%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`)}`)
      const rows = await db.query<RecordRow>(
        `SELECT ${RECORD_COLUMNS} FROM records r JOIN teams t ON t.id = r.team_id
         WHERE ${where.join(' AND ')} ORDER BY r.title LIMIT 200`,
        params,
      )
      return {
        records: rows
          .filter((row) => decide(principal, 'item.view', homeOf(row)).allowed)
          .slice(0, 50)
          .map(summary),
      }
    },
  )

  app.get<{ Params: { id: string } }>('/records/:id', async (request, reply) => {
    const principal = await resolvePrincipal(db, request, devAuth)
    if (!principal) return reply.code(401).send({ error: 'unauthenticated' })
    const row = await loadVisibleRecord(principal, request.params.id)
    if (!row) return reply.code(404).send({ error: 'not_found' })
    return detail(principal, row)
  })

  app.post<{
    Body: { typeKey: string; teamId: string; title: string; values?: Record<string, RecordValue> }
  }>(
    '/records',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['typeKey', 'teamId', 'title'],
          properties: {
            typeKey: { type: 'string', maxLength: 64 },
            teamId: { type: 'string', maxLength: 64 },
            title: { type: 'string', minLength: 1, maxLength: 300 },
            values: valuesSchema,
          },
        },
      },
    },
    async (request, reply) => {
      const principal = await resolvePrincipal(db, request, devAuth)
      if (!principal) return reply.code(401).send({ error: 'unauthenticated' })
      const { typeKey, teamId, values = {} } = request.body
      const title = request.body.title.trim()
      const teams = await db.query<{ id: string; is_private: boolean }>(
        'SELECT id, is_private FROM teams WHERE id = $1',
        [teamId],
      )
      const team = teams[0]
      const home: PermissionTarget | null = team
        ? { team: { id: team.id, isPrivate: team.is_private } }
        : null
      if (!home || !decide(principal, 'record.create', home).allowed) {
        return reply.code(403).send({ error: 'forbidden' })
      }
      const type = (await loadTypes()).get(typeKey)
      if (!type) return reply.code(400).send({ error: 'unknown_type' })
      if (title === '') return reply.code(400).send({ error: 'title_required' })
      const check = checkRecordValues(type, values)
      if (!check.ok) return reply.code(400).send({ error: check.error, field: check.field })
      const id = `rec-${randomUUID()}`
      await db.transaction(async (tx) => {
        await tx.query(
          'INSERT INTO records (id, type_key, team_id, title, values, created_by) VALUES ($1, $2, $3, $4, $5::jsonb, $6)',
          [id, typeKey, teamId, title, JSON.stringify(check.values), principal.id],
        )
        await tx.query(
          "INSERT INTO record_events (record_id, actor_id, action, changes) VALUES ($1, $2, 'created', $3::jsonb)",
          [id, principal.id, JSON.stringify(recordChanges({}, { title, ...check.values }))],
        )
      })
      const row = await loadVisibleRecord(principal, id)
      return row ? detail(principal, row) : reply.code(404).send({ error: 'not_found' })
    },
  )

  app.patch<{
    Params: { id: string }
    Body: { title?: string; values?: Record<string, RecordValue> }
  }>(
    '/records/:id',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          minProperties: 1,
          properties: {
            title: { type: 'string', minLength: 1, maxLength: 300 },
            values: valuesSchema,
          },
        },
      },
    },
    async (request, reply) => {
      const principal = await resolvePrincipal(db, request, devAuth)
      if (!principal) return reply.code(401).send({ error: 'unauthenticated' })
      const row = await loadVisibleRecord(principal, request.params.id)
      if (!row) return reply.code(404).send({ error: 'not_found' })
      if (!decide(principal, 'record.edit', homeOf(row)).allowed) {
        return reply.code(403).send({ error: 'forbidden' })
      }
      if (row.archived_at !== null) return reply.code(409).send({ error: 'archived' })
      const type = (await loadTypes()).get(row.type_key)
      if (!type) return reply.code(409).send({ error: 'unknown_type' })
      const check = checkRecordValues(type, request.body.values ?? {}, row.values)
      if (!check.ok) return reply.code(400).send({ error: check.error, field: check.field })
      const title = request.body.title?.trim() ?? row.title
      if (title === '') return reply.code(400).send({ error: 'title_required' })
      const changes = recordChanges({ title: row.title, ...row.values }, { title, ...check.values })
      if (changes.length > 0) {
        await db.transaction(async (tx) => {
          await tx.query(
            'UPDATE records SET title = $2, values = $3::jsonb, updated_at = now() WHERE id = $1',
            [row.id, title, JSON.stringify(check.values)],
          )
          await tx.query(
            "INSERT INTO record_events (record_id, actor_id, action, changes) VALUES ($1, $2, 'edited', $3::jsonb)",
            [row.id, principal.id, JSON.stringify(changes)],
          )
        })
      }
      const updated = await loadVisibleRecord(principal, row.id)
      return updated ? detail(principal, updated) : reply.code(404).send({ error: 'not_found' })
    },
  )

  app.post<{ Params: { id: string } }>('/records/:id/archive', async (request, reply) => {
    const principal = await resolvePrincipal(db, request, devAuth)
    if (!principal) return reply.code(401).send({ error: 'unauthenticated' })
    const row = await loadVisibleRecord(principal, request.params.id)
    if (!row) return reply.code(404).send({ error: 'not_found' })
    if (!decide(principal, 'record.archive', homeOf(row)).allowed) {
      return reply.code(403).send({ error: 'forbidden' })
    }
    if (row.archived_at !== null) return reply.code(409).send({ error: 'archived' })
    await db.transaction(async (tx) => {
      await tx.query('UPDATE records SET archived_at = now() WHERE id = $1', [row.id])
      await tx.query(
        "INSERT INTO record_events (record_id, actor_id, action) VALUES ($1, $2, 'archived')",
        [row.id, principal.id],
      )
    })
    const updated = await loadVisibleRecord(principal, row.id)
    return updated ? detail(principal, updated) : reply.code(404).send({ error: 'not_found' })
  })

  /** The record an item is about, if the caller may see it (default 2). */
  app.get<{ Params: { id: string } }>('/items/:id/record', async (request, reply) => {
    const principal = await resolvePrincipal(db, request, devAuth)
    if (!principal) return reply.code(401).send({ error: 'unauthenticated' })
    const item = await loadVisibleItemIn(db, principal, request.params.id)
    if (!item) return reply.code(404).send({ error: 'not_found' })
    const links = await db.query<{ record_id: string | null }>(
      'SELECT record_id FROM work_items WHERE id = $1',
      [item.id],
    )
    const recordId = links[0]?.record_id ?? null
    const row = recordId ? await loadVisibleRecord(principal, recordId) : null
    const types = await loadTypes()
    return {
      record: row ? summary(row) : null,
      type: row ? (types.get(row.type_key) ?? null) : null,
      canLink: decide(principal, 'item.edit', targetOf(item)).allowed,
    }
  })
}

/**
 * Checks a link from an item to a record (rule 5): the record must exist, be visible to the
 * caller and not be archived. Returns false otherwise, without saying which.
 */
export async function canLinkRecord(
  db: Db,
  principal: UserPrincipal,
  recordId: string,
): Promise<boolean> {
  const rows = await db.query<{ team_id: string; is_private: boolean; archived_at: unknown }>(
    'SELECT r.team_id, t.is_private, r.archived_at FROM records r JOIN teams t ON t.id = r.team_id WHERE r.id = $1',
    [recordId],
  )
  const row = rows[0]
  return (
    row !== undefined &&
    row.archived_at === null &&
    decide(principal, 'item.view', { team: { id: row.team_id, isPrivate: row.is_private } }).allowed
  )
}
