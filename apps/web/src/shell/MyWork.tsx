/**
 * My work: what is yours, and what needs you (redesign step 2, the "Main" mock-up).
 */
import { useMemo, useSyncExternalStore } from 'react'
import type { WorkItem } from '@wm/shared'
import type { ApiTeam, ApiUser, InboxEntry, Me } from '../items/api'
import { WHAT } from '../items/Inbox'
import { itemHash, timeAgo } from '../items/item-model'
import type { ItemStore } from '../items/store'
import { Avatar, KindIcon, PriorityIcon, StageChip, TeamTile, stageLook } from '../ui/kit'

interface Props {
  store: ItemStore
  me: Me | null
  teams: readonly ApiTeam[]
  users: readonly ApiUser[]
  inbox: readonly InboxEntry[] | null
}

function greeting(hour: number): string {
  if (hour < 12) return 'Good morning'
  if (hour < 17) return 'Good afternoon'
  return 'Good evening'
}

export function MyWork({ store, me, teams, users, inbox }: Props) {
  const revision = useSyncExternalStore(store.subscribeChanges, store.getRevision)
  const mine = useMemo(() => {
    void revision
    if (!me) return []
    return teams
      .flatMap((team) => store.itemsForTeam(team.id))
      .filter((item) => item.assigneeId === me.id)
  }, [store, me, teams, revision])
  const byPriority = (a: WorkItem, b: WorkItem) =>
    Number(b.fields.priority ?? 0) - Number(a.fields.priority ?? 0) ||
    a.key.localeCompare(b.key, undefined, { numeric: true })
  const doing = mine.filter((i) => i.statusCategory === 'in_progress').sort(byPriority)
  const next = mine.filter((i) => i.statusCategory === 'todo').sort(byPriority)
  const done = mine.filter((i) => i.statusCategory === 'done').length
  const unread = (inbox ?? []).filter((e) => !e.read)
  const urgent = mine.filter(
    (i) =>
      i.statusCategory !== 'done' &&
      i.statusCategory !== 'cancelled' &&
      Number(i.fields.priority ?? 0) >= 4,
  ).length
  const nameOf = (id: string | null) => (id ? (users.find((u) => u.id === id)?.name ?? id) : null)
  const firstName = me?.name.split(' ')[0] ?? ''

  return (
    <main className="mywork" aria-labelledby="mywork-title">
      <header className="mywork-head">
        <h1 id="mywork-title">
          {greeting(new Date().getHours())}
          {firstName ? `, ${firstName}` : ''}
        </h1>
        <p className="muted">
          {new Date().toLocaleDateString('en-GB', {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
          })}
        </p>
      </header>

      <section className="mywork-stats" aria-label="Summary">
        <Stat label="In progress" value={doing.length} />
        <Stat label="Up next" value={next.length} />
        <Stat label="Urgent" value={urgent} tone={urgent > 0 ? 'bad' : undefined} />
        <Stat label="Unread in inbox" value={unread.length} />
        <Stat label="Finished, all time" value={done} />
      </section>

      <div className="mywork-grid">
        <section className="card mywork-card" aria-labelledby="needs-title">
          <div className="card-head">
            <h2 id="needs-title">Needs you</h2>
            <a href="#/inbox">Open inbox</a>
          </div>
          {unread.length === 0 ? (
            <p className="empty">Nothing waiting on you. Nice.</p>
          ) : (
            <ul className="needs">
              {unread.slice(0, 6).map((entry) => (
                <li key={entry.id}>
                  <a href={itemHash(entry.itemKey)} className="needs-row">
                    <Avatar
                      name={nameOf(entry.actorId) ?? 'Someone'}
                      id={entry.actorId}
                      size={24}
                    />
                    <span className="needs-text">
                      <span>
                        <b>{nameOf(entry.actorId) ?? 'Someone'}</b> {WHAT[entry.kind]}{' '}
                        <b>{entry.itemKey}</b>
                      </span>
                      <small className="muted">
                        {entry.itemTitle} · {timeAgo(entry.createdAt, Date.now())}
                      </small>
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </section>

        <ItemGroup
          title="In progress"
          items={doing}
          teams={teams}
          empty="Nothing in progress. Pick something from Up next."
        />
        <ItemGroup title="Up next" items={next} teams={teams} empty="Nothing queued for you." />
      </div>
    </main>
  )
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'bad' }) {
  return (
    <div className="card stat">
      <span className="stat-label">{label}</span>
      <span className={tone === 'bad' ? 'stat-value stat-bad' : 'stat-value'}>{value}</span>
    </div>
  )
}

function ItemGroup({
  title,
  items,
  teams,
  empty,
}: {
  title: string
  items: readonly WorkItem[]
  teams: readonly ApiTeam[]
  empty: string
}) {
  const shown = items.slice(0, 12)
  return (
    <section className="card mywork-card" aria-label={title}>
      <div className="card-head">
        <h2>
          {title} <span className="muted">{items.length}</span>
        </h2>
      </div>
      {items.length === 0 ? (
        <p className="empty">{empty}</p>
      ) : (
        <ul className="mine">
          {shown.map((item) => {
            const team = teams.find((t) => t.id === item.teamId)
            const priority = Number(item.fields.priority ?? 0)
            return (
              <li key={item.id}>
                <a href={itemHash(item.key)} className="mine-row">
                  <PriorityIcon level={priority} />
                  <KindIcon kind={item.kind} />
                  <span className="mine-key">{item.key}</span>
                  <span className="mine-title">{item.title}</span>
                  {team && <StageChip look={stageLook(team.stages, item.statusId)} />}
                  {team && (
                    <span title={team.name}>
                      <TeamTile id={team.id} name={team.name} size={18} />
                    </span>
                  )}
                </a>
              </li>
            )
          })}
        </ul>
      )}
      {items.length > shown.length && (
        <p className="more muted">and {items.length - shown.length} more in the list</p>
      )}
    </section>
  )
}
