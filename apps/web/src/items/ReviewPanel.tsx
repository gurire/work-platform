import { useEffect, useState } from 'react'
import type { Verdict, WorkItem } from '@wm/shared'
import type { Api, ApiUser, Reviews, ReviewRound } from './api'
import { timeAgo } from './item-model'
import type { ItemStore } from './store'

interface Props {
  api: Api
  store: ItemStore
  item: WorkItem
  meId: string | null
  users: readonly ApiUser[]
  stageName: (key: string) => string
  /** Called after anything that may have changed the item's stage or requirements. */
  onChanged: () => void
}

const message = (error: unknown) =>
  error instanceof Error ? error.message : 'something went wrong'

const STATE_LABEL: Record<ReviewRound['state'], string> = {
  open: 'Waiting for reviewers',
  approved: 'Approved',
  changes_requested: 'Changes requested',
  withdrawn: 'Withdrawn',
}

function verdictLabel(verdict: Verdict | null): string {
  if (verdict === 'approved') return 'Approved'
  if (verdict === 'changes_requested') return 'Changes requested'
  return 'Waiting'
}

/** Review rounds for one item (specs/reviews.md). Shown only on review stages or with history. */
export function ReviewPanel({ api, store, item, meId, users, stageName, onChanged }: Props) {
  const [reviews, setReviews] = useState<Reviews | null>(null)
  const [reload, setReload] = useState(0)
  const [picking, setPicking] = useState(false)
  const [chosen, setChosen] = useState<readonly string[]>([])
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    api.reviews(item.id).then(
      (next) => {
        if (!cancelled) setReviews(next)
      },
      (error: unknown) => {
        if (!cancelled) store.toast(`Could not load reviews: ${message(error)}.`)
      },
    )
    return () => {
      cancelled = true
    }
  }, [api, store, item.id, item.statusId, reload])

  if (!reviews || (!reviews.reviewStage && reviews.rounds.length === 0)) return null

  const nameOf = (id: string | null) =>
    id ? (users.find((u) => u.id === id)?.name ?? id) : 'Nobody'
  const open = reviews.rounds.find((round) => round.state === 'open')
  const past = reviews.rounds.filter((round) => round.state !== 'open')
  // Nobody reviews their own work: not the requester (me) and not the stage owner (default 1).
  const candidates = users.filter((u) => u.id !== meId && u.id !== item.assigneeId)

  async function run(action: () => Promise<Reviews>, after?: () => void) {
    setBusy(true)
    try {
      setReviews(await action())
      after?.()
      // A verdict can send the item back, so refresh the item itself too.
      store.put(await api.getItem(item.id))
      onChanged()
    } catch (error) {
      store.toast(`${item.key}: ${message(error)}.`)
      setReload((n) => n + 1)
    } finally {
      setBusy(false)
    }
  }

  const status = reviews.approved
    ? 'Approved for this stage.'
    : open
      ? `Round ${open.number}: ${open.reviewers.filter((r) => r.verdict === 'approved').length} of ${open.reviewers.length} approved.`
      : reviews.reviewStage
        ? `Needs an approved review before moving on. Changes requested send it back to ${stageName(reviews.reviewStage.sendBackTo)}.`
        : 'This stage does not take reviews.'

  return (
    <section className="panel" aria-labelledby="review-title">
      <div className="panel-head">
        <h2 id="review-title">Review</h2>
        <span className="muted">{status}</span>
      </div>

      {reviews.canOpen && !picking && (
        <div className="move-row">
          <button
            type="button"
            className="button button-primary"
            onClick={() => {
              setChosen([])
              setPicking(true)
            }}
          >
            Ask for review
          </button>
        </div>
      )}

      {picking && (
        <form
          className="reason-box"
          onSubmit={(event) => {
            event.preventDefault()
            void run(
              () => api.openReview(item.id, chosen),
              () => setPicking(false),
            )
          }}
        >
          <span>Who should review? Everyone you pick must approve.</span>
          <div className="reviewer-pick">
            {candidates.map((u) => (
              <label key={u.id} className="check-row">
                <input
                  type="checkbox"
                  checked={chosen.includes(u.id)}
                  onChange={(event) =>
                    setChosen((list) =>
                      event.target.checked ? [...list, u.id] : list.filter((id) => id !== u.id),
                    )
                  }
                />
                <span>{u.name}</span>
              </label>
            ))}
          </div>
          <div className="move-row">
            <button
              type="submit"
              className="button button-primary"
              disabled={busy || chosen.length === 0}
            >
              Open round with {chosen.length} reviewer{chosen.length === 1 ? '' : 's'}
            </button>
            <button type="button" className="button" onClick={() => setPicking(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {open && (
        <div className="round round-open">
          <div className="round-head">
            <strong>Round {open.number}</strong>
            <span className="muted">
              asked by {nameOf(open.requestedBy)}, {timeAgo(open.openedAt)}
            </span>
          </div>
          <ul className="reviewer-list">
            {open.reviewers.map((r) => (
              <li key={r.userId}>
                <span>{nameOf(r.userId)}</span>
                <span className={`verdict verdict-${r.verdict ?? 'waiting'}`}>
                  {verdictLabel(r.verdict)}
                </span>
                {r.comment && <span className="muted">“{r.comment}”</span>}
              </li>
            ))}
          </ul>

          {reviews.canVerdict && (
            <div className="reason-box">
              <label htmlFor="verdict-comment">
                Your verdict. A comment is needed when asking for changes; it is shown on the item.
              </label>
              <textarea
                id="verdict-comment"
                rows={2}
                value={comment}
                onChange={(event) => setComment(event.target.value)}
              />
              <div className="move-row">
                <button
                  type="button"
                  className="button button-primary"
                  disabled={busy}
                  onClick={() =>
                    void run(
                      () => api.giveVerdict(open.id, 'approved', comment),
                      () => setComment(''),
                    )
                  }
                >
                  Approve
                </button>
                <button
                  type="button"
                  className="button"
                  disabled={busy || comment.trim() === ''}
                  title={comment.trim() === '' ? 'Say what needs to change first' : undefined}
                  onClick={() =>
                    void run(
                      () => api.giveVerdict(open.id, 'changes_requested', comment),
                      () => setComment(''),
                    )
                  }
                >
                  Request changes
                </button>
              </div>
            </div>
          )}

          {reviews.canWithdraw && (
            <div className="move-row">
              <button
                type="button"
                className="link-button"
                disabled={busy}
                onClick={() => void run(() => api.withdrawReview(open.id))}
              >
                Withdraw this round
              </button>
            </div>
          )}
        </div>
      )}

      {past.length > 0 && (
        <details className="round-past">
          <summary>Earlier rounds ({past.length})</summary>
          <ul className="activity">
            {past.map((round) => {
              const asked = round.reviewers.find((r) => r.verdict === 'changes_requested')
              return (
                <li key={round.id}>
                  <span>
                    Round {round.number} in {stageName(round.stageKey)}: {STATE_LABEL[round.state]}
                    {round.state === 'changes_requested' && asked
                      ? ` by ${nameOf(asked.userId)}: “${asked.comment ?? ''}”`
                      : ''}
                    {round.state === 'withdrawn' ? ` by ${nameOf(round.closedBy)}` : ''}
                  </span>
                  <span className="muted">{round.closedAt ? timeAgo(round.closedAt) : ''}</span>
                </li>
              )
            })}
          </ul>
        </details>
      )}
    </section>
  )
}
