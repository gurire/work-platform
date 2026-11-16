import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import {
  generateSampleWorkItems,
  SAMPLE_PRIORITIES,
  SAMPLE_STATUSES,
  SAMPLE_USERS,
} from '@wm/shared'
import { CommandPalette, type Command } from './CommandPalette'
import { ItemList, type Density } from './ItemList'
import { measureInteraction, perfStore } from './perf'
import { ItemStore, type CategoryFilter, type ItemPatch } from './store'
import './spike.css'

const ITEM_COUNT = 100_000
const DENSITIES: readonly Density[] = ['compact', 'default', 'comfortable']
const CATEGORIES: readonly { id: CategoryFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'todo', label: 'To do' },
  { id: 'in_progress', label: 'In progress' },
  { id: 'done', label: 'Done' },
]
type PaletteMode = 'all' | 'status' | 'assignee' | 'priority'
type Theme = 'light' | 'dark'

const store = new ItemStore()
const generateStart = performance.now()
store.load(generateSampleWorkItems(ITEM_COUNT))
const generateMs = performance.now() - generateStart

export function Spike() {
  const view = useSyncExternalStore(store.subscribe, store.getView)
  const toasts = useSyncExternalStore(store.subscribe, store.getToasts)
  const perf = useSyncExternalStore(perfStore.subscribe, perfStore.get)
  const [cursor, setCursor] = useState(0)
  const [density, setDensity] = useState<Density>('default')
  const [theme, setTheme] = useState<Theme>(() =>
    window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
  )
  const [palette, setPalette] = useState<PaletteMode | null>(null)
  const [rejecting, setRejecting] = useState(false)
  const [renderedRows, setRenderedRows] = useState(0)
  const filterRef = useRef<HTMLInputElement>(null)
  const eventTime = useRef(0)

  const ids = view.ids
  const safeCursor = Math.min(cursor, Math.max(ids.length - 1, 0))
  const currentId = ids[safeCursor]

  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  const edit = useCallback(
    (label: string, patch: ItemPatch) => {
      if (!currentId) return
      store.mutate(currentId, patch)
      measureInteraction(label, eventTime.current || performance.now())
    },
    [currentId],
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
  const toggleRejecting = useCallback(() => {
    store.rejectSomeWrites = !store.rejectSomeWrites
    setRejecting(store.rejectSomeWrites)
  }, [])

  const commands = useMemo<Command[]>(() => {
    const status = SAMPLE_STATUSES.map((s) => ({
      id: `status-${s.id}`,
      group: 'Set status',
      label: s.name,
      run: () => edit('Change status', { statusId: s.id }),
    }))
    const assignee = [
      {
        id: 'assign-none',
        group: 'Assign to',
        label: 'Unassigned',
        run: () => edit('Change assignee', { assigneeId: null }),
      },
      ...SAMPLE_USERS.map((u) => ({
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
      {
        id: 'reject',
        group: 'Spike',
        label: rejecting ? 'Stop simulating server rejections' : 'Simulate server rejections',
        run: toggleRejecting,
      },
    ]
  }, [palette, edit, toggleTheme, cycleDensity, toggleRejecting, rejecting])

  const dynamicCommands = useCallback(
    (query: string): Command[] => {
      if (palette !== 'all' || !/^[a-z]+-\d+$/i.test(query)) return []
      const id = store.idForKey(query)
      const index = id ? ids.indexOf(id) : -1
      if (index < 0) return []
      return [
        {
          id: `goto-${id}`,
          group: 'Go to',
          label: query.toUpperCase(),
          run: () => setCursor(index),
        },
      ]
    },
    [palette, ids],
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
      const typing = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA'
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
      const actions: Record<string, () => void> = {
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
  }, [move, ids.length, cycleDensity, toggleTheme])

  const onSelect = useCallback((index: number) => setCursor(index), [])

  return (
    <div className={`shell density-${density}`}>
      <header className="toolbar">
        <strong className="brand">Work Platform</strong>
        <span className="muted">UI shell spike</span>
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
        <button className="button" onClick={() => setPalette('all')}>
          Commands <kbd>Ctrl K</kbd>
        </button>
      </header>

      <div className="columns" aria-hidden="true">
        <span className="cell cell-key">Key</span>
        <span className="cell cell-title">Title</span>
        <span className="cell cell-kind">Kind</span>
        <span className="cell cell-status">Status</span>
        <span className="cell cell-priority">Priority</span>
        <span className="cell cell-assignee">Assignee</span>
      </div>

      <ItemList
        store={store}
        ids={ids}
        cursor={safeCursor}
        density={density}
        onSelect={onSelect}
        onRenderedRows={setRenderedRows}
      />

      <footer className="hud" aria-label="Performance readout">
        <span>
          {ids.length.toLocaleString()} of {view.total.toLocaleString()} items
        </span>
        <span>{renderedRows} rows in DOM</span>
        <span>generate {generateMs.toFixed(0)} ms</span>
        <span>filter {view.filterMs.toFixed(1)} ms</span>
        {perf.map((stat) => (
          <span key={stat.label} className={stat.p95 > 100 ? 'hud-bad' : 'hud-good'}>
            {stat.label}: last {stat.last.toFixed(0)} · p50 {stat.p50.toFixed(0)} · p95{' '}
            {stat.p95.toFixed(0)} ms ({stat.count})
          </span>
        ))}
        <span className="muted">
          J/K move · S status · A assignee · P priority · D density · T theme · Ctrl Z undo
          {rejecting ? ' · rejections ON' : ''}
        </span>
      </footer>

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
                ? 'Set status'
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
