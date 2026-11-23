/**
 * Full export (WP-BRIEF-002, Quality and safety net): an org admin can download everything,
 * at any time, as JSON (all tables) or the items as CSV. Attachment bytes stay in storage;
 * the export lists them.
 */
import type { FastifyInstance } from 'fastify'
import type { Db } from '../db/db.js'
import { resolvePrincipal } from '../principal.js'
import { audit } from './items.js'

const TABLES = [
  'users',
  'teams',
  'team_members',
  'stages',
  'stage_transitions',
  'projects',
  'milestones',
  'work_items',
  'stage_history',
  'comments',
  'review_rounds',
  'review_reviewers',
  'review_verdicts',
  'item_schedules',
  'item_runs',
  'attachments',
  'field_defs',
  'team_field_settings',
  'intake_forms',
  'requests',
] as const

function csvCell(value: unknown): string {
  const text =
    value === null || value === undefined
      ? ''
      : value instanceof Date
        ? value.toISOString()
        : typeof value === 'object'
          ? JSON.stringify(value)
          : String(value)
  // Cells that start like a formula are prefixed so spreadsheets do not run them.
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

export function registerExportRoutes(
  app: FastifyInstance,
  { db, devAuth }: { db: Db; devAuth: boolean },
): void {
  app.get<{ Querystring: { format?: 'json' | 'csv' } }>(
    '/core/export',
    {
      schema: {
        querystring: {
          type: 'object',
          properties: { format: { type: 'string', enum: ['json', 'csv'] } },
        },
      },
    },
    async (request, reply) => {
      const principal = await resolvePrincipal(db, request, devAuth)
      if (!principal) return reply.code(401).send({ error: 'unauthenticated' })
      if (principal.orgRole !== 'org_admin') return reply.code(403).send({ error: 'forbidden' })
      const stamp = new Date().toISOString().slice(0, 10)
      await audit(db, principal, 'item.export', null, null, {
        format: request.query.format ?? 'json',
      })
      if (request.query.format === 'csv') {
        const rows = await db.query<Record<string, unknown>>(
          `SELECT w.key, w.title, w.team_id AS team, s.name AS stage, s.stage_type, w.assignee_id AS owner,
             w.fields->>'priority' AS priority, w.due_on, w.estimate, array_to_string(w.labels, ';') AS labels,
             p.name AS project, m.name AS milestone, parent.key AS parent, w.description, w.created_at, w.updated_at, w.deleted_at
           FROM work_items w JOIN stages s ON s.team_id = w.team_id AND s.key = w.status_id
           LEFT JOIN projects p ON p.id = w.project_id LEFT JOIN milestones m ON m.id = w.milestone_id
           LEFT JOIN work_items parent ON parent.id = w.parent_id ORDER BY w.team_id, w.seq`,
        )
        const head = rows[0] ? Object.keys(rows[0]) : ['key']
        const body = [
          head.join(','),
          ...rows.map((r) => head.map((h) => csvCell(r[h])).join(',')),
        ].join('\r\n')
        return reply
          .header('content-type', 'text/csv; charset=utf-8')
          .header('content-disposition', `attachment; filename="work-platform-items-${stamp}.csv"`)
          .send(`\uFEFF${body}`)
      }
      const data: Record<string, unknown[]> = {}
      for (const table of TABLES) data[table] = await db.query(`SELECT * FROM ${table}`)
      return reply
        .header('content-disposition', `attachment; filename="work-platform-export-${stamp}.json"`)
        .send({ exportedAt: new Date().toISOString(), schema: 'work-platform/1', tables: data })
    },
  )
}
