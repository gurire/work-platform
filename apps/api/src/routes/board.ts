/**
 * Board figures and stage limits (specs/stage-limits.md). Limits warn and never block.
 */
import type { FastifyInstance } from 'fastify'
import { checkLimits, decide, type Stage, type TeamRef } from '@wm/shared'
import type { Db } from '../db/db.js'
import { resolvePrincipal } from '../principal.js'
import { iso } from './items.js'

export function registerBoardRoutes(
  app: FastifyInstance,
  { db, devAuth }: { db: Db; devAuth: boolean },
): void {
  async function loadTeam(teamId: string): Promise<TeamRef | null> {
    const rows = await db.query<{ id: string; is_private: boolean }>(
      'SELECT id, is_private FROM teams WHERE id = $1',
      [teamId],
    )
    const row = rows[0]
    return row ? { id: row.id, isPrivate: row.is_private } : null
  }

  /**
   * Item counts per stage (every item, rule 3) and when each item entered its current stage
   * (rule 4). Seeing a team's items is one decision for the whole team.
   */
  app.get<{ Params: { teamId: string } }>('/teams/:teamId/board', async (request, reply) => {
    const principal = await resolvePrincipal(db, request, devAuth)
    if (!principal) return reply.code(401).send({ error: 'unauthenticated' })
    const team = await loadTeam(request.params.teamId)
    if (!team || !decide(principal, 'item.view', { team }).allowed) {
      return reply.code(404).send({ error: 'not_found' })
    }
    const counts = await db.query<{ status_id: string; n: string }>(
      `SELECT status_id, count(*) AS n FROM work_items
       WHERE team_id = $1 AND deleted_at IS NULL GROUP BY status_id`,
      [team.id],
    )
    const entered = await db.query<{ item_id: string; entered_at: Date | string }>(
      `SELECT h.item_id, h.entered_at FROM stage_history h
       JOIN work_items w ON w.id = h.item_id
       WHERE w.team_id = $1 AND w.deleted_at IS NULL AND h.left_at IS NULL`,
      [team.id],
    )
    return {
      counts: Object.fromEntries(counts.map((row) => [row.status_id, Number(row.n)])),
      enteredAt: Object.fromEntries(entered.map((row) => [row.item_id, iso(row.entered_at)])),
    }
  })

  /** Set or clear a stage's item limit and waiting target (rules 1, 2 and 6). */
  app.put<{
    Params: { teamId: string; stageKey: string }
    Body: { itemLimit: number | null; targetHours: number | null }
  }>(
    '/teams/:teamId/stages/:stageKey/limits',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['itemLimit', 'targetHours'],
          properties: {
            itemLimit: { type: ['number', 'null'] },
            targetHours: { type: ['number', 'null'] },
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
      const stages = await db.query<{ category: Stage['category'] }>(
        'SELECT category FROM stages WHERE team_id = $1 AND key = $2',
        [team.id, request.params.stageKey],
      )
      const stage = stages[0]
      if (!stage) return reply.code(404).send({ error: 'not_found' })
      const { itemLimit, targetHours } = request.body
      const error = checkLimits(stage, itemLimit, targetHours)
      if (error) return reply.code(400).send({ error })
      await db.query(
        'UPDATE stages SET item_limit = $3, target_hours = $4 WHERE team_id = $1 AND key = $2',
        [team.id, request.params.stageKey, itemLimit, targetHours],
      )
      return { stageKey: request.params.stageKey, itemLimit, targetHours }
    },
  )
}
