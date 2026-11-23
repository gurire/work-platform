import type { InboxKind } from '@wm/shared'
import type { ApiUser, InboxEntry } from './api'
import { useState } from 'react'
import { AtSign, Check, CheckCheck, Eye, MessageSquare, Undo2, UserCheck } from 'lucide-react'
import { dayGroup, timeAgo } from './item-model'
import { Avatar } from '../ui/kit'

interface Props {
  entries: readonly InboxEntry[] | null
  users: readonly ApiUser[]
  onOpen: (entry: InboxEntry) => void
  onMarkRead: (entry: InboxEntry) => void
  onMarkAllRead: () => void
}

export const WHAT: Record<InboxKind, string> = {
  mentioned: 'mentioned you on',
  assigned: 'made you the owner of',
  review_requested: 'asked you to review',
  review_approved: 'approved the review of',
  review_changes_requested: 'asked for changes on',
  commented: 'commented on',
  run_started: 'started a new run of',
  run_blocked: 'could not start the next run of',
  request_new: 'sent a new request:',
  request_update: 'updated the request',
}

const ICON: Record<InboxKind, typeof AtSign> = {
  mentioned: AtSign,
  assigned: UserCheck,
  review_requested: Eye,
  review_approved: Check,
  review_changes_requested: Undo2,
  commented: MessageSquare,
  run_started: CheckCheck,
  run_blocked: Undo2,
  request_new: MessageSquare,
  request_update: MessageSquare,
}

type Filter = 'all' | 'unread' | 'mentions' | 'reviews' | 'assigned'

const FILTERS: readonly { id: Filter; label: string; match: (e: InboxEntry) => boolean }[] = [
  { id: 'all', label: 'All', match: () => true },
  { id: 'unread', label: 'Unread', match: (e) => !e.read },
  {
    id: 'mentions',
    label: 'Mentions',
    match: (e) => e.kind === 'mentioned' || e.kind === 'commented',
  },
  { id: 'reviews', label: 'Reviews', match: (e) => e.kind.startsWith('review_') },
  { id: 'assigned', label: 'Assigned', match: (e) => e.kind === 'assigned' },
]

/** What needs you, newest first, grouped by day (specs/comments.md, section 4). */
export function Inbox({ entries, users, onOpen, onMarkRead, onMarkAllRead }: Props) {
  const [filter, setFilter] = useState<Filter>('all')
  const nameOf = (id: string | null) =>
    id ? (users.find((u) => u.id === id)?.name ?? id) : 'Someone'
  const unread = entries?.filter((e) => !e.read).length ?? 0
  const shown = (entries ?? []).filter(FILTERS.find((f) => f.id === filter)?.match ?? (() => true))
  const now = Date.now()
  const groups: { label: string; entries: InboxEntry[] }[] = []
  for (const entry of shown) {
    const label = dayGroup(entry.createdAt, now)
    const last = groups.at(-1)
    if (last?.label === label) last.entries.push(entry)
    else groups.push({ label, entries: [entry] })
  }
  return (
    <main className="item-page inbox-v2" aria-labelledby="inbox-title">
      <div className="panel-head">
        <h1 id="inbox-title" className="item-title">
          Inbox
        </h1>
        <span className="muted">{unread} unread · Esc back</span>
        {unread > 0 && (
          <button type="button" className="button inbox-mark" onClick={onMarkAllRead}>
            <CheckCheck size={14} aria-hidden="true" /> Mark all as read
          </button>
        )}
      </div>
      <div className="tabs inbox-tabs" role="tablist" aria-label="Show">
        {FILTERS.map((f) => {
          const count = (entries ?? []).filter(f.match).length
          return (
            <button
              key={f.id}
              role="tab"
              aria-selected={filter === f.id}
              className={filter === f.id ? 'tab tab-active' : 'tab'}
              onClick={() => setFilter(f.id)}
            >
              {f.label}
              {f.id !== 'all' && count > 0 && <span className="tab-count">{count}</span>}
            </button>
          )
        })}
      </div>
      {!entries && <p className="muted">Loading…</p>}
      {entries && shown.length === 0 && (
        <p className="inbox-empty muted">
          {filter === 'all' ? 'Nothing needs you right now.' : 'Nothing here.'}
        </p>
      )}
      {groups.map((group) => (
        <section key={group.label} className="inbox-group" aria-label={group.label}>
          <h2 className="inbox-day">{group.label}</h2>
          <ol className="inbox-list">
            {group.entries.map((entry) => {
              const Icon = ICON[entry.kind]
              const actor = nameOf(entry.actorId)
              return (
                <li key={entry.id} className={entry.read ? 'inbox-row' : 'inbox-row unread'}>
                  <button type="button" className="inbox-entry" onClick={() => onOpen(entry)}>
                    <span className="inbox-avatar">
                      <Avatar name={actor} id={entry.actorId} size={30} />
                      <span className={`inbox-badge badge-${entry.kind}`}>
                        <Icon size={10} strokeWidth={2.5} aria-hidden="true" />
                      </span>
                    </span>
                    <span className="inbox-text">
                      <span className="inbox-line">
                        {!entry.read && <span className="inbox-dot" aria-label="Unread" />}
                        <strong>{actor}</strong> {WHAT[entry.kind]} <strong>{entry.itemKey}</strong>
                      </span>
                      <span className="inbox-title muted">{entry.itemTitle}</span>
                      {entry.excerpt && (
                        <span className="inbox-excerpt">
                          {entry.excerpt.replace(/@\[([^\]]+)\]\([^)]+\)/g, '@$1')}
                        </span>
                      )}
                    </span>
                    <span className="muted inbox-time">{timeAgo(entry.createdAt)}</span>
                  </button>
                  {!entry.read && (
                    <button
                      type="button"
                      className="inbox-read"
                      aria-label={`Mark ${entry.itemKey} as read`}
                      title="Mark as read"
                      onClick={() => onMarkRead(entry)}
                    >
                      <Check size={14} aria-hidden="true" />
                    </button>
                  )}
                </li>
              )
            })}
          </ol>
        </section>
      ))}
    </main>
  )
}
