import { Inbox as InboxIcon } from 'lucide-react'
import { useState } from 'react'
import { Avatar, Button, Card, EmptyState, Tabs } from '../design/components'
import { workApi, type InboxEntry } from './core-api'
import { nameOf, plainText, useAppData, useLoad } from './data'
import { hrefFor } from './routes'

export const INBOX_WHAT: Record<string, string> = {
  mentioned: 'mentioned you on',
  assigned: 'made you the owner of',
  review_requested: 'asked you to review',
  review_approved: 'approved',
  review_changes_requested: 'asked for changes on',
  commented: 'commented on',
  run_started: 'started a new run of',
  run_blocked: 'could not start the next run of',
  request_new: 'sent a new request:',
  request_update: 'updated the request',
}

type Filter = 'all' | 'unread' | 'mentions' | 'reviews'

export function InboxPage() {
  const { people } = useAppData()
  const loaded = useLoad(() => workApi.inbox(), 'inbox')
  const [filter, setFilter] = useState<Filter>('unread')
  const entries = (loaded.data?.entries ?? []).filter((e) =>
    filter === 'all'
      ? true
      : filter === 'unread'
        ? !e.read
        : filter === 'mentions'
          ? e.kind === 'mentioned'
          : e.kind.startsWith('review'),
  )
  const open = async (e: InboxEntry) => {
    if (!e.read) await workApi.markRead([e.id]).catch(() => undefined)
    window.location.hash = hrefFor({ page: 'item', key: e.itemKey })
  }
  return (
    <div className="mx-page">
      <header className="mx-page-head mx-head-row">
        <div>
          <h1 className="md-h1">Inbox</h1>
          <p className="mx-intro">{loaded.data ? `${loaded.data.unread} unread` : 'Loading…'}</p>
        </div>
        <Button size="s" onClick={() => workApi.markRead().then(loaded.reload)}>
          Mark all read
        </Button>
      </header>
      <Tabs
        label="Show"
        variant="pill"
        value={filter}
        onChange={setFilter}
        options={[
          { id: 'unread', label: 'Unread' },
          { id: 'all', label: 'All' },
          { id: 'mentions', label: 'Mentions' },
          { id: 'reviews', label: 'Reviews' },
        ]}
      />
      <Card className="mx-list-group">
        {loaded.error ? <p className="md-field-error">{loaded.error}</p> : null}
        {loaded.data && entries.length === 0 ? (
          <EmptyState
            icon={<InboxIcon size={20} />}
            title="All caught up"
            text="New mentions, reviews and runs will show up here."
          />
        ) : null}
        {entries.map((e) => (
          <button
            key={e.id}
            type="button"
            className={e.read ? 'mx-list-row' : 'mx-list-row mx-unread'}
            onClick={() => void open(e)}
          >
            <Avatar name={nameOf(people, e.actorId) ?? 'Work Platform'} size={32} />
            <span className="mx-grow">
              <span className="mx-block">
                <b>{e.actorId ? nameOf(people, e.actorId) : 'Work Platform'}</b>{' '}
                {INBOX_WHAT[e.kind] ?? e.kind} {e.itemKey} {e.itemTitle}
              </span>
              {e.excerpt ? <span className="md-meta">“{plainText(e.excerpt)}”</span> : null}
            </span>
            <span className="md-meta">
              {new Date(e.createdAt).toLocaleString('en-GB', {
                day: 'numeric',
                month: 'short',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </span>
            {!e.read ? <span className="mx-unread-dot" aria-label="unread" /> : null}
          </button>
        ))}
      </Card>
    </div>
  )
}
