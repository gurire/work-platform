/**
 * Stage limits and waiting targets. Implements specs/stage-limits.md. They warn and never
 * block (rule 5), so nothing here is ever used to refuse a move.
 */
import type { Stage } from './work-item.js'
import { isEndStage } from './workflow.js'

export const MAX_ITEM_LIMIT = 999
export const MAX_TARGET_HOURS = 8760

export type StageLoad = 'ok' | 'at_limit' | 'over_limit'

/** Rule 3. A stage without a limit is always fine. */
export function stageLoad(count: number, limit: number | null): StageLoad {
  if (limit === null) return 'ok'
  if (count > limit) return 'over_limit'
  if (count === limit) return 'at_limit'
  return 'ok'
}

/** Rule 4: hours waited since entering the current stage, and whether that is over target. */
export function waiting(
  enteredAt: string,
  targetHours: number | null,
  now: number = Date.now(),
): { hours: number; overdue: boolean } {
  const hours = Math.max(0, (now - new Date(enteredAt).getTime()) / 3_600_000)
  return { hours, overdue: targetHours !== null && hours > targetHours }
}

export type LimitError = 'end_stage' | 'invalid_limit' | 'invalid_target'

/** Rules 1 and 2: may this stage have these settings? */
export function checkLimits(
  stage: Pick<Stage, 'category'>,
  itemLimit: number | null,
  targetHours: number | null,
): LimitError | null {
  const wholeIn = (value: number, max: number) =>
    Number.isInteger(value) && value >= 1 && value <= max
  if (itemLimit !== null && !wholeIn(itemLimit, MAX_ITEM_LIMIT)) return 'invalid_limit'
  if (targetHours !== null && !wholeIn(targetHours, MAX_TARGET_HOURS)) return 'invalid_target'
  if (isEndStage(stage) && (itemLimit !== null || targetHours !== null)) return 'end_stage'
  return null
}
