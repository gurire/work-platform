/**
 * Stage move rules. Implements specs/workflow.md, section 2. Pure functions: the API and the
 * web app both use them, so a move the screen offers is a move the server accepts.
 *
 * Do not change behaviour here without a change to the spec, approved by the owner.
 */
import type { Stage } from './work-item.js'

export interface StageTransition {
  readonly from: string
  readonly to: string
}

export type MoveKind = 'move' | 'forced' | 'reopen'

export type MoveError =
  'unknown_stage' | 'not_allowed' | 'requirements_unmet' | 'cannot_force' | 'reason_required'

export type MoveCheck =
  | { readonly ok: true; readonly kind: MoveKind }
  | { readonly ok: false; readonly error: MoveError; readonly missing?: readonly string[] }

export interface MoveRequest {
  /** The stages of the item's own team. */
  readonly stages: readonly Stage[]
  /** The team's listed moves. A stage with none listed uses the default (rule 4). */
  readonly transitions: readonly StageTransition[]
  readonly fromKey: string
  readonly toKey: string
  /** Labels of the current stage's requirements that are not met yet. */
  readonly missing: readonly string[]
  /** The person asked to force the move past unmet requirements. */
  readonly force: boolean
  /** Whether the permission layer allows this person to force a move. */
  readonly canForce: boolean
  readonly reason?: string | undefined
}

export function isEndStage(stage: Pick<Stage, 'category'>): boolean {
  return stage.category === 'done' || stage.category === 'cancelled'
}

function ordered(stages: readonly Stage[]): Stage[] {
  return [...stages].sort((a, b) => a.position - b.position)
}

/** Stages an item may move to from `fromKey` (rules 4 and 8). */
export function allowedDestinations(
  stages: readonly Stage[],
  fromKey: string,
  transitions: readonly StageTransition[],
): string[] {
  const list = ordered(stages)
  const index = list.findIndex((stage) => stage.key === fromKey)
  const from = list[index]
  if (!from) return []

  const listed = transitions.filter((t) => t.from === fromKey).map((t) => t.to)
  if (listed.length > 0) {
    return [...new Set(listed)].filter(
      (key) => key !== fromKey && list.some((stage) => stage.key === key),
    )
  }

  if (isEndStage(from)) {
    // Reopening: by default, the nearest earlier stage that is not an end stage.
    for (let i = index - 1; i >= 0; i--) {
      const stage = list[i]
      if (stage && !isEndStage(stage)) return [stage.key]
    }
    return []
  }

  const result = new Set<string>()
  const previous = list[index - 1]
  const next = list[index + 1]
  if (previous) result.add(previous.key)
  if (next) result.add(next.key)
  for (const stage of list) if (isEndStage(stage) && stage.key !== fromKey) result.add(stage.key)
  return [...result]
}

/** May the item move from `fromKey` to `toKey`? A refused move changes nothing (rule 5). */
export function checkMove(request: MoveRequest): MoveCheck {
  const { stages, transitions, fromKey, toKey, missing, force, canForce } = request
  if (fromKey === toKey) return { ok: true, kind: 'move' }

  const from = stages.find((stage) => stage.key === fromKey)
  const to = stages.find((stage) => stage.key === toKey)
  if (!from || !to) return { ok: false, error: 'unknown_stage' }

  // Forcing skips requirements, never allowed destinations.
  if (!allowedDestinations(stages, fromKey, transitions).includes(toKey)) {
    return { ok: false, error: 'not_allowed' }
  }

  const hasReason = (request.reason ?? '').trim().length > 0

  if (isEndStage(from)) {
    return hasReason ? { ok: true, kind: 'reopen' } : { ok: false, error: 'reason_required' }
  }

  // Requirements apply only when leaving for a later stage that is not a cancelled stage.
  const forward = to.position > from.position && to.category !== 'cancelled'
  if (!forward || missing.length === 0) return { ok: true, kind: 'move' }

  if (!force) return { ok: false, error: 'requirements_unmet', missing }
  if (!canForce) return { ok: false, error: 'cannot_force' }
  if (!hasReason) return { ok: false, error: 'reason_required' }
  return { ok: true, kind: 'forced' }
}

/** A field value counts as filled in unless it is missing, null or only spaces. */
export function isFilled(value: unknown): boolean {
  if (value === undefined || value === null) return false
  if (typeof value === 'string') return value.trim().length > 0
  if (Array.isArray(value)) return value.length > 0
  return true
}
