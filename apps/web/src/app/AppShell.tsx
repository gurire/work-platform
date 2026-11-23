import { Bell, Menu as MenuIcon, Monitor, Moon, Sun } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import '../design/tokens.css'
import '../design/components.css'
import './app.css'
import { IconButton } from '../design/components'
import { useTheme, type ThemeChoice } from '../design/theme'
import { PageFor } from './pages'
import { hrefFor, parseMRoute, type MRoute } from './routes'
import { SAMPLE_PROJECTS, SAMPLE_TEAMS } from './nav-data'
import { Sidebar } from './Sidebar'

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

function commands(): Command[] {
  return [
    { label: 'Go to My work', href: hrefFor({ page: 'home' }) },
    { label: 'Go to Inbox', href: hrefFor({ page: 'inbox' }) },
    { label: 'Go to Dashboard', href: hrefFor({ page: 'dashboard' }) },
    { label: 'Go to Calendar and workload', href: hrefFor({ page: 'plan' }) },
    { label: 'Go to Requests', href: hrefFor({ page: 'requests' }) },
    { label: 'Go to Team settings', href: hrefFor({ page: 'settings' }) },
    { label: 'Open the component kit', href: hrefFor({ page: 'kit' }) },
    ...SAMPLE_PROJECTS.map((p) => ({
      label: `Project: ${p.name}`,
      href: hrefFor({ page: 'project', id: p.id }),
    })),
    ...SAMPLE_TEAMS.map((t) => ({
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
  const list = useMemo(
    () => commands().filter((c) => c.label.toLowerCase().includes(query.toLowerCase())),
    [query],
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
        {list.length === 0 ? (
          <li className="mx-palette-empty">No matches. Item search arrives in phase 3.</li>
        ) : null}
      </ul>
    </dialog>
  )
}

function titleFor(route: MRoute): string {
  switch (route.page) {
    case 'home':
      return 'My work'
    case 'project':
      return SAMPLE_PROJECTS.find((p) => p.id === route.id)?.name ?? 'Project'
    case 'team':
      return SAMPLE_TEAMS.find((t) => t.id === route.id)?.name ?? 'Team'
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
    document.title = `${titleFor(route)} · Work Platform`
  }, [route])

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
          <span className="mx-crumb">{titleFor(route)}</span>
          <span className="mx-top-actions">
            <IconButton
              label={`Theme: ${CHOICE_LABEL[choice]}. Switch to ${CHOICE_LABEL[NEXT_CHOICE[choice]]}`}
              onClick={() => setChoice(NEXT_CHOICE[choice])}
            >
              <ThemeIcon size={18} />
            </IconButton>
            <IconButton
              label="Notifications"
              onClick={() => (window.location.hash = hrefFor({ page: 'inbox' }))}
            >
              <Bell size={18} />
            </IconButton>
          </span>
        </header>
        <main id="mx-main" className="mx-main" tabIndex={-1}>
          <PageFor route={route} />
        </main>
      </div>
      <Palette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </div>
  )
}
