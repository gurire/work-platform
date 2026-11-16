/**
 * PROTECTED TEST. specs/stage-limits.md, rules 1 to 5 and worked examples.
 * Human-owned once the spec is merged: do not edit to make code pass.
 */
import { describe, expect, it } from 'vitest'
import { checkLimits, checkMove, stageLoad, waiting, type Stage } from '../../src/index.js'

const HOUR = 3_600_000
const now = Date.parse('2026-11-17T12:00:00Z')

describe('stage limits and waiting targets (specs/stage-limits.md)', () => {
  it('example 1 and rule 3: at the limit when equal, over it when higher', () => {
    expect(stageLoad(4, 5)).toBe('ok')
    expect(stageLoad(5, 5)).toBe('at_limit')
    expect(stageLoad(6, 5)).toBe('over_limit')
    expect(stageLoad(500, null)).toBe('ok')
  })

  it('rule 5: a full stage never blocks a move', () => {
    const stages: Stage[] = [
      { teamId: 'T', key: 'a', name: 'A', category: 'in_progress', position: 1 },
      { teamId: 'T', key: 'b', name: 'B', category: 'in_progress', position: 2 },
    ]
    const move = checkMove({
      stages,
      transitions: [],
      fromKey: 'a',
      toKey: 'b',
      missing: [],
      force: false,
      canForce: false,
    })
    expect(move.ok).toBe(true)
  })

  it('example 2 and rule 4: overdue after the target, counted from entering the stage', () => {
    const threeDaysAgo = new Date(now - 72 * HOUR).toISOString()
    expect(waiting(threeDaysAgo, 48, now)).toEqual({ hours: 72, overdue: true })
    expect(waiting(new Date(now - 47 * HOUR).toISOString(), 48, now).overdue).toBe(false)
    expect(waiting(threeDaysAgo, null, now).overdue).toBe(false)
  })

  it('example 3 and rules 1 and 2: only working stages, whole numbers in range', () => {
    expect(checkLimits({ category: 'in_progress' }, 5, 48)).toBe(null)
    expect(checkLimits({ category: 'todo' }, null, null)).toBe(null)
    expect(checkLimits({ category: 'done' }, 5, null)).toBe('end_stage')
    expect(checkLimits({ category: 'cancelled' }, null, 24)).toBe('end_stage')
    expect(checkLimits({ category: 'done' }, null, null)).toBe(null)
    expect(checkLimits({ category: 'in_progress' }, 0, null)).toBe('invalid_limit')
    expect(checkLimits({ category: 'in_progress' }, 2.5, null)).toBe('invalid_limit')
    expect(checkLimits({ category: 'in_progress' }, 1000, null)).toBe('invalid_limit')
    expect(checkLimits({ category: 'in_progress' }, null, 8761)).toBe('invalid_target')
  })
})
