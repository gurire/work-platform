/**
 * The single permission decision function. Implements specs/permission-matrix.md (section 5).
 * Every surface (API, sync, search, export, notifications, MCP, AI) must ask `decide` and
 * nothing else. Deny by default: anything not granted here is refused.
 *
 * Do not change behaviour here without a change to the spec, approved by the owner.
 */

export const PERMISSION_ACTIONS = [
  'item.view',
  'item.create',
  'item.edit',
  'item.transition',
  'item.assign',
  'item.move',
  'item.delete',
  'item.restore',
  'item.purge',
  'comment.add',
  'comment.editOwn',
  'comment.deleteAny',
  'attachment.add',
  'attachment.delete',
  'savedView.manage',
  'team.config.edit',
  'team.access.edit',
  'org.config.edit',
  'org.security.edit',
  'audit.view',
  'item.export',
] as const

export type PermissionAction = (typeof PERMISSION_ACTIONS)[number]

export type OrgRole = 'org_admin' | 'member' | 'viewer'
export type TeamRole = 'admin' | 'member'

export interface UserPrincipal {
  readonly kind: 'user'
  readonly id: string
  readonly orgRole: OrgRole
  /** Current team memberships only. Access follows current membership (decision 8). */
  readonly teams: Readonly<Record<string, TeamRole>>
}

export interface AgentPrincipal {
  readonly kind: 'agent'
  readonly id: string
  /** The person accountable for this agent or API key. The agent never exceeds their access. */
  readonly owner: UserPrincipal
  /** "By scope" actions this agent may attempt. */
  readonly scopes: ReadonlySet<PermissionAction>
  /** "Granted" actions an org admin has explicitly granted. */
  readonly grants: ReadonlySet<PermissionAction>
}

export type Principal = UserPrincipal | AgentPrincipal

export interface TeamRef {
  readonly id: string
  readonly isPrivate: boolean
}

export interface PermissionTarget {
  /** The team the object belongs to. Omit only for org-level actions. */
  readonly team?: TeamRef
  /** Who created the item, attachment, comment or saved view the action is about. */
  readonly createdBy?: string
  /** For `item.move`: the team the item is moving to. */
  readonly destinationTeam?: TeamRef
}

export interface Decision {
  readonly allowed: boolean
  /** True when the action must be written to the audit log if it goes ahead. */
  readonly audit: boolean
}

const DENY: Decision = { allowed: false, audit: false }
const ALLOW: Decision = { allowed: true, audit: false }
const ALLOW_AUDITED: Decision = { allowed: true, audit: true }

/** Actions an agent or API key can never perform, whatever it has been given. */
const AGENT_NEVER: ReadonlySet<PermissionAction> = new Set([
  'item.move',
  'item.restore',
  'item.purge',
  'comment.deleteAny',
  'attachment.delete',
  'savedView.manage',
  'team.access.edit',
  'org.security.edit',
  'audit.view',
])

/** Actions an agent may perform only if an org admin granted them. */
const AGENT_GRANTED: ReadonlySet<PermissionAction> = new Set([
  'item.delete',
  'team.config.edit',
  'org.config.edit',
])

const ORG_LEVEL: ReadonlySet<PermissionAction> = new Set([
  'org.config.edit',
  'org.security.edit',
  'audit.view',
])

function isKnownAction(action: string): action is PermissionAction {
  return (PERMISSION_ACTIONS as readonly string[]).includes(action)
}

/** "Open" in the spec: every team that is not private, plus private teams they belong to. */
function canSeeTeam(user: UserPrincipal, team: TeamRef): boolean {
  return !team.isPrivate || user.teams[team.id] !== undefined
}

function decideForUser(
  user: UserPrincipal,
  action: PermissionAction,
  target: PermissionTarget,
): Decision {
  const { team } = target

  if (ORG_LEVEL.has(action)) {
    return user.orgRole === 'org_admin' ? ALLOW_AUDITED : DENY
  }
  // Every other action is about something inside a team.
  if (!team) return DENY

  if (user.orgRole === 'org_admin') {
    const sensitive =
      action === 'item.export' ||
      action === 'item.purge' ||
      action === 'team.access.edit' ||
      (team.isPrivate && user.teams[team.id] === undefined)
    return sensitive ? ALLOW_AUDITED : ALLOW
  }

  const teamRole = user.teams[team.id]
  const inTeam = teamRole !== undefined
  const isTeamAdmin = teamRole === 'admin'
  const visible = canSeeTeam(user, team)
  const isCreator = target.createdBy !== undefined && target.createdBy === user.id

  if (user.orgRole === 'viewer') {
    if (action === 'item.view') return visible ? ALLOW : DENY
    if (action === 'savedView.manage') return visible && isCreator ? ALLOW : DENY
    return DENY
  }

  switch (action) {
    case 'item.view':
      return visible ? ALLOW : DENY
    case 'item.export':
      return visible ? ALLOW_AUDITED : DENY
    case 'item.create':
    case 'item.edit':
    case 'item.transition':
    case 'item.assign':
    case 'comment.add':
    case 'attachment.add':
    case 'savedView.manage':
      return inTeam ? ALLOW : DENY
    case 'item.move': {
      if (isTeamAdmin) return ALLOW
      const destination = target.destinationTeam
      return inTeam && destination !== undefined && user.teams[destination.id] !== undefined
        ? ALLOW
        : DENY
    }
    case 'item.delete':
    case 'item.restore':
    case 'attachment.delete':
      return isTeamAdmin || (inTeam && isCreator) ? ALLOW : DENY
    case 'comment.editOwn':
      return visible && isCreator ? ALLOW : DENY
    case 'comment.deleteAny':
    case 'team.config.edit':
      return isTeamAdmin ? ALLOW : DENY
    case 'team.access.edit':
      return isTeamAdmin ? ALLOW_AUDITED : DENY
    case 'item.purge':
      return DENY
    default:
      return DENY
  }
}

function decideForAgent(
  agent: AgentPrincipal,
  action: PermissionAction,
  target: PermissionTarget,
): Decision {
  if (AGENT_NEVER.has(action)) return DENY
  const held = AGENT_GRANTED.has(action) ? agent.grants.has(action) : agent.scopes.has(action)
  if (!held) return DENY

  // The agent's own comments are the ones it authored; everything else is capped by the owner.
  if (action === 'comment.editOwn') {
    const ownerCanSee = decideForUser(agent.owner, 'item.view', target).allowed
    return ownerCanSee && target.createdBy === agent.id ? ALLOW_AUDITED : DENY
  }
  // Never beyond the owner's access. Agent actions are always audited (principle 7).
  return decideForUser(agent.owner, action, target).allowed ? ALLOW_AUDITED : DENY
}

/** May this principal do this action on this target? Unknown input is always refused. */
export function decide(
  principal: Principal,
  action: PermissionAction,
  target: PermissionTarget = {},
): Decision {
  if (!isKnownAction(action)) return DENY
  return principal.kind === 'agent'
    ? decideForAgent(principal, action, target)
    : decideForUser(principal, action, target)
}

export function can(
  principal: Principal,
  action: PermissionAction,
  target: PermissionTarget = {},
): boolean {
  return decide(principal, action, target).allowed
}
