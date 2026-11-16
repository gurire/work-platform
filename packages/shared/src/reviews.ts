/**
 * Review round rules. Implements specs/reviews.md, sections 2 and 3. Pure functions shared by
 * the API and the web app.
 *
 * Do not change behaviour here without a change to the spec, approved by the owner.
 */
import type { Stage } from './work-item.js'
import { isEndStage } from './workflow.js'

export type Verdict = 'approved' | 'changes_requested'
export type RoundState = 'open' | 'approved' | 'changes_requested' | 'withdrawn'

/** The label of the extra requirement every review stage has (rule 1). */
export const REVIEW_REQUIREMENT = 'Review approved'

export const MAX_REVIEWERS = 10

/**
 * Where a round stands, from each reviewer's latest verdict. Any "changes requested" ends the
 * round (rule 5); otherwise it is approved once every reviewer has approved (rule 4).
 */
export function roundOutcome(
  reviewers: readonly string[],
  latest: ReadonlyMap<string, Verdict>,
): 'open' | 'approved' | 'changes_requested' {
  if (reviewers.some((id) => latest.get(id) === 'changes_requested')) return 'changes_requested'
  if (reviewers.length > 0 && reviewers.every((id) => latest.get(id) === 'approved')) {
    return 'approved'
  }
  return 'open'
}

export type ReviewerError = 'no_reviewers' | 'too_many_reviewers' | 'self_review' | 'not_a_reviewer'

export interface ReviewerCheck {
  readonly reviewers: readonly string[]
  readonly requesterId: string
  /** The item's current stage owner, who may not review their own work (default 1). */
  readonly stageOwnerId: string | null
  /** Whether the permission layer lets this person give a verdict on the item (rule 3). */
  readonly mayReview: (userId: string) => boolean
}

export type ReviewerResult =
  | { readonly ok: true; readonly reviewers: readonly string[] }
  | { readonly ok: false; readonly error: ReviewerError; readonly who?: string }

/** Checks the people asked to review a new round. Duplicates are merged. */
export function checkReviewers(check: ReviewerCheck): ReviewerResult {
  const reviewers = [...new Set(check.reviewers)]
  if (reviewers.length === 0) return { ok: false, error: 'no_reviewers' }
  if (reviewers.length > MAX_REVIEWERS) return { ok: false, error: 'too_many_reviewers' }
  for (const who of reviewers) {
    if (who === check.requesterId || who === check.stageOwnerId) {
      return { ok: false, error: 'self_review', who }
    }
    if (!check.mayReview(who)) return { ok: false, error: 'not_a_reviewer', who }
  }
  return { ok: true, reviewers }
}

/**
 * A review stage's send-back stage must be an earlier stage that is not an end stage
 * (default 5).
 */
export function isValidSendBack(
  stages: readonly Stage[],
  reviewStageKey: string,
  sendBackTo: string,
): boolean {
  const review = stages.find((stage) => stage.key === reviewStageKey)
  const back = stages.find((stage) => stage.key === sendBackTo)
  if (!review || !back || isEndStage(review)) return false
  return back.position < review.position && !isEndStage(back)
}
