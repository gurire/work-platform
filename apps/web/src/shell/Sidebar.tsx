/**
 * The app's left-hand navigation (docs/research/ui-review, redesign step 2). Plain links, so
 * every place has an address, works with the back button and opens in a new tab.
 */
import {
  ChartColumn,
  Database,
  Inbox,
  LayoutGrid,
  ListChecks,
  Monitor,
  Moon,
  Search,
  SquareKanban,
  Sun,
  UserRound,
  Users,
} from 'lucide-react'
import type { ApiTeam, ApiUser, Me } from '../items/api'
import type { Route } from '../items/item-model'
import type { ThemeChoice } from '../items/ItemsScreen'
import { Avatar, TeamTile } from '../ui/kit'

interface Props {
  route: Route
  activeTeamId: string | null
  teams: readonly ApiTeam[]
  users: readonly ApiUser[]
  me: Me | null
  userId: string
  unread: number
  myOpen: number
  onSignIn: (userId: string) => void
  onCommands: () => void
  themeChoice: ThemeChoice
  onThemeChoice: (choice: ThemeChoice) => void
}

const ROLE: Record<string, string> = { org_admin: 'Org admin', member: 'Member', viewer: 'Viewer' }

function NavLink({
  href,
  current,
  icon,
  label,
  count,
  countLabel,
}: {
  href: string
  current: boolean
  icon: React.ReactNode
  label: string
  count?: number
  countLabel?: string
}) {
  return (
    <a
      className={current ? 'nav-link nav-current' : 'nav-link'}
      href={href}
      aria-current={current ? 'page' : undefined}
    >
      {icon}
      <span>{label}</span>
      {count !== undefined && count > 0 && (
        <span className="nav-count" aria-label={countLabel ? `${count} ${countLabel}` : undefined}>
          {count}
        </span>
      )}
    </a>
  )
}

export function Sidebar({
  route,
  activeTeamId,
  teams,
  users,
  me,
  userId,
  unread,
  myOpen,
  onSignIn,
  onCommands,
  themeChoice,
  onThemeChoice,
}: Props) {
  const page = route.page
  const icon = (Icon: typeof Inbox) => <Icon size={16} aria-hidden="true" />
  return (
    <nav className="sidebar" aria-label="Main">
      <div className="sidebar-brand">
        <span className="brand-mark" aria-hidden="true">
          W
        </span>
        <strong>Work Platform</strong>
      </div>
      <button
        type="button"
        className="sidebar-search"
        onClick={onCommands}
        aria-label="Search items or run a command"
      >
        <Search size={15} aria-hidden="true" />
        <span>Search…</span>
        <kbd>Ctrl K</kbd>
      </button>

      <div className="nav-group">
        <NavLink
          href="#/me"
          current={page === 'me'}
          icon={icon(UserRound)}
          label="My work"
          count={myOpen}
          countLabel="open items"
        />
        <NavLink
          href="#/inbox"
          current={page === 'inbox'}
          icon={icon(Inbox)}
          label="Inbox"
          count={unread}
          countLabel="unread"
        />
        <NavLink
          href="#/"
          current={page === 'list' && !route.teamId}
          icon={icon(ListChecks)}
          label="All items"
        />
        <NavLink
          href="#/dashboards"
          current={page === 'dashboards'}
          icon={icon(LayoutGrid)}
          label="All teams"
        />
        <NavLink href="#/people" current={page === 'people'} icon={icon(Users)} label="People" />
      </div>

      <div className="nav-group">
        <h2 className="nav-heading">Teams</h2>
        {teams.map((team) => {
          const open = team.id === activeTeamId
          const teamPage =
            route.page === 'list' ? route.teamId : 'teamId' in route ? route.teamId : undefined
          return (
            <div key={team.id} className="nav-team">
              <a
                className={
                  open && page === 'list' && teamPage === team.id
                    ? 'nav-link nav-current'
                    : 'nav-link'
                }
                href={`#/team/${team.id}`}
                aria-current={open && page === 'list' && teamPage === team.id ? 'page' : undefined}
              >
                <TeamTile id={team.id} name={team.name} size={18} />
                <span>{team.name}</span>
              </a>
              {open && (
                <div className="nav-sub">
                  <NavLink
                    href={`#/team/${team.id}`}
                    current={page === 'list'}
                    icon={icon(ListChecks)}
                    label="List"
                  />
                  <NavLink
                    href={`#/board/${team.id}`}
                    current={page === 'board'}
                    icon={icon(SquareKanban)}
                    label="Board"
                  />
                  <NavLink
                    href={`#/dashboard/${team.id}`}
                    current={page === 'dashboard'}
                    icon={icon(ChartColumn)}
                    label="Dashboard"
                  />
                </div>
              )}
            </div>
          )
        })}
        <span className="nav-link nav-muted" title="Records open from an item">
          {icon(Database)}
          <span>Records</span>
        </span>
      </div>

      <div className="sidebar-foot">
        <span className="person">
          <Avatar name={me?.name ?? null} id={me?.id ?? null} size={28} />
          <span className="foot-name">
            <b>{me?.name ?? '…'}</b>
            <small>{me ? ROLE[me.orgRole] : ''}</small>
          </span>
        </span>
        <div className="theme-switch" role="group" aria-label="Theme">
          {(
            [
              ['system', 'Match computer', Monitor],
              ['light', 'Light', Sun],
              ['dark', 'Dark', Moon],
            ] as const
          ).map(([choice, label, Icon]) => (
            <button
              key={choice}
              type="button"
              aria-pressed={themeChoice === choice}
              title={label}
              onClick={() => onThemeChoice(choice)}
            >
              <Icon size={14} aria-hidden="true" />
              <span>{choice === 'system' ? 'Auto' : label}</span>
            </button>
          ))}
        </div>
        <label className="dev-user">
          <span>Dev sign-in</span>
          <select
            value={userId}
            onChange={(event) => onSignIn(event.target.value)}
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
      </div>
    </nav>
  )
}
