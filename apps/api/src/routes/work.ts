/**
 * Working together (phase 3): recurring schedules and runs, item descriptions, attachments and
 * search. Comments, mentions, the inbox and reviews already have their own routes.
 */
import { randomUUID } from 'node:crypto'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import {
  checkRule,
  decide,
  describeRule,
  DEFAULT_TZ,
  MODEL_LIMITS,
  nextRunAfter,
  type ScheduleRule,
  type UserPrincipal,
} from '@wm/shared'
import type { Db } from '../db/db.js'
import { ALLOWED_TYPES, type FileStore } from '../files.js'
import { resolvePrincipal } from '../principal.js'
import { startRun } from '../runs.js'
import { audit, iso } from './items.js'

interface ItemAccess {
  id: string
  key: string
  team_id: string
  is_private: boolean
}

export function registerWorkRoutes(
  app: FastifyInstance,
  { db, devAuth, files }: { db: Db; devAuth: boolean; files: FileStore },
): void {
  app.addContentTypeParser(
    'application/octet-stream',
    { parseAs: 'buffer', bodyLimit: MODEL_LIMITS.attachmentBytes },
    (_req, body, done) => done(null, body),
  )

  async function access(
    request: FastifyRequest,
    reply: FastifyReply,
    idOrKey: string,
    action: Parameters<typeof decide>[1] | null,
  ): Promise<{ principal: UserPrincipal; item: ItemAccess } | null> {
    const principal = await resolvePrincipal(db, request, devAuth)
    if (!principal) {
      void reply.code(401).send({ error: 'unauthenticated' })
      return null
    }
    const [item] = await db.query<ItemAccess>(
      `SELECT w.id, w.key, w.team_id, t.is_private FROM work_items w JOIN teams t ON t.id = w.team_id
       WHERE (w.id = $1 OR w.key = $1) AND w.deleted_at IS NULL`,
      [idOrKey],
    )
    const team = item ? { id: item.team_id, isPrivate: item.is_private } : null
    if (!item || !team || !decide(principal, 'item.view', { team }).allowed) {
      void reply.code(404).send({ error: 'not_found' })
      return null
    }
    if (action && !decide(principal, action, { team }).allowed) {
      void reply.code(403).send({ error: 'forbidden' })
      return null
    }
    return { principal, item }
  }

  /* ---------- Description ---------- */

  app.put<{ Params: { id: string }; Body: { description: string } }>(
    '/core/items/:id/description',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['description'],
          properties: { description: { type: 'string', maxLength: 20000 } },
        },
      },
    },
    async (request, reply) => {
      const ok = await access(request, reply, request.params.id, 'item.edit')
      if (!ok) return
      const text = request.body.description.trim()
      await db.query('UPDATE work_items SET description = $2, updated_at = now() WHERE id = $1', [
        ok.item.id,
        text || null,
      ])
      return { description: text || null }
    },
  )

  app.get<{ Params: { id: string } }>('/core/items/:id/description', async (request, reply) => {
    const ok = await access(request, reply, request.params.id, null)
    if (!ok) return
    const [row] = await db.query<{ description: string | null }>(
      'SELECT description FROM work_items WHERE id = $1',
      [ok.item.id],
    )
    return { description: row?.description ?? null }
  })

  /* ---------- Schedules and runs ---------- */

  app.get<{ Params: { id: string } }>('/core/items/:id/runs', async (request, reply) => {
    const ok = await access(request, reply, request.params.id, null)
    if (!ok) return
    const [schedule] = await db.query<{
      rule: ScheduleRule
      start_stage: string
      owner_id: string | null
      tz: string
      next_at: Date | string
      pending_start: boolean
    }>(
      'SELECT rule, start_stage, owner_id, tz, next_at, pending_start FROM item_schedules WHERE item_id = $1',
      [ok.item.id],
    )
    const runs = await db.query<{
      number: number
      started_at: Date | string
      started_by: string
      starter_id: string | null
      start_stage: string
      ended_at: Date | string | null
      outcome: string | null
      field_values: Record<string, unknown> | null
    }>(
      'SELECT number, started_at, started_by, starter_id, start_stage, ended_at, outcome, field_values FROM item_runs WHERE item_id = $1 ORDER BY number DESC',
      [ok.item.id],
    )
    const passes = await db.query<{
      run_number: number
      stage_key: string
      owner_id: string | null
      entered_at: Date | string
      left_at: Date | string | null
    }>(
      'SELECT run_number, stage_key, owner_id, entered_at, left_at FROM stage_history WHERE item_id = $1 AND run_number IS NOT NULL ORDER BY seq',
      [ok.item.id],
    )
    const comments = await db.query<{ run_number: number; n: number }>(
      'SELECT run_number, count(*)::int AS n FROM comments WHERE item_id = $1 AND run_number IS NOT NULL AND deleted_at IS NULL GROUP BY run_number',
      [ok.item.id],
    )
    return {
      schedule: schedule
        ? {
            rule: schedule.rule,
            text: describeRule(schedule.rule),
            startStage: schedule.start_stage,
            ownerId: schedule.owner_id,
            tz: schedule.tz,
            nextAt: iso(schedule.next_at),
            waitingForOpenRun: schedule.pending_start,
          }
        : null,
      runs: runs.map((r) => ({
        number: r.number,
        startedAt: iso(r.started_at),
        startedBy: r.started_by,
        starterId: r.starter_id,
        startStage: r.start_stage,
        endedAt: r.ended_at ? iso(r.ended_at) : null,
        outcome: r.outcome,
        fieldValues: r.field_values,
        passes: passes
          .filter((p) => p.run_number === r.number)
          .map((p) => ({
            stageKey: p.stage_key,
            ownerId: p.owner_id,
            enteredAt: iso(p.entered_at),
            leftAt: p.left_at ? iso(p.left_at) : null,
          })),
        comments: comments.find((c) => c.run_number === r.number)?.n ?? 0,
      })),
    }
  })

  app.put<{
    Params: { id: string }
    Body: { rule: ScheduleRule | null; startStage?: string; ownerId?: string | null }
  }>(
    '/core/items/:id/schedule',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['rule'],
          properties: {
            rule: { type: ['object', 'null'] },
            startStage: { type: 'string', maxLength: 64 },
            ownerId: { type: ['string', 'null'], maxLength: 64 },
          },
        },
      },
    },
    async (request, reply) => {
      const ok = await access(request, reply, request.params.id, 'item.edit')
      if (!ok) return
      const { rule, startStage, ownerId = null } = request.body
      if (rule === null) {
        await db.query('DELETE FROM item_schedules WHERE item_id = $1', [ok.item.id])
        await audit(db, ok.principal, 'item.schedule.clear', ok.item.team_id, ok.item.id)
        return { schedule: null }
      }
      const problem = checkRule(rule)
      if (problem) return reply.code(400).send({ error: problem })
      const [stage] = await db.query('SELECT 1 FROM stages WHERE team_id = $1 AND key = $2', [
        ok.item.team_id,
        startStage ?? '',
      ])
      if (!stage) return reply.code(400).send({ error: 'unknown_stage' })
      const nextAt = nextRunAfter(rule, new Date(), DEFAULT_TZ)
      await db.query(
        `INSERT INTO item_schedules (item_id, rule, start_stage, owner_id, next_at, created_by) VALUES ($1, $2::jsonb, $3, $4, $5, $6)
         ON CONFLICT (item_id) DO UPDATE SET rule = EXCLUDED.rule, start_stage = EXCLUDED.start_stage,
           owner_id = EXCLUDED.owner_id, next_at = EXCLUDED.next_at`,
        [ok.item.id, JSON.stringify(rule), startStage, ownerId, nextAt, ok.principal.id],
      )
      await audit(db, ok.principal, 'item.schedule.set', ok.item.team_id, ok.item.id, { rule })
      return {
        schedule: {
          rule,
          text: describeRule(rule),
          startStage,
          ownerId,
          nextAt: nextAt.toISOString(),
        },
      }
    },
  )

  app.post<{ Params: { id: string }; Body: { startStage?: string } }>(
    '/core/items/:id/runs',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          properties: { startStage: { type: 'string', maxLength: 64 } },
        },
      },
    },
    async (request, reply) => {
      const ok = await access(request, reply, request.params.id, 'item.transition')
      if (!ok) return
      const [schedule] = await db.query<{ start_stage: string; owner_id: string | null }>(
        'SELECT start_stage, owner_id FROM item_schedules WHERE item_id = $1',
        [ok.item.id],
      )
      const startStage = request.body?.startStage ?? schedule?.start_stage
      if (!startStage) return reply.code(400).send({ error: 'start_stage_required' })
      const result = await startRun(
        db,
        ok.item.id,
        'manual',
        ok.principal.id,
        startStage,
        schedule?.owner_id ?? undefined,
      )
      if (!result.ok)
        return reply.code(result.error === 'run_open' ? 409 : 400).send({ error: result.error })
      await db.query('UPDATE item_schedules SET pending_start = false WHERE item_id = $1', [
        ok.item.id,
      ])
      return reply.code(201).send({ number: result.number })
    },
  )

  /* ---------- Attachments ---------- */

  app.get<{ Params: { id: string } }>('/core/items/:id/attachments', async (request, reply) => {
    const ok = await access(request, reply, request.params.id, null)
    if (!ok) return
    const rows = await db.query<{
      id: string
      name: string
      content_type: string
      size_bytes: number
      uploaded_by: string
      created_at: Date | string
    }>(
      'SELECT id, name, content_type, size_bytes, uploaded_by, created_at FROM attachments WHERE item_id = $1 AND deleted_at IS NULL ORDER BY created_at',
      [ok.item.id],
    )
    return {
      attachments: rows.map((a) => ({
        id: a.id,
        name: a.name,
        contentType: a.content_type,
        size: a.size_bytes,
        uploadedBy: a.uploaded_by,
        createdAt: iso(a.created_at),
      })),
    }
  })

  app.post<{ Params: { id: string }; Querystring: { name: string; type: string }; Body: Buffer }>(
    '/core/items/:id/attachments',
    {
      bodyLimit: MODEL_LIMITS.attachmentBytes,
      schema: {
        querystring: {
          type: 'object',
          required: ['name', 'type'],
          properties: {
            name: { type: 'string', minLength: 1, maxLength: 200 },
            type: { type: 'string', maxLength: 120 },
          },
        },
      },
    },
    async (request, reply) => {
      const ok = await access(request, reply, request.params.id, 'attachment.add')
      if (!ok) return
      const bytes = request.body
      if (!Buffer.isBuffer(bytes) || bytes.length === 0)
        return reply.code(400).send({ error: 'empty_file' })
      if (bytes.length > MODEL_LIMITS.attachmentBytes)
        return reply.code(413).send({ error: 'file_too_large' })
      const type = request.query.type
      if (!ALLOWED_TYPES.has(type)) return reply.code(400).send({ error: 'file_type_not_allowed' })
      // Slashes and control characters never reach a file name.
      // eslint-disable-next-line no-control-regex
      const name = request.query.name.replace(/[\\/\u0000-\u001f]/g, '_').trim() || 'file'
      const id = randomUUID()
      const key = `${ok.item.team_id}/${ok.item.id}/${id}`
      await files.put(key, bytes, type)
      await db.query(
        'INSERT INTO attachments (id, item_id, name, content_type, size_bytes, storage_key, uploaded_by) VALUES ($1, $2, $3, $4, $5, $6, $7)',
        [id, ok.item.id, name, type, bytes.length, key, ok.principal.id],
      )
      return reply.code(201).send({ id, name, contentType: type, size: bytes.length })
    },
  )

  app.get<{ Params: { id: string } }>('/core/attachments/:id/content', async (request, reply) => {
    const [row] = await db.query<{
      item_id: string
      name: string
      content_type: string
      storage_key: string
    }>(
      'SELECT item_id, name, content_type, storage_key FROM attachments WHERE id = $1 AND deleted_at IS NULL',
      [request.params.id],
    )
    if (!row) return reply.code(404).send({ error: 'not_found' })
    const ok = await access(request, reply, row.item_id, null)
    if (!ok) return
    const bytes = await files.get(row.storage_key)
    if (!bytes) return reply.code(404).send({ error: 'not_found' })
    // Files are always downloaded, never shown inline, so a file cannot run script on our site.
    return reply
      .header('content-type', row.content_type)
      .header('content-disposition', `attachment; filename*=UTF-8''${encodeURIComponent(row.name)}`)
      .header('x-content-type-options', 'nosniff')
      .send(bytes)
  })

  app.delete<{ Params: { id: string } }>('/core/attachments/:id', async (request, reply) => {
    const [row] = await db.query<{ item_id: string; uploaded_by: string }>(
      'SELECT item_id, uploaded_by FROM attachments WHERE id = $1 AND deleted_at IS NULL',
      [request.params.id],
    )
    if (!row) return reply.code(404).send({ error: 'not_found' })
    const ok = await access(request, reply, row.item_id, null)
    if (!ok) return
    const team = { id: ok.item.team_id, isPrivate: ok.item.is_private }
    if (
      row.uploaded_by !== ok.principal.id &&
      !decide(ok.principal, 'attachment.delete', { team }).allowed
    ) {
      return reply.code(403).send({ error: 'forbidden' })
    }
    await db.query('UPDATE attachments SET deleted_at = now() WHERE id = $1', [request.params.id])
    return { ok: true }
  })

  /* ---------- Search ---------- */

  app.get<{ Querystring: { q: string } }>(
    '/core/search',
    {
      schema: {
        querystring: {
          type: 'object',
          required: ['q'],
          properties: { q: { type: 'string', minLength: 1, maxLength: 200 } },
        },
      },
    },
    async (request, reply) => {
      const principal = await resolvePrincipal(db, request, devAuth)
      if (!principal) return reply.code(401).send({ error: 'unauthenticated' })
      const teams = await db.query<{ id: string; is_private: boolean }>(
        'SELECT id, is_private FROM teams',
      )
      const visible = teams
        .filter(
          (t) =>
            decide(principal, 'item.view', { team: { id: t.id, isPrivate: t.is_private } }).allowed,
        )
        .map((t) => t.id)
      const q = request.query.q.trim()
      const words = q
        .split(/\s+/)
        .map((w) => w.replace(/[^\p{L}\p{N}]/gu, ''))
        .filter(Boolean)
      if (words.length === 0) return { results: [] }
      const tsq = words.map((w) => `${w}:*`).join(' & ')
      const rows = await db.query<{
        id: string
        key: string
        title: string
        team_id: string
        status_id: string
        matched: string
        snippet: string | null
      }>(
        `WITH hits AS (
           SELECT w.id, 'title' AS matched, NULL::text AS snippet, 2 AS rank FROM work_items w
            WHERE w.deleted_at IS NULL AND w.team_id = ANY($2)
              AND (to_tsvector('simple', w.title || ' ' || coalesce(w.description, '')) @@ to_tsquery('simple', $1) OR w.key ILIKE $3)
           UNION ALL
           SELECT c.item_id, 'comment', left(c.body, 160), 1 FROM comments c JOIN work_items w ON w.id = c.item_id
            WHERE c.deleted_at IS NULL AND w.deleted_at IS NULL AND w.team_id = ANY($2) AND NOT c.internal
              AND to_tsvector('simple', c.body) @@ to_tsquery('simple', $1)
         )
         SELECT DISTINCT ON (w.id) w.id, w.key, w.title, w.team_id, w.status_id, h.matched, h.snippet
         FROM hits h JOIN work_items w ON w.id = h.id
         ORDER BY w.id, h.rank DESC
         LIMIT 20`,
        [tsq, visible, q],
      )
      return {
        results: rows.map((r) => ({
          id: r.id,
          key: r.key,
          title: r.title,
          teamId: r.team_id,
          stageKey: r.status_id,
          matched: r.matched,
          snippet: r.snippet,
        })),
      }
    },
  )
}
