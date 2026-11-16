/**
 * PROTECTED TEST. Worked examples from specs/reviews.md (merged 17 Nov 2026).
 * Human-owned: do not edit to make code pass.
 */
import { describe, expect, it } from 'vitest'
import {
  checkMove,
  checkReviewers,
  isValidSendBack,
  REVIEW_REQUIREMENT,
  roundOutcome,
  type Stage,
  type Verdict,
} from '../../src/index.js'

const stage = (key: string, position: number, category: Stage['category']): Stage => ({
  teamId: 'DATA',
  key,
  name: key,
  category,
  position,
})
const stages = [
  stage('intake', 1, 'todo'),
  stage('processing', 2, 'in_progress'),
  stage('validation', 3, 'in_progress'),
  stage('published', 4, 'done'),
  stage('dropped', 5, 'cancelled'),
]
const verdicts = (entries: [string, Verdict][]) => new Map(entries)

describe('review rounds (specs/reviews.md)', () => {
  it('example 1: one approval of two leaves the round open and the requirement missing', () => {
    expect(roundOutcome(['grace', 'hugo'], verdicts([['grace', 'approved']]))).toBe('open')
    const move = checkMove({
      stages,
      transitions: [],
      fromKey: 'validation',
      toKey: 'published',
      missing: [REVIEW_REQUIREMENT],
      force: false,
      canForce: false,
    })
    expect(move).toEqual({ ok: false, error: 'requirements_unmet', missing: ['Review approved'] })
  })

  it('example 2: when every reviewer approves, the round is approved', () => {
    const latest = verdicts([
      ['grace', 'approved'],
      ['hugo', 'approved'],
    ])
    expect(roundOutcome(['grace', 'hugo'], latest)).toBe('approved')
  })

  it('example 3: any "changes requested" ends the round, whatever others said', () => {
    const latest = verdicts([
      ['grace', 'approved'],
      ['hugo', 'changes_requested'],
    ])
    expect(roundOutcome(['grace', 'hugo'], latest)).toBe('changes_requested')
    expect(roundOutcome(['grace', 'hugo'], verdicts([['hugo', 'changes_requested']]))).toBe(
      'changes_requested',
    )
  })

  it('a round with no reviewers is never approved', () => {
    expect(roundOutcome([], verdicts([]))).toBe('open')
  })

  it('example 5 and default 1: no reviewing your own work', () => {
    const base = { requesterId: 'chen', stageOwnerId: 'dara', mayReview: () => true }
    expect(checkReviewers({ ...base, reviewers: ['chen', 'grace'] })).toEqual({
      ok: false,
      error: 'self_review',
      who: 'chen',
    })
    expect(checkReviewers({ ...base, reviewers: ['dara'] })).toEqual({
      ok: false,
      error: 'self_review',
      who: 'dara',
    })
    expect(checkReviewers({ ...base, reviewers: ['grace', 'hugo', 'grace'] })).toEqual({
      ok: true,
      reviewers: ['grace', 'hugo'],
    })
  })

  it('rule 3: every reviewer must be allowed to give a verdict on the item', () => {
    const result = checkReviewers({
      reviewers: ['grace', 'outsider'],
      requesterId: 'chen',
      stageOwnerId: null,
      mayReview: (id) => id !== 'outsider',
    })
    expect(result).toEqual({ ok: false, error: 'not_a_reviewer', who: 'outsider' })
    expect(
      checkReviewers({
        reviewers: [],
        requesterId: 'chen',
        stageOwnerId: null,
        mayReview: () => true,
      }),
    ).toEqual({ ok: false, error: 'no_reviewers' })
  })

  it('default 5: the send-back stage is an earlier stage that is not an end stage', () => {
    expect(isValidSendBack(stages, 'validation', 'processing')).toBe(true)
    expect(isValidSendBack(stages, 'validation', 'intake')).toBe(true)
    expect(isValidSendBack(stages, 'validation', 'validation')).toBe(false)
    expect(isValidSendBack(stages, 'processing', 'validation')).toBe(false)
    expect(isValidSendBack(stages, 'published', 'processing')).toBe(false)
    expect(isValidSendBack(stages, 'validation', 'nowhere')).toBe(false)
  })
})
