import { BarChart3, CalendarDays, Home, Inbox, Plus, Search, Settings } from 'lucide-react'
import type { ReactNode } from 'react'
import { Avatar, Counter } from '../design/components'
import { hrefFor, type MRoute } from './routes'
import { useState } from 'react'
import { Button, Dialog } from '../design/components'
import { coreApi } from './core-api'
import { useAppData } from './data'

interface SidebarProps {
  route: MRoute
  open: boolean
  onSearch: () => void
  onNavigate: () => void
}

function NavLink({
  href,
  active,
  icon,
  children,
  count,
}: {
  href: string
  active: boolean
  icon?: ReactNode
  children: ReactNode
  count?: number
}) {
  return (
    <a href={href} className="mx-nav" aria-current={active ? 'page' : undefined}>
      {icon}
      <span className="mx-nav-text">{children}</span>
      {count ? <Counter value={count} /> : null}
    </a>
  )
}

/** Projects first, then teams (WP-BRIEF-002, Screens). */
export function Sidebar({ route, open, onSearch, onNavigate }: SidebarProps) {
  const { projects, teams, me, refresh } = useAppData()
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [colour, setColour] = useState(1)
  const [error, setError] = useState<string | null>(null)
  const is = (page: MRoute['page'], id?: string) =>
    route.page === page && (id === undefined || ('id' in route && route.id === id))
  return (
    <nav
      aria-label="Main"
      className={open ? 'mx-side mx-side-open' : 'mx-side'}
      onClick={(e) => (e.target as HTMLElement).closest('a') && onNavigate()}
    >
      <div className="mx-brand">
        <span className="mx-logo" aria-hidden="true">
          W
        </span>
        <span className="mx-brand-text">
          <span className="mx-brand-name">Work Platform</span>
          <span className="md-meta">[Name to be picked]</span>
        </span>
      </div>

      <div className="mx-side-actions">
        <button type="button" className="mx-search" onClick={onSearch}>
          <Search size={16} aria-hidden="true" />
          Search everything
          <kbd className="mx-kbd">Ctrl K</kbd>
        </button>
        <a href={hrefFor({ page: 'home' })} className="md-btn md-btn-primary md-btn-m mx-new">
          <Plus size={16} aria-hidden="true" />
          New item
        </a>
      </div>

      <div className="mx-group">
        <NavLink
          href={hrefFor({ page: 'home' })}
          active={is('home')}
          icon={<Home size={18} aria-hidden="true" />}
        >
          My work
        </NavLink>
        <NavLink
          href={hrefFor({ page: 'inbox' })}
          active={is('inbox')}
          icon={<Inbox size={18} aria-hidden="true" />}
        >
          Inbox
        </NavLink>
        <NavLink
          href={hrefFor({ page: 'dashboard' })}
          active={is('dashboard')}
          icon={<BarChart3 size={18} aria-hidden="true" />}
        >
          Dashboard
        </NavLink>
        <NavLink
          href={hrefFor({ page: 'plan' })}
          active={is('plan')}
          icon={<CalendarDays size={18} aria-hidden="true" />}
        >
          Calendar &amp; workload
        </NavLink>
      </div>

      <div className="mx-group">
        <span className="mx-group-head mx-group-head-row">
          <span className="md-eyebrow">Projects</span>
          <button
            type="button"
            className="mx-mini-btn"
            aria-label="New project"
            onClick={() => setCreating(true)}
          >
            +
          </button>
        </span>
        {projects
          .filter((p) => !p.archived)
          .map((p) => (
            <NavLink
              key={p.id}
              href={hrefFor({ page: 'project', id: p.id })}
              active={is('project', p.id)}
              icon={<span className={`mx-swatch mx-project-${p.colour}`} aria-hidden="true" />}
            >
              {p.name}
            </NavLink>
          ))}
        <NavLink href={hrefFor({ page: 'requests' })} active={is('requests')}>
          Requests
        </NavLink>
      </div>

      <div className="mx-group">
        <span className="md-eyebrow mx-group-head">Teams</span>
        {teams.map((t) => (
          <NavLink key={t.id} href={hrefFor({ page: 'team', id: t.id })} active={is('team', t.id)}>
            {t.name}
          </NavLink>
        ))}
      </div>

      <div className="mx-side-foot">
        <NavLink
          href={hrefFor({ page: 'settings' })}
          active={is('settings')}
          icon={<Settings size={18} aria-hidden="true" />}
        >
          Team settings
        </NavLink>
        <div className="mx-me">
          <Avatar name={me?.name ?? null} size={32} />
          <span className="mx-brand-text">
            <span className="md-strong">{me?.name ?? '…'}</span>
            <span className="md-meta">Signed in</span>
          </span>
        </div>
      </div>
      <Dialog
        open={creating}
        title="New project"
        onClose={() => setCreating(false)}
        actions={
          <>
            <Button onClick={() => setCreating(false)}>Cancel</Button>
            <Button
              kind="primary"
              disabled={!name.trim()}
              onClick={async () => {
                setError(null)
                try {
                  const { project } = await coreApi.createProject(name.trim(), colour)
                  setCreating(false)
                  setName('')
                  refresh()
                  window.location.hash = hrefFor({ page: 'project', id: project.id })
                } catch (e) {
                  setError(e instanceof Error ? e.message : String(e))
                }
              }}
            >
              Create project
            </Button>
          </>
        }
      >
        <label className="md-field">
          <span className="md-field-label">Name</span>
          <input className="md-input" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <div className="md-field">
          <span className="md-field-label">Colour</span>
          <span className="mx-row" role="radiogroup" aria-label="Colour">
            {[1, 2, 3, 4, 5, 6, 7, 8].map((c) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={colour === c}
                aria-label={`Colour ${c}`}
                className={`mx-colour mx-project-${c}`}
                onClick={() => setColour(c)}
              />
            ))}
          </span>
        </div>
        {error ? <span className="md-field-error">{error}</span> : null}
      </Dialog>
    </nav>
  )
}
