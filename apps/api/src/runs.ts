/**
 * Starting runs of recurring items (specs/data-model.md, rules 19–23). The database ends a run
 * by itself when the item reaches a Done stage (migration 0012).
 */
import { nextRunAfter, type ScheduleRule } from '@wm/shared'
import type { Db, Queryable } from './db/db.js'
import { notify } from './inbox.js'

export interface StartResult {
  ok: boolean
  number?: number
  error?: 'run_open' | 'unknown_stage' | 'not_found'
}

/** Starts the next run: moves the item to the start stage and opens a new numbered run. */
export async function startRun(
  db: Db,
  itemId: string,
  how: 'schedule' | 'manual',
  starterId: string | null,
  startStage: string,
  ownerId: string | null | undefined,
): Promise<StartResult> {
  return db.transaction(async (tx: Queryable) => {
    const [item] = await tx.query<{
      id: string
      team_id: string
      current_run: number | null
      assignee_id: string | null
    }>(
      'SELECT id, team_id, current_run, assignee_id FROM work_items WHERE id = $1 AND deleted_at IS NULL FOR UPDATE',
      [itemId],
    )
    if (!item) return { ok: false, error: 'not_found' }
    if (item.current_run !== null) {
      const [open] = await tx.query(
        'SELECT 1 FROM item_runs WHERE item_id = $1 AND number = $2 AND ended_at IS NULL',
        [itemId, item.current_run],
      )
      if (open) return { ok: false, error: 'run_open' }
    }
    const [stage] = await tx.query<{ category: string }>(
      'SELECT category FROM stages WHERE team_id = $1 AND key = $2',
      [item.team_id, startStage],
    )
    if (!stage) return { ok: false, error: 'unknown_stage' }
    const [max] = await tx.query<{ n: number | null }>(
      'SELECT max(number) AS n FROM item_runs WHERE item_id = $1',
      [itemId],
    )
    const number = (max?.n ?? 0) + 1
    const owner = ownerId === undefined ? item.assignee_id : ownerId
    await tx.query(
      'INSERT INTO item_runs (item_id, number, started_by, starter_id, start_stage) VALUES ($1, $2, $3, $4, $5)',
      [itemId, number, how, starterId, startStage],
    )
    await tx.query(
      'UPDATE work_items SET current_run = $2, status_id = $3, status_category = $4, assignee_id = $5, updated_at = now() WHERE id = $1',
      [itemId, number, startStage, stage.category, owner],
    )
    // A new stage pass: checklist ticks start fresh (specs/workflow.md, rule 7).
    await tx.query(
      'UPDATE stage_history SET left_at = now() WHERE item_id = $1 AND left_at IS NULL',
      [itemId],
    )
    await tx.query(
      'INSERT INTO stage_history (item_id, stage_key, owner_id, moved_by, kind, reason, run_number) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [
        itemId,
        startStage,
        owner,
        starterId,
        how === 'schedule' ? 'automatic' : 'move',
        `Run ${number} started`,
        number,
      ],
    )
    if (owner)
      await notify(tx, [{ userId: owner, kind: 'run_started', itemId, actorId: starterId }])
    return { ok: true, number }
  })
}

/** Starts every run that is due. Called every minute by the API; safe to call more often. */
export async function runDueSchedules(
  db: Db,
  now: Date = new Date(),
): Promise<{ started: number; blocked: number }> {
  const due = await db.query<{
    item_id: string
    rule: ScheduleRule
    start_stage: string
    owner_id: string | null
    tz: string
    pending_start: boolean
    next_at: Date | string
  }>(
    `SELECT s.item_id, s.rule, s.start_stage, s.owner_id, s.tz, s.pending_start, s.next_at
     FROM item_schedules s JOIN work_items w ON w.id = s.item_id
     WHERE w.deleted_at IS NULL AND (s.next_at <= $1 OR s.pending_start)`,
    [now],
  )
  let started = 0
  let blocked = 0
  for (const schedule of due) {
    const isDue = new Date(schedule.next_at).getTime() <= now.getTime()
    const result = await startRun(
      db,
      schedule.item_id,
      'schedule',
      null,
      schedule.start_stage,
      schedule.owner_id ?? undefined,
    )
    const next = isDue ? nextRunAfter(schedule.rule, now, schedule.tz) : new Date(schedule.next_at)
    if (result.ok) {
      started++
      await db.query(
        'UPDATE item_schedules SET next_at = $2, pending_start = false WHERE item_id = $1',
        [schedule.item_id, next],
      )
    } else if (result.error === 'run_open') {
      // Rule 21: wait for the open run; tell the owner and team admins once.
      if (!schedule.pending_start) {
        blocked++
        const people = await db.query<{ user_id: string }>(
          `SELECT DISTINCT u.user_id FROM (
             SELECT assignee_id AS user_id FROM work_items WHERE id = $1
             UNION SELECT m.user_id FROM team_members m JOIN work_items w ON w.team_id = m.team_id
               WHERE w.id = $1 AND m.role = 'admin') u WHERE u.user_id IS NOT NULL`,
          [schedule.item_id],
        )
        await notify(
          db,
          people.map((p) => ({
            userId: p.user_id,
            kind: 'run_blocked' as const,
            itemId: schedule.item_id,
            actorId: null,
          })),
        )
      }
      await db.query(
        'UPDATE item_schedules SET next_at = $2, pending_start = true WHERE item_id = $1',
        [schedule.item_id, next],
      )
    }
  }
  return { started, blocked }
}
