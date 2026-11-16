import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { allowedDestinations, SAMPLE_PRIORITIES } from '@wm/shared'
import { createApi, type ApiTeam, type ApiUser, type Me } from './api'
import { CommandPalette, type Command } from './CommandPalette'
import { itemHash, parseRoute, type Route } from './item-model'
import { ItemPage } from './ItemPage'
import { ItemList, type Density } from './ItemList'
import { measureInteraction, perfStore } from './perf'
import { ItemStore, type CategoryFilter, type ItemPatch } from './store'
import './items.css'

const DENSITIES: readonly Density[] = ['compact', 'default', 'comfortable']
const CATEGORIES: readonly { id: CategoryFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'todo', label: 'To do' },
  { id: 'in_progress', label: 'In progress' },
  { id: 'done', label: 'Done' },
]
type PaletteMode = 'all' | 'status' | 'assignee' | 'priority'
type Theme = 'light' | 'dark'

const USER_KEY = 'wm-dev-user'
function readDevUser(): string {
  try {
    return localStorage.getItem(USER_KEY) ?? 'user-3'
  } catch {
    return 'user-3'
  }
}
let devUser = readDevUser()
const api = createApi(() => devUser)
const store = new ItemStore(api.saveItem)

interface LoadState {
  readonly status: 'loading' | 'ready' | 'error'
  readonly ms: number
  readonly message?: string
}

export function ItemsScreen() {
  const view = useSyncExternalStore(store.subscribe, store.getView)
  const toasts = useSyncExternalStore(store.subscribe, store.getToasts)
  const perf = useSyncExternalStore(perfStore.subscribe, perfStore.get)
  const [cursor, setCursor] = useState(0)
  const [density, setDensity] = useState<Density>('default')
  const [theme, setTheme] = useState<Theme>(() =>
    window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
  )
  const [palette, setPalette] = useState<PaletteMode | null>(null)
  const [userId, setUserId] = useState(devUser)
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.hash))
  const [me, setMe] = useState<Me | null>(null)
  const [users, setUsers] = useState<readonly ApiUser[]>([])
  const [teams, setTeams] = useState<readonly ApiTeam[]>([])
  const [load, setLoad] = useState<LoadState>({ status: 'loading', ms: 0 })
  const [renderedRows, setRenderedRows] = useState(0)
  const filterRef = useRef<HTMLInputElement>(null)
  const eventTime = useRef(0)

  const ids = view.ids
  const safeCursor = Math.min(cursor, Math.max(ids.length - 1, 0))
  // On an item page, commands act on that item; on the list, on the selected row.
  const currentId = route.page === 'item' ? store.idForKey(route.key) : ids[safeCursor]
  const routeIndex = route.page === 'item' && currentId ? ids.indexOf(currentId) : -1

  // The address bar holds the open item (#/item/KEY), so links and Back work.
  useEffect(() => {
    const onHash = () => setRoute(parseRoute(window.location.hash))
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  // Keep the list selection on the open item, so going back lands on it.
  useEffect(() => {
    if (routeIndex >= 0) setCursor(routeIndex)
  }, [routeIndex])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  // Load who we are, the people list, then items page by page so the list fills in as it arrives.
  useEffect(() => {
    let cancelled = false
    const started = performance.now()
    devUser = userId
    try {
      localStorage.setItem(USER_KEY, userId)
    } catch {
      // Storage can be unavailable; the choice then lasts for this page only.
    }
    store.reset()
    setCursor(0)
    setMe(null)
    setLoad({ status: 'loading', ms: 0 })
    async function run(): Promise<void> {
      const [meResult, userList, teamList] = await Promise.all([api.me(), api.users(), api.teams()])
      if (cancelled) return
      setMe(meResult)
      setUsers(userList)
      setTeams(teamList)
      store.setStages(teamList.flatMap((team) => team.stages))
      let after: string | null = null
      do {
        const page = await api.itemsPage(after)
        if (cancelled) return
        store.append(page.items)
        after = page.nextAfter
      } while (after)
      setLoad({ status: 'ready', ms: performance.now() - started })
    }
    run().catch((error: unknown) => {
      if (cancelled) return
      const message = error instanceof Error ? error.message : 'loading failed'
      setLoad({ status: 'error', ms: performance.now() - started, message })
    })
    return () => {
      cancelled = true
    }
  }, [userId])

  const userNames = useMemo(() => new Map(users.map((u) => [u.id, u.name])), [users])
  const stageNames = useMemo(
    () =>
      new Map(
        teams.flatMap((team) =>
          team.stages.map((stage) => [`${stage.teamId}:${stage.key}`, stage.name] as const),
        ),
      ),
    [teams],
  )
  const currentItem = useSyncExternalStore(
    (listener) => (currentId ? store.subscribeItem(currentId, listener) : () => {}),
    () => (currentId ? store.getItem(currentId) : undefined),
  )
  const currentTeam = teams.find((team) => team.id === currentItem?.teamId)

  const edit = useCallback(
    (label: string, patch: ItemPatch) => {
      if (!currentId) return
      store.mutate(currentId, patch)
      measureInteraction(label, eventTime.current || performance.now())
    },
    [currentId],
  )

  const openItem = useCallback((key: string) => {
    window.location.hash = itemHash(key)
  }, [])
  const backToList = useCallback(() => {
    window.history.pushState(null, '', window.location.pathname + window.location.search)
    setRoute({ page: 'list' })
  }, [])
  const stepItem = useCallback(
    (delta: number) => {
      const next = ids[routeIndex + delta]
      const item = next ? store.getItem(next) : undefined
      if (routeIndex >= 0 && item) openItem(item.key)
    },
    [ids, routeIndex, openItem],
  )

  const move = useCallback(
    (delta: number, start: number) => {
      setCursor((value) => Math.max(0, Math.min(ids.length - 1, value + delta)))
      measureInteraction('Move selection', start)
    },
    [ids.length],
  )

  const cycleDensity = useCallback(() => {
    setDensity((value) => DENSITIES[(DENSITIES.indexOf(value) + 1) % DENSITIES.length] ?? 'default')
  }, [])
  const toggleTheme = useCallback(() => setTheme((t) => (t === 'dark' ? 'light' : 'dark')), [])
  const commands = useMemo<Command[]>(() => {
    // Only the stages the selected item may move to are offered (specs/workflow.md).
    const reachable = new Set(
      currentTeam && currentItem
        ? allowedDestinations(currentTeam.stages, currentItem.statusId, currentTeam.transitions)
        : [],
    )
    const status = (currentTeam?.stages ?? [])
      .filter((s) => reachable.has(s.key))
      .map((s) => ({
        id: `status-${s.key}`,
        group: 'Move to stage',
        label: s.name,
        run: () => edit('Change stage', { statusId: s.key }),
      }))
    const assignee = [
      {
        id: 'assign-none',
        group: 'Assign to',
        label: 'Unassigned',
        run: () => edit('Change assignee', { assigneeId: null }),
      },
      ...users.map((u) => ({
        id: `assign-${u.id}`,
        group: 'Assign to',
        label: u.name,
        run: () => edit('Change assignee', { assigneeId: u.id }),
      })),
    ]
    const priority = SAMPLE_PRIORITIES.map((name, value) => ({
      id: `priority-${value}`,
      group: 'Set priority',
      label: name,
      run: () => edit('Change priority', { priority: value }),
    }))
    if (palette === 'status') return status
    if (palette === 'assignee') return assignee
    if (palette === 'priority') return priority
    return [
      ...status,
      ...assignee,
      ...priority,
      {
        id: 'undo',
        group: 'Edit',
        label: 'Undo last change',
        shortcut: 'Ctrl Z',
        run: () => store.undo(),
      },
      {
        id: 'theme',
        group: 'View',
        label: 'Toggle light / dark theme',
        shortcut: 'T',
        run: toggleTheme,
      },
      {
        id: 'density',
        group: 'View',
        label: 'Cycle row density',
        shortcut: 'D',
        run: cycleDensity,
      },
      {
        id: 'filter',
        group: 'View',
        label: 'Focus filter',
        shortcut: '/',
        run: () => filterRef.current?.focus(),
      },
      ...users.map((u) => ({
        id: `signin-${u.id}`,
        group: 'Dev sign-in',
        label: `Act as ${u.name}`,
        run: () => setUserId(u.id),
      })),
    ]
  }, [palette, edit, toggleTheme, cycleDensity, users, currentTeam, currentItem])

  const dynamicCommands = useCallback(
    (query: string): Command[] => {
      if (palette !== 'all' || !/^[a-z]+-\d+$/i.test(query)) return []
      const key = query.toUpperCase()
      return [{ id: `open-${key}`, group: 'Open item', label: key, run: () => openItem(key) }]
    },
    [palette, openItem],
  )

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      eventTime.current = event.timeStamp
      const mod = event.ctrlKey || event.metaKey
      if (mod && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setPalette((mode) => (mode ? null : 'all'))
        return
      }
      const target = event.target as HTMLElement
      const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
      if (typing) {
        if (event.key === 'Escape') target.blur()
        return
      }
      if (mod && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        store.undo()
        return
      }
      if (mod || event.altKey) return
      if (route.page === 'item') {
        const itemActions: Record<string, () => void> = {
          Escape: backToList,
          j: () => stepItem(1),
          k: () => stepItem(-1),
          s: () => setPalette('status'),
          a: () => setPalette('assignee'),
          p: () => setPalette('priority'),
          t: toggleTheme,
        }
        const itemAction = itemActions[event.key]
        if (itemAction) {
          event.preventDefault()
          itemAction()
        }
        return
      }
      const actions: Record<string, () => void> = {
        Enter: () => {
          const item = currentId ? store.getItem(currentId) : undefined
          if (item) openItem(item.key)
        },
        j: () => move(1, event.timeStamp),
        ArrowDown: () => move(1, event.timeStamp),
        k: () => move(-1, event.timeStamp),
        ArrowUp: () => move(-1, event.timeStamp),
        PageDown: () => move(20, event.timeStamp),
        PageUp: () => move(-20, event.timeStamp),
        Home: () => move(-ids.length, event.timeStamp),
        End: () => move(ids.length, event.timeStamp),
        s: () => setPalette('status'),
        a: () => setPalette('assignee'),
        p: () => setPalette('priority'),
        d: cycleDensity,
        t: toggleTheme,
        '/': () => filterRef.current?.focus(),
      }
      const action = actions[event.key]
      if (action) {
        event.preventDefault()
        action()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [
    move,
    ids.length,
    cycleDensity,
    toggleTheme,
    route,
    backToList,
    stepItem,
    openItem,
    currentId,
  ])

  const onSelect = useCallback((index: number) => setCursor(index), [])

  return (
    <div className={`shell density-${density}`}>
      <header className="toolbar">
        <strong className="brand">Work Platform</strong>
        <label className="muted dev-user">
          Dev sign-in
          <select
            value={userId}
            onChange={(event) => setUserId(event.target.value)}
            aria-label="Development sign-in: act as"
          >
            {users.length === 0 && <option value={userId}>{userId}</option>}
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        </label>
        {route.page === 'list' && (
          <div className="tabs" role="tablist" aria-label="Status filter">
            {CATEGORIES.map((category) => (
              <button
                key={category.id}
                role="tab"
                aria-selected={view.category === category.id}
                className={view.category === category.id ? 'tab tab-active' : 'tab'}
                onClick={(event) => {
                  store.applyFilter(view.query, category.id)
                  setCursor(0)
                  measureInteraction('Filter', event.timeStamp)
                }}
              >
                {category.label}
              </button>
            ))}
          </div>
        )}
        {route.page === 'list' && (
          <input
            ref={filterRef}
            className="filter"
            type="search"
            aria-label="Filter items"
            placeholder="Filter by key or title  ( / )"
            value={view.query}
            onChange={(event) => {
              store.applyFilter(event.target.value, view.category)
              setCursor(0)
              measureInteraction('Filter', event.nativeEvent.timeStamp)
            }}
          />
        )}
        <button className="button" onClick={() => setPalette('all')}>
          Commands <kbd>Ctrl K</kbd>
        </button>
      </header>

      {route.page === 'item' ? (
        <ItemPage
          api={api}
          store={store}
          itemKey={route.key}
          me={me}
          teams={teams}
          users={users}
          positionLabel={routeIndex >= 0 ? `Item ${routeIndex + 1} of ${ids.length}` : null}
          onBack={backToList}
        />
      ) : (
        <>
          <div className="columns" aria-hidden="true">
            <span className="cell cell-key">Key</span>
            <span className="cell cell-title">Title</span>
            <span className="cell cell-kind">Kind</span>
            <span className="cell cell-status">Stage</span>
            <span className="cell cell-priority">Priority</span>
            <span className="cell cell-assignee">Assignee</span>
          </div>

          <ItemList
            store={store}
            ids={ids}
            cursor={safeCursor}
            density={density}
            userNames={userNames}
            stageNames={stageNames}
            onSelect={onSelect}
            onRenderedRows={setRenderedRows}
          />

          <footer className="hud" aria-label="Performance readout">
            <span>
              {ids.length.toLocaleString()} of {view.total.toLocaleString()} items
            </span>
            <span>{renderedRows} rows in DOM</span>
            <span className={load.status === 'error' ? 'hud-bad' : undefined}>
              {load.status === 'loading' && 'loading…'}
              {load.status === 'ready' && `loaded in ${load.ms.toFixed(0)} ms`}
              {load.status === 'error' && `could not load: ${load.message}`}
            </span>
            {me && (
              <span>
                {me.name} · {me.orgRole.replace('_', ' ')} · teams:{' '}
                {Object.keys(me.teams).join(', ') || 'none'}
              </span>
            )}
            <span>filter {view.filterMs.toFixed(1)} ms</span>
            {perf.map((stat) => (
              <span key={stat.label} className={stat.p95 > 100 ? 'hud-bad' : 'hud-good'}>
                {stat.label}: last {stat.last.toFixed(0)} · p50 {stat.p50.toFixed(0)} · p95{' '}
                {stat.p95.toFixed(0)} ms ({stat.count})
              </span>
            ))}
            <span className="muted">
              J/K move · Enter open · S stage · A owner · P priority · D density · T theme · Ctrl Z
              undo
            </span>
          </footer>
        </>
      )}

      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((toast) => (
          <div key={toast.id} className="toast">
            {toast.message}
          </div>
        ))}
      </div>

      {palette && (
        <CommandPalette
          key={palette}
          title={
            palette === 'all'
              ? 'Type a command or an item key (e.g. ENG-42)'
              : palette === 'status'
                ? 'Move to stage'
                : palette === 'assignee'
                  ? 'Assign to'
                  : 'Set priority'
          }
          commands={commands}
          dynamic={dynamicCommands}
          onClose={() => setPalette(null)}
        />
      )}
    </div>
  )
}
