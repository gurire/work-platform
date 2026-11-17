import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { allowedDestinations, SAMPLE_PRIORITIES } from '@wm/shared'
import { createApi, type ApiTeam, type ApiUser, type Me } from './api'
import { CommandPalette, type Command } from './CommandPalette'
import {
  boardHash,
  dashboardHash,
  itemHash,
  parseRoute,
  recordHash,
  type Route,
} from './item-model'
import { Board } from './Board'
import { Inbox } from './Inbox'
import type { InboxEntry } from './api'
import { ItemPage } from './ItemPage'
import { RecordPage } from './RecordPage'
import { ItemList, type Density } from './ItemList'
import { ListControls } from './ListControls'
import { SelectionBar } from './SelectionBar'
import {
  GROUP_LABELS,
  NO_FACETS,
  buildRows,
  gridTemplate,
  groupIds,
  parseColumns,
  COLUMNS,
  type ColumnId,
  type Facets,
  type GroupBy,
} from './list-view'
import { stageLook } from '../ui/kit'
import { measureInteraction, perfStore } from './perf'
import { ItemStore, type CategoryFilter, type ItemPatch } from './store'
import './items.css'
import '../dashboards/dashboards.css'
import { TeamDashboard } from '../dashboards/TeamDashboard'
import { AllTeams } from '../dashboards/AllTeams'
import { Sidebar } from '../shell/Sidebar'
import { MyWork } from '../shell/MyWork'
import { People } from '../shell/People'
import '../shell/shell.css'
import { TeamTile } from '../ui/kit'
import { authConfig, idToken, signOut, startSignIn, tokenEmail } from '../auth/auth'

const DENSITIES: readonly Density[] = ['compact', 'default', 'comfortable']
const CATEGORIES: readonly { id: CategoryFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'todo', label: 'To do' },
  { id: 'in_progress', label: 'In progress' },
  { id: 'done', label: 'Done' },
]
type PaletteMode = 'all' | 'status' | 'assignee' | 'priority'
type Theme = 'light' | 'dark'
export type ThemeChoice = 'system' | Theme

const USER_KEY = 'wm-dev-user'
function readDevUser(): string {
  try {
    return localStorage.getItem(USER_KEY) ?? 'user-3'
  } catch {
    return 'user-3'
  }
}
let devUser = readDevUser()
const auth = authConfig()
const api = createApi(
  () => devUser,
  auth ? () => idToken(auth) : undefined,
  auth ? () => void startSignIn(auth) : undefined,
)
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
  // WCAG 2.1.4: single-key shortcuts can be turned off; remembered on this computer.
  const [singleKeys, setSingleKeys] = useState(() => readSetting('wm.singleKeys') !== 'off')
  // The speed readout is for developers: add ?hud to the address, or run "Show speed readout".
  const [showHud, setShowHud] = useState(
    () => new URLSearchParams(window.location.search).has('hud') || readSetting('wm.hud') === 'on',
  )
  // Theme: follow the computer, or a fixed choice remembered in this browser.
  const [themeChoice, setThemeChoiceState] = useState<ThemeChoice>(() => {
    const saved = readSetting('wm.theme')
    return saved === 'light' || saved === 'dark' ? saved : 'system'
  })
  const [systemDark, setSystemDark] = useState(
    () => window.matchMedia('(prefers-color-scheme: dark)').matches,
  )
  useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = (event: MediaQueryListEvent) => setSystemDark(event.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])
  const theme: Theme = themeChoice === 'system' ? (systemDark ? 'dark' : 'light') : themeChoice
  const setThemeChoice = useCallback((choice: ThemeChoice) => {
    writeSetting('wm.theme', choice)
    setThemeChoiceState(choice)
  }, [])
  const [palette, setPalette] = useState<PaletteMode | null>(null)
  const [userId, setUserId] = useState(devUser)
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.hash))
  const [inbox, setInbox] = useState<{ unread: number; entries: InboxEntry[] } | null>(null)
  const [me, setMe] = useState<Me | null>(null)
  const [users, setUsers] = useState<readonly ApiUser[]>([])
  const [teams, setTeams] = useState<readonly ApiTeam[]>([])
  const [load, setLoad] = useState<LoadState>({ status: 'loading', ms: 0 })
  const [renderedRows, setRenderedRows] = useState(0)
  const filterRef = useRef<HTMLInputElement>(null)
  const eventTime = useRef(0)

  // List views (redesign step 3): chips, grouping, columns and multi-select.
  const listRevision = useSyncExternalStore(store.subscribeChanges, store.getRevision)
  const [groupBy, setGroupByState] = useState<GroupBy>(() => {
    const saved = readSetting('wm.groupBy')
    return saved && saved in GROUP_LABELS ? (saved as GroupBy) : 'none'
  })
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set())
  const [columns, setColumnsState] = useState<readonly ColumnId[]>(() =>
    parseColumns(readSetting('wm.columns')),
  )
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set())
  const [facets, setFacetsState] = useState<Facets>(NO_FACETS)
  const selectAnchor = useRef<number | null>(null)
  // Grouping depends on item values, so regroup when items change; a flat list does not need to.
  const regroupKey = groupBy === 'none' ? 0 : listRevision
  const { rows, order } = useMemo(() => {
    void regroupKey
    const ctx = {
      stages: new Map(
        teams.flatMap((t) => t.stages.map((st) => [`${st.teamId}:${st.key}`, st] as const)),
      ),
      userNames: new Map(users.map((u) => [u.id, u.name])),
      teamNames: new Map(teams.map((t) => [t.id, t.name])),
    }
    return buildRows(groupIds(view.ids, store.getItem, groupBy, ctx), collapsed)
  }, [view, groupBy, collapsed, teams, users, store, regroupKey])
  const ids = order
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
  const teamNames = useMemo(() => new Map(teams.map((t) => [t.id, t.name])), [teams])
  const stageLooks = useMemo(
    () =>
      new Map(
        teams.flatMap((team) =>
          team.stages.map(
            (stage) => [`${stage.teamId}:${stage.key}`, stageLook(team.stages, stage.key)] as const,
          ),
        ),
      ),
    [teams],
  )
  const currentItem = useSyncExternalStore(
    (listener) => (currentId ? store.subscribeItem(currentId, listener) : () => {}),
    () => (currentId ? store.getItem(currentId) : undefined),
  )
  const currentTeam = teams.find((team) => team.id === currentItem?.teamId)
  const routeTeamId =
    route.page === 'list' || route.page === 'board' || route.page === 'dashboard'
      ? (route.teamId ?? null)
      : null
  const pageTeam = teams.find((team) => team.id === routeTeamId)
  const pageTitle =
    route.page === 'me'
      ? 'My work'
      : route.page === 'inbox'
        ? 'Inbox'
        : route.page === 'dashboards'
          ? 'All teams'
          : route.page === 'people'
            ? 'People'
            : route.page === 'item'
              ? (currentItem?.key ?? route.key)
              : route.page === 'record'
                ? 'Record'
                : pageTeam
                  ? `${pageTeam.name}${route.page === 'board' ? ' · Board' : route.page === 'dashboard' ? ' · Dashboard' : ''}`
                  : 'All items'
  const revision = useSyncExternalStore(store.subscribeChanges, store.getRevision)
  const myOpen = useMemo(() => {
    void revision
    if (!me) return 0
    return teams
      .flatMap((team) => store.itemsForTeam(team.id))
      .filter(
        (item) =>
          item.assigneeId === me.id &&
          (item.statusCategory === 'todo' || item.statusCategory === 'in_progress'),
      ).length
  }, [store, me, teams, revision])

  // A team's list (#/team/KEY) shows only that team; the plain list shows every team.
  useEffect(() => {
    if (route.page === 'list') store.setTeam(route.teamId ?? null)
  }, [route, store])

  // Stage chips only mean something inside one team; a new team or filter clears the selection.
  useEffect(() => {
    setFacetsState((f) => (f.stages?.length ? { ...f, stages: [] } : f))
    setSelected(new Set())
  }, [routeTeamId])
  useEffect(() => {
    store.setFacets(facets)
    setCursor(0)
    setSelected(new Set())
  }, [facets, store])

  const setGroupBy = useCallback((by: GroupBy) => {
    writeSetting('wm.groupBy', by)
    setGroupByState(by)
    setCollapsed(new Set())
    setCursor(0)
  }, [])
  const setColumns = useCallback((next: readonly ColumnId[]) => {
    const ordered = COLUMNS.map((c) => c.id).filter((id) => next.includes(id))
    writeSetting('wm.columns', ordered.join(','))
    setColumnsState(ordered)
  }, [])
  const toggleGroup = useCallback((key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])
  const toggleSelect = useCallback(
    (id: string, index: number, range: boolean) => {
      setSelected((prev) => {
        const next = new Set(prev)
        const from = selectAnchor.current
        if (range && from !== null) {
          for (let i = Math.min(from, index); i <= Math.max(from, index); i++) {
            const rowId = ids[i]
            if (rowId) next.add(rowId)
          }
        } else if (next.has(id)) next.delete(id)
        else next.add(id)
        return next
      })
      selectAnchor.current = index
    },
    [ids],
  )
  const selectedIds = useMemo(() => [...selected], [selected])
  // "75 of 300": out of the team's items on a team's list, out of everything otherwise.
  const teamTotal = useMemo(() => {
    void listRevision
    return pageTeam ? store.itemsForTeam(pageTeam.id).length : view.total
  }, [pageTeam, store, view.total, listRevision])
  const bulkTeams = new Set(selectedIds.map((id) => store.getItem(id)?.teamId))
  const bulkStages =
    bulkTeams.size === 1 ? (teams.find((t) => bulkTeams.has(t.id))?.stages ?? null) : null
  const kinds = useMemo(() => {
    void listRevision
    const present = new Set<string>()
    for (const team of teams) for (const item of store.itemsForTeam(team.id)) present.add(item.kind)
    return [...present].sort()
  }, [teams, store, listRevision])

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
  // The inbox refreshes every 30 seconds, and whenever the user or the page changes.
  const refreshInbox = useCallback(() => {
    api.inbox().then(setInbox, () => {
      // Leave the last known inbox in place; the next refresh tries again.
    })
  }, [])
  useEffect(() => {
    setInbox(null)
    refreshInbox()
    const timer = setInterval(refreshInbox, 30_000)
    return () => clearInterval(timer)
  }, [userId, refreshInbox])
  useEffect(() => {
    if (route.page === 'inbox') refreshInbox()
  }, [route, refreshInbox])
  const openInbox = useCallback(() => {
    window.location.hash = '#/inbox'
  }, [])
  const openInboxEntry = useCallback(
    (entry: InboxEntry) => {
      if (!entry.read) {
        void api.markRead([entry.id]).then(refreshInbox, refreshInbox)
      }
      window.location.hash = itemHash(entry.itemKey)
    },
    [refreshInbox],
  )
  const markOneRead = useCallback(
    (entry: InboxEntry) => {
      void api.markRead([entry.id]).then(refreshInbox, refreshInbox)
    },
    [refreshInbox],
  )
  const markAllRead = useCallback(() => {
    void api.markRead().then(refreshInbox, refreshInbox)
  }, [refreshInbox])
  const openBoard = useCallback((teamId: string) => {
    window.location.hash = boardHash(teamId)
  }, [])
  const openDashboard = useCallback((teamId: string | null) => {
    window.location.hash = dashboardHash(teamId)
  }, [])
  const openRecord = useCallback((id: string) => {
    window.location.hash = recordHash(id)
  }, [])
  // A record is usually opened from an item, so going back returns there.
  const backFromRecord = useCallback(() => {
    if (window.history.length > 1) window.history.back()
    else backToList()
  }, [backToList])
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
  const toggleTheme = useCallback(
    () => setThemeChoice(theme === 'dark' ? 'light' : 'dark'),
    [theme, setThemeChoice],
  )
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
        id: 'single-keys',
        group: 'View',
        label: singleKeys ? 'Turn off single-key shortcuts' : 'Turn on single-key shortcuts',
        run: () => {
          writeSetting('wm.singleKeys', singleKeys ? 'off' : 'on')
          setSingleKeys(!singleKeys)
          store.toast(
            singleKeys
              ? 'Single-key shortcuts are off. Ctrl K still works.'
              : 'Single-key shortcuts are on.',
          )
        },
      },
      {
        id: 'hud',
        group: 'View',
        label: showHud ? 'Hide speed readout' : 'Show speed readout',
        run: () => {
          writeSetting('wm.hud', showHud ? 'off' : 'on')
          setShowHud(!showHud)
        },
      },
      {
        id: 'filter',
        group: 'View',
        label: 'Focus filter',
        shortcut: '/',
        run: () => filterRef.current?.focus(),
      },
      {
        id: 'dashboards',
        group: 'Dashboards',
        label: 'All teams',
        run: () => openDashboard(null),
      },
      ...teams.map((t) => ({
        id: `dashboard-${t.id}`,
        group: 'Dashboards',
        label: `${t.name} dashboard`,
        run: () => openDashboard(t.id),
      })),
      ...teams.map((t) => ({
        id: `board-${t.id}`,
        group: 'Open board',
        label: t.name,
        run: () => openBoard(t.id),
      })),
      ...users.map((u) => ({
        id: `signin-${u.id}`,
        group: 'Dev sign-in',
        label: `Act as ${u.name}`,
        run: () => setUserId(u.id),
      })),
    ]
  }, [
    palette,
    edit,
    toggleTheme,
    cycleDensity,
    users,
    currentTeam,
    currentItem,
    teams,
    openBoard,
    openDashboard,
    singleKeys,
    showHud,
    store,
  ])

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
      // Letters and symbols are single-key shortcuts; Escape, arrows and Enter always work.
      if (!singleKeys && event.key.length === 1) return
      if (
        route.page === 'inbox' ||
        route.page === 'me' ||
        route.page === 'people' ||
        route.page === 'dashboard' ||
        route.page === 'dashboards'
      ) {
        if (event.key === 'Escape') {
          event.preventDefault()
          backToList()
        }
        return
      }
      if (route.page === 'board') {
        if (event.key === 'Escape') {
          event.preventDefault()
          backToList()
        } else if (event.key === 't') {
          toggleTheme()
        }
        return
      }
      if (route.page === 'record') {
        if (event.key === 'Escape') {
          event.preventDefault()
          backFromRecord()
        }
        return
      }
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
        b: () => {
          const teamId = currentTeam?.id ?? teams[0]?.id
          if (teamId) openBoard(teamId)
        },
        i: openInbox,
        '/': () => filterRef.current?.focus(),
        x: () => {
          if (currentId) toggleSelect(currentId, safeCursor, false)
        },
        Escape: () => setSelected(new Set()),
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
    backFromRecord,
    currentTeam,
    teams,
    openBoard,
    openInbox,
    singleKeys,
    toggleSelect,
    safeCursor,
  ])

  const onSelect = useCallback((index: number) => setCursor(index), [])

  return (
    <div className="app">
      <Sidebar
        route={route}
        activeTeamId={pageTeam?.id ?? currentTeam?.id ?? null}
        teams={teams}
        users={users}
        me={me}
        userId={userId}
        unread={inbox?.unread ?? 0}
        myOpen={myOpen}
        onSignIn={setUserId}
        onCommands={() => setPalette('all')}
        themeChoice={themeChoice}
        onThemeChoice={setThemeChoice}
        signedInAs={auth ? tokenEmail() : null}
        onSignOut={auth ? () => signOut(auth) : null}
      />
      <div className={`shell density-${density}`}>
        <header className="toolbar">
          <span className="page-title">
            {pageTeam && <TeamTile id={pageTeam.id} name={pageTeam.name} size={20} />}
            {pageTitle}
          </span>
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
          <button className="button toolbar-end" onClick={() => setPalette('all')}>
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
            onOpenRecord={openRecord}
          />
        ) : route.page === 'people' ? (
          <People api={api} store={store} teams={teams} />
        ) : route.page === 'me' ? (
          <MyWork
            store={store}
            me={me}
            teams={teams}
            users={users}
            inbox={inbox?.entries ?? null}
          />
        ) : route.page === 'dashboard' ? (
          <TeamDashboard
            key={route.teamId}
            api={api}
            teamId={route.teamId}
            teams={teams}
            users={users}
            onOpenItem={openItem}
            onTeamChange={openDashboard}
            onOpenAllTeams={() => openDashboard(null)}
          />
        ) : route.page === 'dashboards' ? (
          <AllTeams api={api} onOpenTeam={openDashboard} />
        ) : route.page === 'inbox' ? (
          <Inbox
            entries={inbox?.entries ?? null}
            users={users}
            onOpen={openInboxEntry}
            onMarkRead={markOneRead}
            onMarkAllRead={markAllRead}
          />
        ) : route.page === 'board' ? (
          <Board
            key={route.teamId}
            api={api}
            store={store}
            teamId={route.teamId}
            teams={teams}
            users={users}
            me={me}
            onOpenItem={openItem}
            onTeamChange={openBoard}
          />
        ) : route.page === 'record' ? (
          <RecordPage
            api={api}
            store={store}
            recordId={route.id}
            users={users}
            teams={teams}
            onBack={backFromRecord}
            onOpenItem={openItem}
          />
        ) : (
          <>
            <ListControls
              facets={facets}
              onFacets={setFacetsState}
              users={users}
              meId={me?.id ?? null}
              stages={pageTeam ? pageTeam.stages : null}
              kinds={kinds}
              groupBy={groupBy}
              onGroupBy={setGroupBy}
              columns={columns}
              onColumns={setColumns}
              shown={ids.length}
              total={teamTotal}
            />
            <div className="columns" style={{ gridTemplateColumns: gridTemplate(columns) }}>
              <span className="cell cell-check">
                <input
                  type="checkbox"
                  aria-label="Select all shown items"
                  checked={ids.length > 0 && selected.size === ids.length}
                  ref={(box) => {
                    if (box) box.indeterminate = selected.size > 0 && selected.size < ids.length
                  }}
                  onChange={() => setSelected(selected.size > 0 ? new Set() : new Set(ids))}
                />
              </span>
              <span className="cell cell-key">Key</span>
              <span className="cell cell-title">Title</span>
              {COLUMNS.filter((c) => columns.includes(c.id)).map((c) => (
                <span key={c.id} className={`cell cell-${c.id}`}>
                  {c.label}
                </span>
              ))}
            </div>

            <ItemList
              store={store}
              rows={rows}
              cursor={safeCursor}
              activeId={ids[safeCursor]}
              itemCount={ids.length}
              density={density}
              columns={columns}
              selected={selected}
              userNames={userNames}
              teamNames={teamNames}
              stageLooks={stageLooks}
              onSelect={onSelect}
              onToggle={toggleSelect}
              onToggleGroup={toggleGroup}
              onRenderedRows={setRenderedRows}
            />

            {selected.size > 0 && (
              <SelectionBar
                count={selected.size}
                stages={bulkStages}
                users={users}
                onMove={(key) => {
                  const name = bulkStages?.find((st) => st.key === key)?.name ?? key
                  void store.mutateMany(selectedIds, { statusId: key }, `Moved {items} to ${name}.`)
                }}
                onAssign={(userId) => {
                  const name = userId ? (userNames.get(userId) ?? userId) : null
                  void store.mutateMany(
                    selectedIds,
                    { assigneeId: userId },
                    name ? `Gave {items} to ${name}.` : 'Unassigned {items}.',
                  )
                }}
                onPriority={(level) => {
                  const label = SAMPLE_PRIORITIES[level] ?? 'None'
                  void store.mutateMany(
                    selectedIds,
                    { priority: level },
                    `Set {items} to ${label} priority.`,
                  )
                }}
                onClear={() => setSelected(new Set())}
              />
            )}

            {showHud && (
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
                  J/K move · Enter open · I inbox · B board · S stage · A owner · P priority · D
                  density · T light/dark · Ctrl Z undo
                </span>
              </footer>
            )}
          </>
        )}

        <div className="toasts" role="status" aria-live="polite">
          {toasts.map((toast) => (
            <div key={toast.id} className="toast">
              <span>{toast.message}</span>
              {toast.action && (
                <button type="button" className="toast-action" onClick={toast.action.run}>
                  {toast.action.label}
                </button>
              )}
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
            context={
              palette !== 'all' && currentItem
                ? `${currentItem.key} · ${stageLooks.get(`${currentItem.teamId}:${currentItem.statusId}`)?.name ?? currentItem.statusId}`
                : undefined
            }
            commands={commands}
            dynamic={dynamicCommands}
            onClose={() => setPalette(null)}
          />
        )}
      </div>
    </div>
  )
}

/** Settings live in localStorage, which can be missing or throw (private windows). */
function readSetting(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeSetting(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value)
  } catch {
    // Not remembered; the change still applies until the page is reloaded.
  }
}
