/**
 * Status that follows the code (specs/code-status.md). The code host is not a person: it can
 * only deliver signed events, and what an event may do is fixed by the team's code rules and
 * the stage rules in specs/workflow.md (never forced).
 */
import { createHmac, timingSafeEqual } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import {
  checkMove,
  CODE_EVENT_KINDS,
  decide,
  describeCodeEvent,
  extractItemKeys,
  fromGitHub,
  type CodeEvent,
  type CodeEventKind,
  type TeamRef,
} from '@wm/shared'
import type { Db } from '../db/db.js'
import { resolvePrincipal } from '../principal.js'
import { iso, ITEM_COLUMNS, loadVisibleItemIn, loadWorkflow, type ItemRow } from './items.js'

/** The audit log names the code host this way; it is never a user id. */
export const CODE_HOST_ACTOR = 'integration:github'

const STATE_FOR: Partial<Record<CodeEventKind, 'open' | 'merged' | 'closed'>> = {
  pr_opened: 'open',
  pr_merged: 'merged',
  pr_closed: 'closed',
}
const CHECKS_FOR: Partial<Record<CodeEventKind, 'passing' | 'failing'>> = {
  checks_passed: 'passing',
  checks_failed: 'failing',
}

/** Rule 1: a GitHub-style `sha256=<hex>` HMAC of the exact body, compared in constant time. */
export function signatureMatches(secret: string, rawBody: string, header: unknown): boolean {
  if (typeof header !== 'string' || !header.startsWith('sha256=')) return false
  const expected = Buffer.from(
    `sha256=${createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex')}`,
  )
  const given = Buffer.from(header)
  return given.length === expected.length && timingSafeEqual(given, expected)
}

type Outcome = { item: string; outcome: 'moved' | 'not_moved' | 'no_rule'; detail: string | null }

/** Applies one code event to one item (rules 3 to 6 and 8). */
async function applyToItem(db: Db, event: CodeEvent, row: ItemRow): Promise<Outcome> {
  const state = STATE_FOR[event.kind] ?? null
  const checks = CHECKS_FOR[event.kind] ?? null
  await db.query(
    `INSERT INTO code_links (item_id, repo, pr_number, url, title, state, checks)
     VALUES ($1, $2, $3, $4, $5, COALESCE($6, 'open'), $7)
     ON CONFLICT (item_id, repo, pr_number) DO UPDATE SET
       url = COALESCE(EXCLUDED.url, code_links.url),
       title = COALESCE(EXCLUDED.title, code_links.title),
       state = COALESCE($6, code_links.state),
       checks = COALESCE($7, code_links.checks),
       updated_at = now()`,
    [row.id, event.repo, event.prNumber, event.prUrl, event.prTitle, state, checks],
  )

  const record = async (outcome: Outcome['outcome'], detail: string | null): Promise<Outcome> => {
    await db.query(
      'INSERT INTO code_events (item_id, repo, pr_number, kind, outcome, detail) VALUES ($1, $2, $3, $4, $5, $6)',
      [row.id, event.repo, event.prNumber, event.kind, outcome, detail],
    )
    return { item: row.key, outcome, detail }
  }

  const rules = await db.query<{ stage_key: string }>(
    'SELECT stage_key FROM code_rules WHERE team_id = $1 AND event_kind = $2',
    [row.team_id, event.kind],
  )
  const to = rules[0]?.stage_key
  if (!to) return record('no_rule', null)
  if (to === row.status_id) return record('not_moved', 'already in that stage')

  const reason = describeCodeEvent(event)
  const workflow = await loadWorkflow(db, row)
  const check = checkMove({
    stages: workflow.stages,
    transitions: workflow.transitions,
    fromKey: row.status_id,
    toKey: to,
    missing: workflow.missing,
    force: false,
    canForce: false,
    reason,
  })
  if (!check.ok) {
    const detail =
      check.error === 'requirements_unmet'
        ? `still needs: ${(check.missing ?? []).join(', ')}`
        : check.error === 'not_allowed'
          ? 'that stage cannot be reached from here'
          : check.error
    return record('not_moved', detail)
  }
  const stage = workflow.stages.find((s) => s.key === to)
  const teams = await db.query<{ hand_off_clears_owner: boolean }>(
    'SELECT hand_off_clears_owner FROM teams WHERE id = $1',
    [row.team_id],
  )
  const owner = teams[0]?.hand_off_clears_owner ? null : row.assignee_id
  await db.transaction(async (tx) => {
    await tx.query(
      `UPDATE work_items SET status_id = $2, status_category = $3, assignee_id = $4,
       updated_at = now() WHERE id = $1`,
      [row.id, to, stage?.category, owner],
    )
    await tx.query(
      'UPDATE stage_history SET left_at = now() WHERE item_id = $1 AND left_at IS NULL',
      [row.id],
    )
    await tx.query(
      `INSERT INTO stage_history (item_id, stage_key, owner_id, moved_by, kind, reason)
       VALUES ($1, $2, $3, NULL, 'automatic', $4)`,
      [row.id, to, owner, reason],
    )
    // Leaving a stage closes an open review round (specs/reviews.md, rule 8).
    await tx.query(
      "UPDATE review_rounds SET state = 'withdrawn', closed_at = now() WHERE item_id = $1 AND state = 'open'",
      [row.id],
    )
    await tx.query(
      'INSERT INTO audit_log (actor_id, action, team_id, object_id, detail) VALUES ($1, $2, $3, $4, $5::jsonb)',
      [
        CODE_HOST_ACTOR,
        'item.automaticMove',
        row.team_id,
        row.id,
        JSON.stringify({ from: row.status_id, to, reason, repo: event.repo, pr: event.prNumber }),
      ],
    )
  })
  return record('moved', reason)
}

export function registerCodeRoutes(
  app: FastifyInstance,
  { db, devAuth, webhookSecret }: { db: Db; devAuth: boolean; webhookSecret?: string | undefined },
): void {
  // The webhook needs the exact bytes that were signed, so it parses its own body.
  void app.register(async (scope) => {
    scope.addContentTypeParser(
      'application/json',
      { parseAs: 'string', bodyLimit: 1_000_000 },
      (_request, body, done) => done(null, body),
    )
    scope.post('/integrations/github', async (request, reply) => {
      if (!webhookSecret) return reply.code(404).send({ error: 'not_found' })
      const raw = typeof request.body === 'string' ? request.body : ''
      if (!signatureMatches(webhookSecret, raw, request.headers['x-hub-signature-256'])) {
        return reply.code(401).send({ error: 'bad_signature' })
      }
      let payload: unknown
      try {
        payload = JSON.parse(raw)
      } catch {
        return reply.code(400).send({ error: 'invalid_json' })
      }
      const name = request.headers['x-github-event']
      const events = fromGitHub(typeof name === 'string' ? name : '', payload)
      const results: Outcome[] = []
      for (const event of events) {
        // Items named in the branch or title, plus items already linked to this pull request.
        const keys = extractItemKeys(event.branch, event.prTitle)
        const rows = await db.query<ItemRow>(
          `SELECT ${ITEM_COLUMNS} FROM work_items w JOIN teams t ON t.id = w.team_id
           WHERE w.deleted_at IS NULL AND (
             upper(w.key) = ANY($1::text[]) OR w.id IN (
               SELECT item_id FROM code_links WHERE repo = $2 AND pr_number = $3))
           ORDER BY w.seq LIMIT 10`,
          [keys, event.repo, event.prNumber],
        )
        for (const row of rows) results.push(await applyToItem(db, event, row))
      }
      return { received: events.length, results }
    })
  })

  /** Pull requests and code events for one item, for people who may see it. */
  app.get<{ Params: { id: string } }>('/items/:id/code', async (request, reply) => {
    const principal = await resolvePrincipal(db, request, devAuth)
    if (!principal) return reply.code(401).send({ error: 'unauthenticated' })
    const row = await loadVisibleItemIn(db, principal, request.params.id)
    if (!row) return reply.code(404).send({ error: 'not_found' })
    const links = await db.query<{
      repo: string
      pr_number: number
      url: string | null
      title: string | null
      state: string
      checks: string | null
      updated_at: Date | string
    }>(
      'SELECT repo, pr_number, url, title, state, checks, updated_at FROM code_links WHERE item_id = $1 ORDER BY updated_at DESC',
      [row.id],
    )
    const events = await db.query<{
      repo: string
      pr_number: number
      kind: string
      outcome: string
      detail: string | null
      at: Date | string
    }>(
      'SELECT repo, pr_number, kind, outcome, detail, at FROM code_events WHERE item_id = $1 ORDER BY seq DESC LIMIT 20',
      [row.id],
    )
    return {
      pullRequests: links.map((l) => ({
        repo: l.repo,
        number: l.pr_number,
        url: l.url,
        title: l.title,
        state: l.state,
        checks: l.checks,
        updatedAt: iso(l.updated_at),
      })),
      events: events.map((e) => ({
        repo: e.repo,
        number: e.pr_number,
        kind: e.kind,
        outcome: e.outcome,
        detail: e.detail,
        at: iso(e.at),
      })),
    }
  })

  /** A team's code rules (rule 9: team configuration). */
  app.get<{ Params: { teamId: string } }>('/teams/:teamId/code-rules', async (request, reply) => {
    const principal = await resolvePrincipal(db, request, devAuth)
    if (!principal) return reply.code(401).send({ error: 'unauthenticated' })
    const team = await loadTeam(request.params.teamId)
    if (!team || !decide(principal, 'item.view', { team }).allowed) {
      return reply.code(404).send({ error: 'not_found' })
    }
    return { rules: await rulesOf(team.id) }
  })

  app.put<{ Params: { teamId: string }; Body: { rules: Record<string, string | null> } }>(
    '/teams/:teamId/code-rules',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['rules'],
          properties: {
            rules: {
              type: 'object',
              propertyNames: { enum: [...CODE_EVENT_KINDS] },
              additionalProperties: { type: ['string', 'null'], maxLength: 64 },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const principal = await resolvePrincipal(db, request, devAuth)
      if (!principal) return reply.code(401).send({ error: 'unauthenticated' })
      const team = await loadTeam(request.params.teamId)
      if (!team || !decide(principal, 'item.view', { team }).allowed) {
        return reply.code(404).send({ error: 'not_found' })
      }
      if (!decide(principal, 'team.config.edit', { team }).allowed) {
        return reply.code(403).send({ error: 'forbidden' })
      }
      const stages = new Set(
        (
          await db.query<{ key: string }>('SELECT key FROM stages WHERE team_id = $1', [team.id])
        ).map((s) => s.key),
      )
      const entries = Object.entries(request.body.rules)
      if (entries.some(([, stage]) => stage !== null && !stages.has(stage))) {
        return reply.code(400).send({ error: 'unknown_stage' })
      }
      await db.transaction(async (tx) => {
        for (const [kind, stage] of entries) {
          await tx.query('DELETE FROM code_rules WHERE team_id = $1 AND event_kind = $2', [
            team.id,
            kind,
          ])
          if (stage !== null) {
            await tx.query(
              'INSERT INTO code_rules (team_id, event_kind, stage_key) VALUES ($1, $2, $3)',
              [team.id, kind, stage],
            )
          }
        }
      })
      return { rules: await rulesOf(team.id) }
    },
  )

  async function loadTeam(teamId: string): Promise<TeamRef | null> {
    const rows = await db.query<{ id: string; is_private: boolean }>(
      'SELECT id, is_private FROM teams WHERE id = $1',
      [teamId],
    )
    const row = rows[0]
    return row ? { id: row.id, isPrivate: row.is_private } : null
  }

  async function rulesOf(teamId: string): Promise<Record<string, string>> {
    const rows = await db.query<{ event_kind: string; stage_key: string }>(
      'SELECT event_kind, stage_key FROM code_rules WHERE team_id = $1',
      [teamId],
    )
    return Object.fromEntries(rows.map((r) => [r.event_kind, r.stage_key]))
  }
}
