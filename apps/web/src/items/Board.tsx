import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import {
  allowedDestinations,
  can,
  isEndStage,
  stageLoad,
  waiting,
  type UserPrincipal,
  type WorkItem,
} from '@wm/shared'
import type { Api, ApiTeam, ApiUser, Me } from './api'
import { shortDuration } from './item-model'
import { Avatar, KindIcon, PriorityIcon } from '../ui/kit'
import { ChevronLeft, ChevronRight, Clock, Ellipsis } from 'lucide-react'
import type { ItemStore } from './store'

interface Props {
  api: Api
  store: ItemStore
  teamId: string
  teams: readonly ApiTeam[]
  users: readonly ApiUser[]
  me: Me | null
  onOpenItem: (key: string) => void
  onTeamChange: (teamId: string) => void
}

/** Cards drawn per column; the rest are counted, so very full stages stay fast. */
const CARDS_PER_COLUMN = 150

const message = (error: unknown) =>
  error instanceof Error ? error.message : 'something went wrong'

/** One team's work by stage, with limits and waiting targets (specs/stage-limits.md). */
export function Board({ api, store, teamId, teams, users, me, onOpenItem, onTeamChange }: Props) {
  const revision = useSyncExternalStore(store.subscribeChanges, store.getRevision)
  const [enteredAt, setEnteredAt] = useState<Record<string, string>>({})
  const [dragging, setDragging] = useState<string | null>(null)
  const [over, setOver] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  // Finished and dropped stages start folded, so the working stages get the room.
  const [unfolded, setUnfolded] = useState<ReadonlySet<string>>(() => new Set())
  const [menuFor, setMenuFor] = useState<string | null>(null)
  useEffect(() => {
    if (!menuFor) return
    const close = (event: MouseEvent) => {
      if (!(event.target as HTMLElement).closest('.card-menu')) setMenuFor(null)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [menuFor])
  const [limitDraft, setLimitDraft] = useState({ itemLimit: '', targetHours: '' })
  const [limitsOverride, setLimitsOverride] = useState<
    Record<string, { itemLimit: number | null; targetHours: number | null }>
  >({})

  const team = teams.find((t) => t.id === teamId)
  const stages = useMemo(
    () => [...(team?.stages ?? [])].sort((a, b) => a.position - b.position),
    [team],
  )
  const items = useMemo(() => {
    void revision // re-read when any item changes
    return store.itemsForTeam(teamId)
  }, [store, teamId, revision])
  const byStage = useMemo(() => {
    const map = new Map<string, WorkItem[]>()
    for (const item of items) {
      const list = map.get(item.statusId)
      if (list) list.push(item)
      else map.set(item.statusId, [item])
    }
    return map
  }, [items])

  // Entry times come from the server; refresh a moment after things stop changing.
  useEffect(() => {
    let cancelled = false
    const timer = setTimeout(() => {
      api.board(teamId).then(
        (figures) => {
          if (!cancelled) setEnteredAt(figures.enteredAt)
        },
        (error: unknown) => {
          if (!cancelled) store.toast(`Could not load the board: ${message(error)}.`)
        },
      )
    }, 400)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [api, store, teamId, revision])

  if (!team) {
    return (
      <main className="item-page">
        <p className="muted">That team is not available.</p>
      </main>
    )
  }

  const principal: UserPrincipal | null = me ? { kind: 'user', ...me } : null
  const target = { team: { id: team.id, isPrivate: team.isPrivate } }
  const canConfigure = principal ? can(principal, 'team.config.edit', target) : false
  const canMove = principal ? can(principal, 'item.transition', target) : false
  const limitsOf = (key: string) =>
    limitsOverride[key] ??
    team.stageLimits.find((l) => l.stageKey === key) ?? { itemLimit: null, targetHours: null }
  const nameOf = (id: string | null) =>
    id ? (users.find((u) => u.id === id)?.name ?? id) : 'Unassigned'
  const now = Date.now()

  function drop(stageKey: string) {
    const id = dragging
    setDragging(null)
    setOver(null)
    if (id) moveItem(id, stageKey)
  }

  /** Drag and the card's "Move to" menu both end here (WCAG 2.5.7: dragging is never the only way). */
  function moveItem(id: string, stageKey: string) {
    const item = store.getItem(id)
    if (!item || item.statusId === stageKey) return
    const allowed = allowedDestinations(stages, item.statusId, team?.transitions ?? [])
    if (!allowed.includes(stageKey)) {
      const to = stages.find((s) => s.key === stageKey)?.name ?? stageKey
      store.toast(`${item.key}: it cannot go to ${to} from here. Open the item to see its moves.`)
      return
    }
    // The server checks requirements; a refusal is reverted with the reason.
    store.mutate(id, { statusId: stageKey })
  }

  async function saveLimits(stageKey: string) {
    const parse = (text: string) => (text.trim() === '' ? null : Number(text))
    const next = {
      itemLimit: parse(limitDraft.itemLimit),
      targetHours: parse(limitDraft.targetHours),
    }
    try {
      await api.setLimits(team!.id, stageKey, next.itemLimit, next.targetHours)
      setLimitsOverride((all) => ({ ...all, [stageKey]: next }))
      setEditing(null)
    } catch (error) {
      store.toast(`${message(error)}.`)
    }
  }

  // Summary strip: what needs attention on this board right now.
  const working = stages.filter((stage) => !isEndStage(stage))
  const openCount = working.reduce((sum, stage) => sum + (byStage.get(stage.key)?.length ?? 0), 0)
  let pastTarget = 0
  for (const stage of working) {
    const { targetHours } = limitsOf(stage.key)
    if (targetHours === null) continue
    for (const item of byStage.get(stage.key) ?? []) {
      const entered = enteredAt[item.id]
      if (entered && waiting(entered, targetHours, now).overdue) pastTarget++
    }
  }
  const overLimit = working.filter(
    (stage) =>
      stageLoad(byStage.get(stage.key)?.length ?? 0, limitsOf(stage.key).itemLimit) ===
      'over_limit',
  )
  const finished = stages
    .filter((stage) => stage.category === 'done')
    .reduce((sum, stage) => sum + (byStage.get(stage.key)?.length ?? 0), 0)

  return (
    <main className="board-page" aria-label={`${team.name} board`}>
      <div className="board-head">
        <label className="muted">
          Board for{' '}
          <select value={team.id} onChange={(event) => onTeamChange(event.target.value)}>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <div className="board-summary" aria-label="Board summary">
          <span>
            <b>{openCount.toLocaleString()}</b> open
          </span>
          <span className={pastTarget > 0 ? 'summary-bad' : undefined}>
            <b>{pastTarget}</b> past target
          </span>
          <span className={overLimit.length > 0 ? 'summary-bad' : undefined}>
            <b>{overLimit.length}</b> stage{overLimit.length === 1 ? '' : 's'} over limit
            {overLimit.length > 0 ? ` (${overLimit.map((s) => s.name).join(', ')})` : ''}
          </span>
          <span>
            <b>{finished.toLocaleString()}</b> finished
          </span>
        </div>
        <div className="board-key muted" aria-label="Key">
          <span>
            <i className="key-bar key-ok" /> under limit
          </span>
          <span>
            <i className="key-bar key-at" /> at limit
          </span>
          <span>
            <i className="key-bar key-over" /> over limit
          </span>
          <span>
            <Clock size={12} aria-hidden="true" className="late-text" /> past target
          </span>
          <span>Drag a card, or use its ⋯ menu</span>
        </div>
      </div>

      <div className="board">
        {stages.map((stage) => {
          const cards = byStage.get(stage.key) ?? []
          const { itemLimit, targetHours } = limitsOf(stage.key)
          const load = stageLoad(cards.length, itemLimit)
          const end = isEndStage(stage)
          const folded = end && !unfolded.has(stage.key)
          const dropProps = {
            onDragOver: (event: React.DragEvent) => {
              if (!dragging) return
              event.preventDefault()
              setOver(stage.key)
            },
            onDragLeave: () => setOver((key) => (key === stage.key ? null : key)),
            onDrop: (event: React.DragEvent) => {
              event.preventDefault()
              drop(stage.key)
            },
          }
          if (folded) {
            return (
              <section
                key={stage.key}
                className={`board-column board-folded${over === stage.key ? ' board-drop' : ''}`}
                aria-label={`${stage.name}, ${cards.length} items, folded`}
                {...dropProps}
              >
                <button
                  type="button"
                  className="fold-button"
                  aria-expanded="false"
                  onClick={() => setUnfolded((all) => new Set([...all, stage.key]))}
                  title={`Show ${stage.name}`}
                >
                  <ChevronRight size={14} aria-hidden="true" />
                  <span className="fold-name">{stage.name}</span>
                  <span className="board-count">{cards.length.toLocaleString()}</span>
                </button>
              </section>
            )
          }
          return (
            <section
              key={stage.key}
              className={`board-column${end ? ' board-column-end' : ''}${over === stage.key ? ' board-drop' : ''}`}
              aria-label={stage.name}
              {...dropProps}
            >
              <header className="board-column-head">
                {end && (
                  <button
                    type="button"
                    className="fold-inline"
                    aria-expanded="true"
                    aria-label={`Fold ${stage.name}`}
                    onClick={() =>
                      setUnfolded((all) => {
                        const next = new Set(all)
                        next.delete(stage.key)
                        return next
                      })
                    }
                  >
                    <ChevronLeft size={14} aria-hidden="true" />
                  </button>
                )}
                <span className="stage-name">{stage.name}</span>
                <span className={`board-count load-${load}`}>
                  {cards.length}
                  {itemLimit !== null ? ` / ${itemLimit}` : ''}
                </span>
              </header>
              {itemLimit !== null && (
                <div
                  className={`limit-bar load-bar-${load}`}
                  role="meter"
                  aria-label={`${cards.length} of ${itemLimit} item limit`}
                  aria-valuemin={0}
                  aria-valuemax={itemLimit}
                  aria-valuenow={cards.length}
                >
                  <span style={{ width: `${Math.min(100, (cards.length / itemLimit) * 100)}%` }} />
                </div>
              )}
              {(targetHours !== null || (canConfigure && !end)) && (
                <div className="board-column-meta muted">
                  {targetHours !== null ? `Target ${shortDuration(targetHours)}` : ''}
                  {canConfigure && !end && editing !== stage.key && (
                    <button
                      type="button"
                      className="link-button"
                      onClick={() => {
                        setEditing(stage.key)
                        setLimitDraft({
                          itemLimit: itemLimit === null ? '' : String(itemLimit),
                          targetHours: targetHours === null ? '' : String(targetHours),
                        })
                      }}
                    >
                      Limits
                    </button>
                  )}
                </div>
              )}
              {editing === stage.key && (
                <form
                  className="limit-form"
                  onSubmit={(event) => {
                    event.preventDefault()
                    void saveLimits(stage.key)
                  }}
                >
                  <label>
                    Item limit
                    <input
                      type="number"
                      min={1}
                      max={999}
                      value={limitDraft.itemLimit}
                      onChange={(e) => setLimitDraft({ ...limitDraft, itemLimit: e.target.value })}
                    />
                  </label>
                  <label>
                    Target (hours)
                    <input
                      type="number"
                      min={1}
                      max={8760}
                      value={limitDraft.targetHours}
                      onChange={(e) =>
                        setLimitDraft({ ...limitDraft, targetHours: e.target.value })
                      }
                    />
                  </label>
                  <div className="move-row">
                    <button type="submit" className="button button-primary">
                      Save
                    </button>
                    <button type="button" className="button" onClick={() => setEditing(null)}>
                      Cancel
                    </button>
                  </div>
                  <span className="muted">
                    Leave empty for none. Limits warn; they never block.
                  </span>
                </form>
              )}
              <ol className="board-cards">
                {cards.slice(0, CARDS_PER_COLUMN).map((item) => {
                  const entered = enteredAt[item.id]
                  const wait = entered && !end ? waiting(entered, targetHours, now) : null
                  const priority = Number(item.fields.priority ?? 0)
                  const owner = item.assigneeId ? nameOf(item.assigneeId) : null
                  const destinations = canMove
                    ? allowedDestinations(stages, item.statusId, team.transitions ?? [])
                        .map((key) => stages.find((s) => s.key === key))
                        .filter((s): s is NonNullable<typeof s> => s !== undefined)
                    : []
                  return (
                    <li key={item.id}>
                      <div
                        className={`board-card${dragging === item.id ? ' board-card-dragging' : ''}${wait?.overdue ? ' board-card-late' : ''}`}
                        draggable={canMove}
                        onDragStart={(event) => {
                          event.dataTransfer.effectAllowed = 'move'
                          event.dataTransfer.setData('text/plain', item.key)
                          setDragging(item.id)
                        }}
                        onDragEnd={() => {
                          setDragging(null)
                          setOver(null)
                        }}
                      >
                        <button
                          type="button"
                          className="card-open"
                          onClick={() => onOpenItem(item.key)}
                        >
                          <span className="card-top">
                            <KindIcon kind={item.kind} />
                            <span className="board-card-key">{item.key}</span>
                            <PriorityIcon level={priority} />
                          </span>
                          <span className="board-card-title">{item.title}</span>
                          <span className="board-card-foot">
                            <span className="person">
                              <Avatar name={owner} id={item.assigneeId} size={18} />
                              <span className="muted">{owner ?? 'Unassigned'}</span>
                            </span>
                            {wait && (
                              <span
                                className={wait.overdue ? 'board-wait overdue' : 'board-wait'}
                                title={
                                  wait.overdue
                                    ? `Waiting longer than the ${shortDuration(targetHours ?? 0)} target`
                                    : 'Time in this stage'
                                }
                              >
                                {wait.overdue && <Clock size={11} aria-hidden="true" />}
                                {shortDuration(wait.hours)}
                                {wait.overdue && <span className="sr-only"> past target</span>}
                              </span>
                            )}
                          </span>
                        </button>
                        {destinations.length > 0 && (
                          <div className="card-menu">
                            <button
                              type="button"
                              className="card-menu-button"
                              aria-label={`Move ${item.key} to…`}
                              aria-haspopup="menu"
                              aria-expanded={menuFor === item.id}
                              onClick={() => setMenuFor((id) => (id === item.id ? null : item.id))}
                            >
                              <Ellipsis size={14} aria-hidden="true" />
                            </button>
                            {menuFor === item.id && (
                              <div
                                className="menu"
                                role="menu"
                                onKeyDown={(event) => {
                                  if (event.key === 'Escape') {
                                    event.stopPropagation()
                                    setMenuFor(null)
                                  }
                                }}
                              >
                                <span className="menu-title">Move to</span>
                                {destinations.map((to) => (
                                  <button
                                    key={to.key}
                                    type="button"
                                    role="menuitem"
                                    className="menu-item"
                                    autoFocus={to === destinations[0]}
                                    onClick={() => {
                                      setMenuFor(null)
                                      moveItem(item.id, to.key)
                                    }}
                                  >
                                    {to.name}
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </li>
                  )
                })}
              </ol>
              {cards.length > CARDS_PER_COLUMN && (
                <p className="muted board-more">
                  + {(cards.length - CARDS_PER_COLUMN).toLocaleString()} more; use the list to
                  filter
                </p>
              )}
            </section>
          )
        })}
      </div>
    </main>
  )
}
