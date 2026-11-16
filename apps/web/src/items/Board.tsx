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
    if (!id) return
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
        <span className="muted">
          {items.length.toLocaleString()} items · drag a card to move it · Esc back to the list
        </span>
      </div>

      <div className="board">
        {stages.map((stage) => {
          const cards = byStage.get(stage.key) ?? []
          const { itemLimit, targetHours } = limitsOf(stage.key)
          const load = stageLoad(cards.length, itemLimit)
          const end = isEndStage(stage)
          return (
            <section
              key={stage.key}
              className={`board-column${end ? ' board-column-end' : ''}${over === stage.key ? ' board-drop' : ''}`}
              aria-label={stage.name}
              onDragOver={(event) => {
                if (!dragging) return
                event.preventDefault()
                setOver(stage.key)
              }}
              onDragLeave={() => setOver((key) => (key === stage.key ? null : key))}
              onDrop={(event) => {
                event.preventDefault()
                drop(stage.key)
              }}
            >
              <header className="board-column-head">
                <span className="stage-name">{stage.name}</span>
                <span className={`board-count load-${load}`}>
                  {cards.length}
                  {itemLimit !== null ? ` / ${itemLimit}` : ''}
                </span>
              </header>
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
                  return (
                    <li key={item.id}>
                      <button
                        type="button"
                        className={`board-card${dragging === item.id ? ' board-card-dragging' : ''}`}
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
                        onClick={() => onOpenItem(item.key)}
                      >
                        <span className="board-card-key">{item.key}</span>
                        <span className="board-card-title">{item.title}</span>
                        <span className="board-card-foot">
                          <span className="muted">{nameOf(item.assigneeId)}</span>
                          {wait && (
                            <span
                              className={wait.overdue ? 'board-wait overdue' : 'board-wait'}
                              title={
                                wait.overdue
                                  ? `Waiting longer than the ${shortDuration(targetHours ?? 0)} target`
                                  : 'Time in this stage'
                              }
                            >
                              {shortDuration(wait.hours)}
                            </span>
                          )}
                        </span>
                      </button>
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
