import { useEffect, useState } from 'react'
import { describeCodeEvent, type CodeEventKind, type WorkItem } from '@wm/shared'
import type { Api, ItemCode } from './api'
import { timeAgo } from './item-model'

interface Props {
  api: Api
  item: WorkItem
}

const OUTCOME: Record<ItemCode['events'][number]['outcome'], string> = {
  moved: 'moved the item',
  not_moved: 'did not move it',
  no_rule: 'no rule for this team',
}

/** Pull requests linked to this item and what code events did (specs/code-status.md). */
export function CodePanel({ api, item }: Props) {
  const [code, setCode] = useState<ItemCode | null>(null)

  useEffect(() => {
    let cancelled = false
    api.code(item.id).then(
      (next) => {
        if (!cancelled) setCode(next)
      },
      () => {
        if (!cancelled) setCode(null)
      },
    )
    return () => {
      cancelled = true
    }
  }, [api, item.id, item.statusId, item.updatedAt])

  if (!code || code.pullRequests.length === 0) return null

  return (
    <section className="panel" aria-labelledby="code-title">
      <h2 id="code-title">Code</h2>
      <ul className="activity">
        {code.pullRequests.map((pr) => (
          <li key={`${pr.repo}#${pr.number}`}>
            <span>
              {pr.url ? (
                <a href={pr.url} target="_blank" rel="noreferrer noopener">
                  #{pr.number}
                </a>
              ) : (
                `#${pr.number}`
              )}{' '}
              {pr.title ?? ''} <span className="muted">· {pr.repo}</span>
            </span>
            <span className="code-chips">
              <span className={`verdict code-${pr.state}`}>{pr.state}</span>
              {pr.checks && (
                <span className={`verdict code-checks-${pr.checks}`}>checks {pr.checks}</span>
              )}
            </span>
          </li>
        ))}
      </ul>
      {code.events.length > 0 && (
        <details className="round-past">
          <summary>Recent code events ({code.events.length})</summary>
          <ul className="activity">
            {code.events.map((event, index) => (
              <li key={`${event.at}-${index}`}>
                <span>
                  {describeCodeEvent({ kind: event.kind as CodeEventKind, prNumber: event.number })}
                  : {OUTCOME[event.outcome]}
                  {event.outcome === 'not_moved' && event.detail ? ` (${event.detail})` : ''}
                </span>
                <span className="muted">{timeAgo(event.at)}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  )
}
