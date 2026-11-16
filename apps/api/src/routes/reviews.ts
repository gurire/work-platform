/**
 * Review rounds (specs/reviews.md). Every check goes through `decide`; hidden items are 404.
 */
import type { FastifyInstance } from 'fastify'
import {
  checkReviewers,
  decide,
  isValidSendBack,
  MAX_REVIEWERS,
  roundOutcome,
  type RoundState,
  type UserPrincipal,
  type Verdict,
} from '@wm/shared'
import type { Db, Queryable } from '../db/db.js'
import { notify } from '../inbox.js'
import { loadUserPrincipal, resolvePrincipal } from '../principal.js'
import { iso, loadVisibleItemIn, loadWorkflow, targetOf, type ItemRow } from './items.js'

interface RoundRow {
  id: string
  item_id: string
  number: number
  history_seq: string
  stage_key: string
  requested_by: string
  opened_at: Date | string
  state: RoundState
  closed_at: Date | string | null
  closed_by: string | null
}

const ROUND_COLUMNS =
  'id, item_id, number, history_seq, stage_key, requested_by, opened_at, state, closed_at, closed_by'

/** Each reviewer's latest verdict in a round: the one that counts (rule 10). */
async function latestVerdicts(db: Queryable, roundId: string): Promise<Map<string, Verdict>> {
  const rows = await db.query<{ user_id: string; verdict: Verdict }>(
    'SELECT user_id, verdict FROM review_verdicts WHERE round_id = $1 ORDER BY seq',
    [roundId],
  )
  return new Map(rows.map((row) => [row.user_id, row.verdict]))
}

async function reviewersOf(db: Queryable, roundId: string): Promise<string[]> {
  const rows = await db.query<{ user_id: string }>(
    'SELECT user_id FROM review_reviewers WHERE round_id = $1 ORDER BY user_id',
    [roundId],
  )
  return rows.map((row) => row.user_id)
}

export function registerReviewRoutes(
  app: FastifyInstance,
  { db, devAuth }: { db: Db; devAuth: boolean },
): void {
  /** All rounds of an item, newest first, and what the caller may do now. */
  async function reviewsPayload(principal: UserPrincipal, row: ItemRow) {
    const target = targetOf(row)
    const state = await loadWorkflow(db, row)
    const rounds = await db.query<RoundRow>(
      `SELECT ${ROUND_COLUMNS} FROM review_rounds WHERE item_id = $1 ORDER BY number DESC`,
      [row.id],
    )
    const ids = rounds.map((round) => round.id)
    const reviewers = ids.length
      ? await db.query<{ round_id: string; user_id: string }>(
          'SELECT round_id, user_id FROM review_reviewers WHERE round_id = ANY($1::bigint[]) ORDER BY user_id',
          [ids],
        )
      : []
    const verdicts = ids.length
      ? await db.query<{
          round_id: string
          user_id: string
          verdict: Verdict
          comment: string | null
          at: Date | string
        }>(
          'SELECT round_id, user_id, verdict, comment, at FROM review_verdicts WHERE round_id = ANY($1::bigint[]) ORDER BY seq',
          [ids],
        )
      : []
    const open = rounds.find((round) => round.state === 'open')
    const openReviewers = open
      ? reviewers.filter((r) => r.round_id === open.id).map((r) => r.user_id)
      : []
    return {
      reviewStage: state.review
        ? { stageKey: row.status_id, sendBackTo: state.review.sendBackTo }
        : null,
      approved: state.review?.approved ?? false,
      canOpen:
        state.review !== null &&
        !open &&
        !state.review.approved &&
        decide(principal, 'review.open', target).allowed,
      canVerdict:
        open !== undefined &&
        openReviewers.includes(principal.id) &&
        decide(principal, 'review.verdict', target).allowed,
      canWithdraw:
        open !== undefined &&
        decide(principal, 'review.withdraw', { ...target, createdBy: open.requested_by }).allowed,
      rounds: rounds.map((round) => {
        const mine = verdicts.filter((v) => v.round_id === round.id)
        const latest = new Map(mine.map((v) => [v.user_id, v]))
        return {
          id: String(round.id),
          number: round.number,
          stageKey: round.stage_key,
          requestedBy: round.requested_by,
          openedAt: iso(round.opened_at),
          state: round.state,
          closedAt: round.closed_at ? iso(round.closed_at) : null,
          closedBy: round.closed_by,
          reviewers: reviewers
            .filter((r) => r.round_id === round.id)
            .map((r) => {
              const v = latest.get(r.user_id)
              return {
                userId: r.user_id,
                verdict: v?.verdict ?? null,
                comment: v?.comment ?? null,
                at: v ? iso(v.at) : null,
              }
            }),
          history: mine.map((v) => ({
            userId: v.user_id,
            verdict: v.verdict,
            comment: v.comment,
            at: iso(v.at),
          })),
        }
      }),
    }
  }

  async function loadRound(principal: UserPrincipal, roundId: string) {
    const rounds = await db.query<RoundRow>(
      `SELECT ${ROUND_COLUMNS} FROM review_rounds WHERE id = $1`,
      [roundId],
    )
    const round = rounds[0]
    if (!round) return null
    const row = await loadVisibleItemIn(db, principal, round.item_id)
    return row ? { round, row } : null
  }

  const idParams = {
    type: 'object',
    properties: { id: { type: 'string', pattern: '^[0-9]{1,18}$' } },
    required: ['id'],
  } as const

  app.get<{ Params: { id: string } }>('/items/:id/reviews', async (request, reply) => {
    const principal = await resolvePrincipal(db, request, devAuth)
    if (!principal) return reply.code(401).send({ error: 'unauthenticated' })
    const row = await loadVisibleItemIn(db, principal, request.params.id)
    if (!row) return reply.code(404).send({ error: 'not_found' })
    return reviewsPayload(principal, row)
  })

  /** Open a round with the chosen reviewers (rules 2 and 3, default 1). */
  app.post<{ Params: { id: string }; Body: { reviewers: string[] } }>(
    '/items/:id/reviews',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['reviewers'],
          properties: {
            reviewers: {
              type: 'array',
              minItems: 1,
              maxItems: MAX_REVIEWERS,
              items: { type: 'string', maxLength: 64 },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const principal = await resolvePrincipal(db, request, devAuth)
      if (!principal) return reply.code(401).send({ error: 'unauthenticated' })
      const row = await loadVisibleItemIn(db, principal, request.params.id)
      if (!row) return reply.code(404).send({ error: 'not_found' })
      const target = targetOf(row)
      if (!decide(principal, 'review.open', target).allowed) {
        return reply.code(403).send({ error: 'forbidden' })
      }
      const state = await loadWorkflow(db, row)
      if (!state.review || state.passSeq === null) {
        return reply.code(409).send({ error: 'not_review_stage' })
      }
      if (state.review.approved) return reply.code(409).send({ error: 'already_approved' })

      const candidates = [...new Set(request.body.reviewers)]
      const principals = new Map<string, UserPrincipal>()
      for (const id of candidates) {
        const loaded = await loadUserPrincipal(db, id)
        if (loaded) principals.set(id, loaded)
      }
      const check = checkReviewers({
        reviewers: candidates,
        requesterId: principal.id,
        stageOwnerId: row.assignee_id,
        mayReview: (id) => {
          const who = principals.get(id)
          return who !== undefined && decide(who, 'review.verdict', target).allowed
        },
      })
      if (!check.ok) {
        return reply
          .code(400)
          .send({ error: check.error, ...(check.who ? { who: check.who } : {}) })
      }
      const passSeq = state.passSeq
      try {
        await db.transaction(async (tx) => {
          const next = await tx.query<{ n: number }>(
            'SELECT COALESCE(MAX(number), 0) + 1 AS n FROM review_rounds WHERE item_id = $1',
            [row.id],
          )
          const inserted = await tx.query<{ id: string }>(
            `INSERT INTO review_rounds (item_id, number, history_seq, stage_key, requested_by)
             VALUES ($1, $2, $3, $4, $5) RETURNING id`,
            [row.id, next[0]?.n ?? 1, passSeq, row.status_id, principal.id],
          )
          const roundId = inserted[0]?.id
          for (const reviewer of check.reviewers) {
            await tx.query('INSERT INTO review_reviewers (round_id, user_id) VALUES ($1, $2)', [
              roundId,
              reviewer,
            ])
          }
        })
      } catch {
        // The unique index allows one open round per item; a second request loses the race.
        return reply.code(409).send({ error: 'round_open' })
      }
      await notify(
        db,
        check.reviewers.map((userId) => ({
          userId,
          kind: 'review_requested' as const,
          itemId: row.id,
          actorId: principal.id,
        })),
      )
      return reviewsPayload(principal, row)
    },
  )

  /** Give or change a verdict while the round is open (rules 4 and 5, default 2). */
  app.post<{ Params: { id: string }; Body: { verdict: Verdict; comment?: string } }>(
    '/reviews/:id/verdict',
    {
      schema: {
        params: idParams,
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['verdict'],
          properties: {
            verdict: { type: 'string', enum: ['approved', 'changes_requested'] },
            comment: { type: 'string', maxLength: 2000 },
          },
        },
      },
    },
    async (request, reply) => {
      const principal = await resolvePrincipal(db, request, devAuth)
      if (!principal) return reply.code(401).send({ error: 'unauthenticated' })
      const found = await loadRound(principal, request.params.id)
      if (!found) return reply.code(404).send({ error: 'not_found' })
      const { round, row } = found
      if (!decide(principal, 'review.verdict', targetOf(row)).allowed) {
        return reply.code(403).send({ error: 'forbidden' })
      }
      const reviewers = await reviewersOf(db, round.id)
      if (!reviewers.includes(principal.id)) return reply.code(403).send({ error: 'not_reviewer' })
      if (round.state !== 'open') return reply.code(409).send({ error: 'round_closed' })
      const { verdict } = request.body
      const comment = (request.body.comment ?? '').trim()
      if (verdict === 'changes_requested' && comment === '') {
        return reply.code(400).send({ error: 'comment_required' })
      }

      const latest = await latestVerdicts(db, round.id)
      latest.set(principal.id, verdict)
      const outcome = roundOutcome(reviewers, latest)

      // Changes requested: the item goes straight to the send-back stage (rule 5, default 5).
      let sendBack: { key: string; category: string } | null = null
      let nextOwner = row.assignee_id
      if (outcome === 'changes_requested') {
        const state = await loadWorkflow(db, row)
        const to = state.review?.sendBackTo
        const stage = to ? state.stages.find((s) => s.key === to) : undefined
        if (!to || !stage || !isValidSendBack(state.stages, row.status_id, to)) {
          return reply.code(409).send({ error: 'send_back_invalid' })
        }
        sendBack = { key: to, category: stage.category }
        const teams = await db.query<{ hand_off_clears_owner: boolean }>(
          'SELECT hand_off_clears_owner FROM teams WHERE id = $1',
          [row.team_id],
        )
        if (teams[0]?.hand_off_clears_owner) nextOwner = null
      }

      await db.transaction(async (tx) => {
        await tx.query(
          'INSERT INTO review_verdicts (round_id, user_id, verdict, comment) VALUES ($1, $2, $3, $4)',
          [round.id, principal.id, verdict, comment === '' ? null : comment],
        )
        if (outcome !== 'open') {
          await tx.query(
            'UPDATE review_rounds SET state = $2, closed_at = now(), closed_by = $3 WHERE id = $1',
            [round.id, outcome, principal.id],
          )
        }
        if (sendBack) {
          await tx.query(
            `UPDATE work_items SET status_id = $2, status_category = $3, assignee_id = $4,
             updated_at = now() WHERE id = $1`,
            [row.id, sendBack.key, sendBack.category, nextOwner],
          )
          await tx.query(
            'UPDATE stage_history SET left_at = now() WHERE item_id = $1 AND left_at IS NULL',
            [row.id],
          )
          await tx.query(
            `INSERT INTO stage_history (item_id, stage_key, owner_id, moved_by, kind, reason)
             VALUES ($1, $2, $3, $4, 'sent_back', $5)`,
            [row.id, sendBack.key, nextOwner, principal.id, comment],
          )
        }
      })
      // The person who asked for the review hears how it ended (specs/comments.md, rule 4.1).
      if (outcome !== 'open') {
        await notify(db, [
          {
            userId: round.requested_by,
            kind: outcome === 'approved' ? 'review_approved' : 'review_changes_requested',
            itemId: row.id,
            actorId: principal.id,
          },
        ])
      }
      const updated = await loadVisibleItemIn(db, principal, row.id)
      if (!updated) return reply.code(404).send({ error: 'not_found' })
      return reviewsPayload(principal, updated)
    },
  )

  /** The requester or a team admin may withdraw an open round (rule 9). */
  app.post<{ Params: { id: string } }>(
    '/reviews/:id/withdraw',
    { schema: { params: idParams } },
    async (request, reply) => {
      const principal = await resolvePrincipal(db, request, devAuth)
      if (!principal) return reply.code(401).send({ error: 'unauthenticated' })
      const found = await loadRound(principal, request.params.id)
      if (!found) return reply.code(404).send({ error: 'not_found' })
      const { round, row } = found
      const allowed = decide(principal, 'review.withdraw', {
        ...targetOf(row),
        createdBy: round.requested_by,
      }).allowed
      if (!allowed) return reply.code(403).send({ error: 'forbidden' })
      if (round.state !== 'open') return reply.code(409).send({ error: 'round_closed' })
      await db.query(
        "UPDATE review_rounds SET state = 'withdrawn', closed_at = now(), closed_by = $2 WHERE id = $1 AND state = 'open'",
        [round.id, principal.id],
      )
      return reviewsPayload(principal, row)
    },
  )

  /** Make a stage a review stage, or stop it being one (team configuration). */
  app.put<{ Params: { teamId: string; stageKey: string }; Body: { sendBackTo: string | null } }>(
    '/teams/:teamId/stages/:stageKey/review',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['sendBackTo'],
          properties: { sendBackTo: { type: ['string', 'null'], maxLength: 64 } },
        },
      },
    },
    async (request, reply) => {
      const principal = await resolvePrincipal(db, request, devAuth)
      if (!principal) return reply.code(401).send({ error: 'unauthenticated' })
      const { teamId, stageKey } = request.params
      const teams = await db.query<{ id: string; is_private: boolean }>(
        'SELECT id, is_private FROM teams WHERE id = $1',
        [teamId],
      )
      const team = teams[0]
      const teamRef = team ? { id: team.id, isPrivate: team.is_private } : null
      if (!teamRef || !decide(principal, 'item.view', { team: teamRef }).allowed) {
        return reply.code(404).send({ error: 'not_found' })
      }
      if (!decide(principal, 'team.config.edit', { team: teamRef }).allowed) {
        return reply.code(403).send({ error: 'forbidden' })
      }
      const stages = await db.query<{
        key: string
        name: string
        category: 'todo' | 'in_progress' | 'done' | 'cancelled'
        position: number
      }>('SELECT key, name, category, position FROM stages WHERE team_id = $1', [teamId])
      if (!stages.some((s) => s.key === stageKey)) {
        return reply.code(404).send({ error: 'not_found' })
      }
      const { sendBackTo } = request.body
      const list = stages.map((s) => ({ teamId, ...s }))
      if (sendBackTo !== null && !isValidSendBack(list, stageKey, sendBackTo)) {
        return reply.code(400).send({ error: 'send_back_invalid' })
      }
      await db.query('UPDATE stages SET review_send_back_to = $3 WHERE team_id = $1 AND key = $2', [
        teamId,
        stageKey,
        sendBackTo,
      ])
      return { stageKey, sendBackTo }
    },
  )
}
