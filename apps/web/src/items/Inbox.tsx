import type { InboxKind } from '@wm/shared'
import type { ApiUser, InboxEntry } from './api'
import { timeAgo } from './item-model'

interface Props {
  entries: readonly InboxEntry[] | null
  users: readonly ApiUser[]
  onOpen: (entry: InboxEntry) => void
  onMarkAllRead: () => void
}

const WHAT: Record<InboxKind, string> = {
  mentioned: 'mentioned you on',
  assigned: 'made you the owner of',
  review_requested: 'asked you to review',
  review_approved: 'approved the review of',
  review_changes_requested: 'asked for changes on',
  commented: 'commented on',
}

/** What needs you, newest first (specs/comments.md, section 4). */
export function Inbox({ entries, users, onOpen, onMarkAllRead }: Props) {
  const nameOf = (id: string | null) =>
    id ? (users.find((u) => u.id === id)?.name ?? id) : 'Someone'
  const unread = entries?.filter((e) => !e.read).length ?? 0
  return (
    <main className="item-page" aria-labelledby="inbox-title">
      <div className="panel-head">
        <h1 id="inbox-title" className="item-title">
          Inbox
        </h1>
        <span className="muted">{unread} unread · Esc back</span>
        {unread > 0 && (
          <button type="button" className="button inbox-mark" onClick={onMarkAllRead}>
            Mark all as read
          </button>
        )}
      </div>
      {!entries && <p className="muted">Loading…</p>}
      {entries && entries.length === 0 && <p className="muted">Nothing needs you right now.</p>}
      <ol className="inbox-list">
        {(entries ?? []).map((entry) => (
          <li key={entry.id}>
            <button
              type="button"
              className={entry.read ? 'inbox-entry' : 'inbox-entry unread'}
              onClick={() => onOpen(entry)}
            >
              <span className="inbox-line">
                {!entry.read && <span className="inbox-dot" aria-label="Unread" />}
                <strong>{nameOf(entry.actorId)}</strong> {WHAT[entry.kind]}{' '}
                <strong>{entry.itemKey}</strong> <span className="muted">{entry.itemTitle}</span>
              </span>
              {entry.excerpt && (
                <span className="inbox-excerpt muted">
                  {entry.excerpt.replace(/@\[([^\]]+)\]\([^)]+\)/g, '@$1')}
                </span>
              )}
              <span className="muted inbox-time">{timeAgo(entry.createdAt)}</span>
            </button>
          </li>
        ))}
      </ol>
    </main>
  )
}
