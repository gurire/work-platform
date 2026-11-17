/**
 * People (redesign step 6): who is in which team and how much open work each person has,
 * across every team you can see. It shows load, never speed (specs/dashboards.md, section 2).
 */
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { ChevronDown, ChevronRight, Search } from 'lucide-react'
import type { WorkItem } from '@wm/shared'
import type { Api, ApiTeam, Person } from '../items/api'
import { itemHash } from '../items/item-model'
import type { ItemStore } from '../items/store'
import { Avatar, KindIcon, PriorityIcon, StageChip, TeamTile, stageLook } from '../ui/kit'

interface Props {
  api: Api
  store: ItemStore
  teams: readonly ApiTeam[]
}

const ROLE: Record<string, string> = {
  org_admin: 'Org admin',
  member: 'Member',
  viewer: 'Viewer',
  admin: 'admin',
  reviewer: 'reviewer',
}

interface Load {
  open: WorkItem[]
  doing: number
  next: number
  urgent: number
  byTeam: Map<string, number>
}

export function People({ api, store, teams }: Props) {
  const [people, setPeople] = useState<readonly Person[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<'load' | 'name'>('load')
  const [open, setOpen] = useState<string | null>(null)
  const revision = useSyncExternalStore(store.subscribeChanges, store.getRevision)

  useEffect(() => {
    api.people().then(
      (body) => setPeople(body.people),
      (e: unknown) => setError(e instanceof Error ? e.message : 'could not load'),
    )
  }, [api])

  // Open items per person, from the items you can see (never from hidden teams).
  const loads = useMemo(() => {
    void revision
    const map = new Map<string, Load>()
    for (const team of teams) {
      for (const item of store.itemsForTeam(team.id)) {
        if (!item.assigneeId) continue
        if (item.statusCategory !== 'todo' && item.statusCategory !== 'in_progress') continue
        const load: Load = map.get(item.assigneeId) ?? {
          open: [],
          doing: 0,
          next: 0,
          urgent: 0,
          byTeam: new Map<string, number>(),
        }
        load.open.push(item)
        if (item.statusCategory === 'in_progress') load.doing++
        else load.next++
        if (Number(item.fields.priority ?? 0) >= 4) load.urgent++
        load.byTeam.set(item.teamId, (load.byTeam.get(item.teamId) ?? 0) + 1)
        map.set(item.assigneeId, load)
      }
    }
    return map
  }, [store, teams, revision])

  if (error)
    return (
      <main className="people">
        <p className="muted">Could not load people: {error}</p>
      </main>
    )
  if (!people)
    return (
      <main className="people">
        <p className="muted" role="status">
          Loading…
        </p>
      </main>
    )

  const teamName = (id: string) => teams.find((t) => t.id === id)?.name ?? id
  const max = Math.max(1, ...[...loads.values()].map((l) => l.open.length))
  const shown = people
    .filter((p) => p.name.toLowerCase().includes(query.trim().toLowerCase()))
    .sort((a, b) =>
      sort === 'name'
        ? a.name.localeCompare(b.name)
        : (loads.get(b.id)?.open.length ?? 0) - (loads.get(a.id)?.open.length ?? 0) ||
          a.name.localeCompare(b.name),
    )

  return (
    <main className="people" aria-labelledby="people-title">
      <header className="people-head">
        <div>
          <h1 id="people-title">People</h1>
          <p className="muted">
            {people.length} people · open work across the teams you can see. This shows load, not
            speed.
          </p>
        </div>
        <label className="people-search">
          <Search size={14} aria-hidden="true" />
          <input
            type="search"
            placeholder="Find a person"
            aria-label="Find a person"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <label className="view-select">
          <span className="muted">Sort</span>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as 'load' | 'name')}
            aria-label="Sort people"
          >
            <option value="load">Most open work</option>
            <option value="name">Name</option>
          </select>
        </label>
      </header>

      <div className="people-legend" aria-label="Team colours">
        {teams.map((team, index) => (
          <span key={team.id}>
            <i className={`seg seg-${index % 6}`} />
            {team.name}
          </span>
        ))}
      </div>
      <div className="card people-table" role="table" aria-label="People and their open work">
        <div role="row" className="people-row people-headrow">
          <span role="columnheader">Person</span>
          <span role="columnheader">Teams</span>
          <span role="columnheader">In progress</span>
          <span role="columnheader">Up next</span>
          <span role="columnheader">Urgent</span>
          <span role="columnheader">Open work by team</span>
        </div>
        {shown.map((person) => {
          const load = loads.get(person.id)
          const total = load?.open.length ?? 0
          const expanded = open === person.id
          return (
            <div
              key={person.id}
              role="rowgroup"
              className={expanded ? 'people-group open' : 'people-group'}
            >
              <div role="row" className="people-row">
                <span role="rowheader">
                  <button
                    type="button"
                    className="person-toggle"
                    aria-expanded={expanded}
                    disabled={total === 0}
                    onClick={() => setOpen(expanded ? null : person.id)}
                  >
                    {total > 0 ? (
                      expanded ? (
                        <ChevronDown size={14} aria-hidden="true" />
                      ) : (
                        <ChevronRight size={14} aria-hidden="true" />
                      )
                    ) : (
                      <span className="chev-space" />
                    )}
                    <Avatar name={person.name} id={person.id} size={28} />
                    <span className="person-name">
                      <b>{person.name}</b>
                      <small className="muted">{ROLE[person.orgRole] ?? person.orgRole}</small>
                    </span>
                  </button>
                </span>
                <span role="cell" className="person-teams">
                  {person.teams.length === 0 && <span className="muted">No team</span>}
                  {person.teams.map((m) => (
                    <span
                      key={m.teamId}
                      className="team-chip"
                      title={`${teamName(m.teamId)} · ${ROLE[m.role] ?? m.role}`}
                    >
                      <TeamTile id={m.teamId} name={teamName(m.teamId)} size={16} />
                      {teamName(m.teamId)}
                      {m.role !== 'member' && <small> · {ROLE[m.role] ?? m.role}</small>}
                    </span>
                  ))}
                </span>
                <span role="cell" className="num">
                  {load?.doing ?? 0}
                </span>
                <span role="cell" className="num">
                  {load?.next ?? 0}
                </span>
                <span role="cell" className={load?.urgent ? 'num urgent-num' : 'num'}>
                  {load?.urgent ?? 0}
                </span>
                <span role="cell" className="load-cell">
                  <span
                    className="load-bar"
                    aria-hidden="true"
                    style={{ width: `${(total / max) * 100}%` }}
                  >
                    {[...(load?.byTeam.entries() ?? [])].map(([teamId, n]) => (
                      <i
                        key={teamId}
                        style={{ flexGrow: n }}
                        className={`seg seg-${teams.findIndex((t) => t.id === teamId) % 6}`}
                        title={`${teamName(teamId)}: ${n}`}
                      />
                    ))}
                  </span>
                  <span className="load-total">
                    {total}
                    <span className="sr-only">
                      {' '}
                      open:{' '}
                      {[...(load?.byTeam.entries() ?? [])]
                        .map(([t, n]) => `${teamName(t)} ${n}`)
                        .join(', ')}
                    </span>
                  </span>
                </span>
              </div>
              {expanded && load && (
                <ul className="person-items">
                  {[...load.open]
                    .sort(
                      (a, b) =>
                        Number(b.fields.priority ?? 0) - Number(a.fields.priority ?? 0) ||
                        a.key.localeCompare(b.key, undefined, { numeric: true }),
                    )
                    .slice(0, 15)
                    .map((item) => {
                      const team = teams.find((t) => t.id === item.teamId)
                      return (
                        <li key={item.id}>
                          <a href={itemHash(item.key)} className="mine-row">
                            <PriorityIcon level={Number(item.fields.priority ?? 0)} />
                            <KindIcon kind={item.kind} />
                            <span className="mine-key">{item.key}</span>
                            <span className="mine-title">{item.title}</span>
                            {team && <StageChip look={stageLook(team.stages, item.statusId)} />}
                            {team && <TeamTile id={team.id} name={team.name} size={18} />}
                          </a>
                        </li>
                      )
                    })}
                  {load.open.length > 15 && (
                    <li className="more muted">and {load.open.length - 15} more</li>
                  )}
                </ul>
              )}
            </div>
          )
        })}
      </div>
    </main>
  )
}
