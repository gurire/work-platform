import { Bell, Menu as MenuIcon, Monitor, Moon, Sun } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import '../design/tokens.css'
import '../design/components.css'
import './app.css'
import { Counter, IconButton, Toast } from '../design/components'
import { useTheme, type ThemeChoice } from '../design/theme'
import { PageFor } from './pages'
import { hrefFor, parseMRoute, type MRoute } from './routes'
import { DataProvider, useAppData } from './data'
import { workApi, type CoreProject, type CoreTeam, type SearchResult } from './core-api'
import { Sidebar } from './Sidebar'
import { INBOX_WHAT } from './inbox'

const inboxWhat = (kind: string) => {
  const what = INBOX_WHAT[kind] ?? kind
  return what[0]?.toUpperCase() + what.slice(1)
}

const NEXT_CHOICE: Record<ThemeChoice, ThemeChoice> = {
  dark: 'light',
  light: 'system',
  system: 'dark',
}
const CHOICE_LABEL: Record<ThemeChoice, string> = {
  dark: 'Dark',
  light: 'Light',
  system: 'Match my computer',
}

interface Command {
  label: string
  href: string
}

function commands(projects: CoreProject[], teams: CoreTeam[]): Command[] {
  return [
    { label: 'Go to My work', href: hrefFor({ page: 'home' }) },
    { label: 'Go to Inbox', href: hrefFor({ page: 'inbox' }) },
    { label: 'Go to Dashboard', href: hrefFor({ page: 'dashboard' }) },
    { label: 'Go to Calendar and workload', href: hrefFor({ page: 'plan' }) },
    { label: 'Go to Requests', href: hrefFor({ page: 'requests' }) },
    { label: 'Go to Team settings', href: hrefFor({ page: 'settings' }) },
    { label: 'Open the component kit', href: hrefFor({ page: 'kit' }) },
    ...projects.map((p) => ({
      label: `Project: ${p.name}`,
      href: hrefFor({ page: 'project', id: p.id }),
    })),
    ...teams.map((t) => ({
      label: `Team board: ${t.name}`,
      href: hrefFor({ page: 'team', id: t.id }),
    })),
  ]
}

/** Ctrl K: jump to any page. Search over items arrives with phase 3. */
function Palette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const { projects, teams } = useAppData()
  const [found, setFound] = useState<SearchResult[]>([])
  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) {
      setFound([])
      return
    }
    const timer = setTimeout(() => {
      workApi.search(q).then(setFound, () => setFound([]))
    }, 200)
    return () => clearTimeout(timer)
  }, [query])
  const list = useMemo(
    () => [
      ...commands(projects, teams).filter((c) =>
        c.label.toLowerCase().includes(query.toLowerCase()),
      ),
      ...found.map((r) => ({
        label: `${r.key} ${r.title}${r.matched === 'comment' && r.snippet ? ` — “${r.snippet.slice(0, 60)}”` : ''}`,
        href: hrefFor({ page: 'item', key: r.key }),
      })),
    ],
    [query, projects, teams, found],
  )

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (open && !el.open) {
      setQuery('')
      setActive(0)
      el.showModal?.()
    }
    if (!open && el.open) el.close?.()
  }, [open])

  const go = (c: Command | undefined) => {
    if (!c) return
    window.location.hash = c.href
    onClose()
  }

  return (
    <dialog
      ref={ref}
      className="mx-palette"
      aria-label="Search or jump to a page"
      onClose={onClose}
      onCancel={onClose}
    >
      <input
        className="mx-palette-input"
        placeholder="Search or type a command…"
        aria-label="Search or type a command"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value)
          setActive(0)
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') setActive((a) => Math.min(a + 1, list.length - 1))
          if (e.key === 'ArrowUp') setActive((a) => Math.max(a - 1, 0))
          if (e.key === 'Enter') go(list[active])
        }}
      />
      <ul className="mx-palette-list" role="listbox" aria-label="Results">
        {list.map((c, i) => (
          <li
            key={c.href}
            role="option"
            aria-selected={i === active}
            className="mx-palette-item"
            onMouseEnter={() => setActive(i)}
            onClick={() => go(c)}
          >
            {c.label}
          </li>
        ))}
        {list.length === 0 ? <li className="mx-palette-empty">No matches.</li> : null}
      </ul>
    </dialog>
  )
}

function titleFor(route: MRoute, projects: CoreProject[], teams: CoreTeam[]): string {
  switch (route.page) {
    case 'home':
      return 'My work'
    case 'project':
      return projects.find((p) => p.id === route.id)?.name ?? 'Project'
    case 'team':
      return teams.find((t) => t.id === route.id)?.name ?? 'Team'
    case 'item':
      return route.key
    case 'plan':
      return 'Calendar and workload'
    case 'kit':
      return 'Component kit'
    case 'not-found':
      return 'Not found'
    default:
      return route.page[0]?.toUpperCase() + route.page.slice(1)
  }
}

/** The Midnight app: sidebar, top bar and the page for the current address. */
export function AppShell() {
  return (
    <DataProvider>
      <Shell />
    </DataProvider>
  )
}

function Shell() {
  const { projects, teams, error, unread, popups, dismissPopup, live } = useAppData()
  const [notifyState, setNotifyState] = useState(() =>
    typeof Notification === 'undefined' ? 'unsupported' : Notification.permission,
  )
  const [route, setRoute] = useState<MRoute>(() => parseMRoute(window.location.hash))
  const [menuOpen, setMenuOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const { choice, theme, setChoice } = useTheme()

  useEffect(() => {
    const onHash = () => setRoute(parseMRoute(window.location.hash))
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  useEffect(() => {
    document.title = `${titleFor(route, projects, teams)} · Work Platform`
  }, [route, projects, teams])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPaletteOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const ThemeIcon = choice === 'dark' ? Moon : choice === 'light' ? Sun : Monitor

  return (
    <div className="mx-app" data-ui="midnight" data-theme={theme}>
      <a className="mx-skip" href="#mx-main">
        Skip to content
      </a>
      <Sidebar
        route={route}
        open={menuOpen}
        onSearch={() => setPaletteOpen(true)}
        onNavigate={() => setMenuOpen(false)}
      />
      <div className="mx-main-col">
        <header className="mx-top">
          <IconButton
            label={menuOpen ? 'Close menu' : 'Open menu'}
            className="mx-menu-btn"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((o) => !o)}
          >
            <MenuIcon size={18} />
          </IconButton>
          <span className="mx-crumb">{titleFor(route, projects, teams)}</span>
          <span className="mx-top-actions">
            <IconButton
              label={`Theme: ${CHOICE_LABEL[choice]}. Switch to ${CHOICE_LABEL[NEXT_CHOICE[choice]]}`}
              onClick={() => setChoice(NEXT_CHOICE[choice])}
            >
              <ThemeIcon size={18} />
            </IconButton>
            {notifyState === 'default' ? (
              <button
                type="button"
                className="md-btn md-btn-ghost md-btn-s"
                onClick={() => void Notification.requestPermission().then((p) => setNotifyState(p))}
              >
                Turn on desktop pop-ups
              </button>
            ) : null}
            <span
              className="mx-live"
              title={
                live ? 'Live: changes show up straight away' : 'Reconnecting… the page still works'
              }
            >
              <span
                className={live ? 'mx-live-dot mx-live-on' : 'mx-live-dot'}
                aria-hidden="true"
              />
              <span className="md-meta">{live ? 'Live' : 'Offline'}</span>
            </span>
            <span className="mx-bell">
              <IconButton
                label={`Inbox, ${unread} unread`}
                onClick={() => (window.location.hash = hrefFor({ page: 'inbox' }))}
              >
                <Bell size={18} />
              </IconButton>
              {unread > 0 ? <Counter value={unread} /> : null}
            </span>
          </span>
        </header>
        <main id="mx-main" className="mx-main" tabIndex={-1}>
          {error ? (
            <div className="mx-page">
              <p className="md-field-error" role="alert">
                Could not load the workspace: {error}
              </p>
            </div>
          ) : null}
          <PageFor route={route} />
        </main>
      </div>
      <Palette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      <div className="mx-toasts" aria-live="polite">
        {popups.map((p) => (
          <Toast
            key={p.id}
            kind="info"
            title={`${p.itemKey} ${p.itemTitle}`}
            text={inboxWhat(p.kind)}
            onClose={() => dismissPopup(p.id)}
          />
        ))}
      </div>
    </div>
  )
}
