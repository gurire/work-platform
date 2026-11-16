/**
 * PROTECTED TEST. Generated from specs/permission-matrix.md, section 5 (approved 16 Nov 2026; decision 14 added the same day).
 * Human-owned: do not edit to make code pass. If a row looks wrong, raise it with the owner
 * and change the spec first.
 */
import { describe, expect, it } from 'vitest'
import {
  can,
  decide,
  PERMISSION_ACTIONS,
  type AgentPrincipal,
  type PermissionAction,
  type PermissionTarget,
  type TeamRef,
  type UserPrincipal,
} from '../../src/index.js'

// --- Fixture: two open teams, one private team -----------------------------------------------
const A: TeamRef = { id: 'team-a', isPrivate: false }
const B: TeamRef = { id: 'team-b', isPrivate: false }
const P: TeamRef = { id: 'team-p', isPrivate: true }

const user = (id: string, orgRole: UserPrincipal['orgRole'], teams: UserPrincipal['teams']) =>
  ({ kind: 'user', id, orgRole, teams }) satisfies UserPrincipal

const orgAdmin = user('org-admin', 'org_admin', {})
const adminA = user('admin-a', 'member', { 'team-a': 'admin' })
const memberA = user('member-a', 'member', { 'team-a': 'member' })
const memberAB = user('member-ab', 'member', { 'team-a': 'member', 'team-b': 'member' })
const memberP = user('member-p', 'member', { 'team-p': 'member' })
const viewer = user('viewer', 'viewer', {})
const exMemberA = user('ex-member-a', 'member', {})

const agent = (
  owner: UserPrincipal,
  scopes: PermissionAction[],
  grants: PermissionAction[] = [],
): AgentPrincipal => ({
  kind: 'agent',
  id: `agent-of-${owner.id}`,
  owner,
  scopes: new Set(scopes),
  grants: new Set(grants),
})

const inA = (extra: Partial<PermissionTarget> = {}): PermissionTarget => ({ team: A, ...extra })
const inB = (extra: Partial<PermissionTarget> = {}): PermissionTarget => ({ team: B, ...extra })
const inP = (extra: Partial<PermissionTarget> = {}): PermissionTarget => ({ team: P, ...extra })

type Row = [string, UserPrincipal | AgentPrincipal, PermissionAction, PermissionTarget, boolean]

const TEAM_CHANGE_ACTIONS: PermissionAction[] = [
  'item.create',
  'item.edit',
  'item.transition',
  'item.assign',
  'comment.add',
  'attachment.add',
]

const rows: Row[] = [
  // Work item: view (Y / Open / Open / Open)
  ['org admin views open team', orgAdmin, 'item.view', inA(), true],
  ['org admin views private team', orgAdmin, 'item.view', inP(), true],
  ['team admin views another open team', adminA, 'item.view', inB(), true],
  ['member views another open team', memberA, 'item.view', inB(), true],
  ['viewer views open team', viewer, 'item.view', inA(), true],
  ['member cannot view a private team they are not on', memberA, 'item.view', inP(), false],
  ['team admin cannot view a private team they are not on', adminA, 'item.view', inP(), false],
  ['viewer cannot view a private team', viewer, 'item.view', inP(), false],
  ['private team member views their team', memberP, 'item.view', inP(), true],

  // Create, edit, status, assign, comment, attach (Y / Team / Team / N)
  ...TEAM_CHANGE_ACTIONS.flatMap((action): Row[] => [
    [`org admin: ${action}`, orgAdmin, action, inA(), true],
    [`team admin in own team: ${action}`, adminA, action, inA(), true],
    [`member in own team: ${action}`, memberA, action, inA(), true],
    [`member in another open team is read-only: ${action}`, memberA, action, inB(), false],
    [`team admin in another open team is read-only: ${action}`, adminA, action, inB(), false],
    [`viewer: ${action}`, viewer, action, inA(), false],
  ]),

  // Move (Y / Team source / member of both / N)
  ['org admin moves item', orgAdmin, 'item.move', inA({ destinationTeam: B }), true],
  ['source team admin moves item', adminA, 'item.move', inA({ destinationTeam: B }), true],
  ['member of both teams moves item', memberAB, 'item.move', inA({ destinationTeam: B }), true],
  ['member of source only cannot move', memberA, 'item.move', inA({ destinationTeam: B }), false],
  [
    'admin of destination only cannot move',
    adminA,
    'item.move',
    inB({ destinationTeam: A }),
    false,
  ],
  ['viewer cannot move', viewer, 'item.move', inA({ destinationTeam: B }), false],

  // Soft delete and restore (Y / Team / Own / N)
  ['org admin deletes', orgAdmin, 'item.delete', inA({ createdBy: 'member-a' }), true],
  [
    'team admin deletes any item in team',
    adminA,
    'item.delete',
    inA({ createdBy: 'member-a' }),
    true,
  ],
  ['member deletes own item', memberA, 'item.delete', inA({ createdBy: 'member-a' }), true],
  [
    'member cannot delete another person item',
    memberA,
    'item.delete',
    inA({ createdBy: 'x' }),
    false,
  ],
  ['viewer cannot delete', viewer, 'item.delete', inA({ createdBy: 'viewer' }), false],
  [
    'ex-member cannot delete their old item',
    exMemberA,
    'item.delete',
    inA({ createdBy: 'ex-member-a' }),
    false,
  ],
  ['member restores own item', memberA, 'item.restore', inA({ createdBy: 'member-a' }), true],
  [
    'member cannot restore another person item',
    memberA,
    'item.restore',
    inA({ createdBy: 'x' }),
    false,
  ],
  ['team admin restores', adminA, 'item.restore', inA({ createdBy: 'x' }), true],

  // Permanent delete (Y / N / N / N)
  ['org admin purges', orgAdmin, 'item.purge', inA(), true],
  ['team admin cannot purge', adminA, 'item.purge', inA(), false],
  ['member cannot purge own item', memberA, 'item.purge', inA({ createdBy: 'member-a' }), false],

  // Comments
  ['member edits own comment', memberA, 'comment.editOwn', inA({ createdBy: 'member-a' }), true],
  [
    'member cannot edit another comment',
    memberA,
    'comment.editOwn',
    inA({ createdBy: 'x' }),
    false,
  ],
  ['viewer cannot edit a comment', viewer, 'comment.editOwn', inA({ createdBy: 'viewer' }), false],
  [
    'ex-member cannot edit their old comment (decision 14)',
    exMemberA,
    'comment.editOwn',
    inA({ createdBy: 'ex-member-a' }),
    false,
  ],
  [
    'member cannot edit own comment in a team they are not on',
    memberA,
    'comment.editOwn',
    inB({ createdBy: 'member-a' }),
    false,
  ],
  ['team admin deletes any comment in team', adminA, 'comment.deleteAny', inA(), true],
  ['team admin cannot delete comments elsewhere', adminA, 'comment.deleteAny', inB(), false],
  ['member cannot delete any comment', memberA, 'comment.deleteAny', inA(), false],

  // Attachment delete (Y / Team / Own / N)
  [
    'member deletes own attachment',
    memberA,
    'attachment.delete',
    inA({ createdBy: 'member-a' }),
    true,
  ],
  [
    'member cannot delete another attachment',
    memberA,
    'attachment.delete',
    inA({ createdBy: 'x' }),
    false,
  ],
  ['team admin deletes attachment', adminA, 'attachment.delete', inA({ createdBy: 'x' }), true],

  // Saved views (Y / Team / Team / Own)
  ['member manages saved view in team', memberA, 'savedView.manage', inA({ createdBy: 'x' }), true],
  ['member cannot manage saved view elsewhere', memberA, 'savedView.manage', inB(), false],
  ['viewer manages own saved view', viewer, 'savedView.manage', inA({ createdBy: 'viewer' }), true],
  [
    'viewer cannot manage another saved view',
    viewer,
    'savedView.manage',
    inA({ createdBy: 'x' }),
    false,
  ],

  // Configuration
  ['team admin edits team workflows', adminA, 'team.config.edit', inA(), true],
  ['team admin cannot edit another team', adminA, 'team.config.edit', inB(), false],
  ['member cannot edit team workflows', memberA, 'team.config.edit', inA(), false],
  ['team admin edits membership', adminA, 'team.access.edit', inA(), true],
  ['member cannot edit membership', memberA, 'team.access.edit', inA(), false],
  ['org admin edits org configuration', orgAdmin, 'org.config.edit', {}, true],
  ['team admin cannot edit org configuration', adminA, 'org.config.edit', {}, false],
  ['org admin edits security settings', orgAdmin, 'org.security.edit', {}, true],
  ['member cannot edit security settings', memberA, 'org.security.edit', {}, false],
  ['org admin views audit log', orgAdmin, 'audit.view', {}, true],
  ['team admin cannot view audit log', adminA, 'audit.view', {}, false],

  // Export (Y / Open / Open / N)
  ['member exports another open team', memberA, 'item.export', inB(), true],
  ['member cannot export a private team', memberA, 'item.export', inP(), false],
  ['viewer cannot export', viewer, 'item.export', inA(), false],

  // Agents and API keys
  ['agent with scope views', agent(memberA, ['item.view']), 'item.view', inA(), true],
  ['agent without scope cannot view', agent(memberA, []), 'item.view', inA(), false],
  [
    'agent cannot see what its owner cannot',
    agent(memberA, ['item.view']),
    'item.view',
    inP(),
    false,
  ],
  ['agent edits in owner team', agent(memberA, ['item.edit']), 'item.edit', inA(), true],
  [
    'agent cannot edit outside owner teams',
    agent(memberA, ['item.edit']),
    'item.edit',
    inB(),
    false,
  ],
  [
    'agent delete needs a grant, not a scope',
    agent(adminA, ['item.delete']),
    'item.delete',
    inA(),
    false,
  ],
  ['agent with grant deletes', agent(adminA, [], ['item.delete']), 'item.delete', inA(), true],
  [
    'agent with grant edits team workflows',
    agent(adminA, [], ['team.config.edit']),
    'team.config.edit',
    inA(),
    true,
  ],
  [
    'agent with grant edits org configuration',
    agent(orgAdmin, [], ['org.config.edit']),
    'org.config.edit',
    {},
    true,
  ],
  [
    'agent grant is capped by owner',
    agent(memberA, [], ['org.config.edit']),
    'org.config.edit',
    {},
    false,
  ],
  [
    'agent edits its own comment',
    agent(memberA, ['comment.editOwn']),
    'comment.editOwn',
    inA({ createdBy: 'agent-of-member-a' }),
    true,
  ],
  [
    'agent cannot edit its owner comment',
    agent(memberA, ['comment.editOwn']),
    'comment.editOwn',
    inA({ createdBy: 'member-a' }),
    false,
  ],
]

describe('permission matrix (spec section 5)', () => {
  it.each(rows)('%s', (_name, principal, action, target, expected) => {
    expect(can(principal, action, target)).toBe(expected)
  })
})

describe('permission principles', () => {
  const targets: PermissionTarget[] = [
    {},
    inA(),
    inB(),
    inP(),
    inA({ createdBy: 'member-a' }),
    inA({ destinationTeam: B }),
    inA({ createdBy: 'agent-of-member-a' }),
  ]
  const owners = [orgAdmin, adminA, memberA, memberAB, memberP, viewer, exMemberA]
  const everything = [...PERMISSION_ACTIONS]

  it('denies by default: unknown actions and missing teams', () => {
    expect(can(orgAdmin, 'item.fly' as PermissionAction, inA())).toBe(false)
    expect(can(memberA, 'item.view', {})).toBe(false)
    expect(can(memberA, 'item.edit')).toBe(false)
  })

  it('an agent never exceeds its owner, even with every scope and grant', () => {
    for (const owner of owners) {
      const powerful = agent(owner, everything, everything)
      for (const action of everything) {
        if (action === 'comment.editOwn') continue // "own" means the agent's own comments
        for (const target of targets) {
          if (can(powerful, action, target)) expect(can(owner, action, target)).toBe(true)
        }
      }
    }
  })

  it('an agent can never do the forbidden actions (decisions 6, 11 and 13)', () => {
    const forbidden: PermissionAction[] = [
      'item.move',
      'item.restore',
      'item.purge',
      'comment.deleteAny',
      'attachment.delete',
      'savedView.manage',
      'team.access.edit',
      'org.security.edit',
      'audit.view',
    ]
    const powerful = agent(orgAdmin, everything, everything)
    for (const action of forbidden) {
      for (const target of targets) expect(can(powerful, action, target)).toBe(false)
    }
  })

  it('a viewer can never change work items', () => {
    for (const action of everything) {
      if (action === 'item.view' || action === 'savedView.manage') continue
      for (const target of targets) expect(can(viewer, action, target)).toBe(false)
    }
  })

  it('access follows current membership (decision 8)', () => {
    expect(can(exMemberA, 'item.edit', inA({ createdBy: 'ex-member-a' }))).toBe(false)
    expect(can(exMemberA, 'item.view', inA())).toBe(true) // open team stays readable
    expect(can(exMemberA, 'item.view', inP())).toBe(false)
  })

  it('marks sensitive actions for the audit log', () => {
    expect(decide(orgAdmin, 'item.view', inP()).audit).toBe(true) // decision 9
    expect(decide(orgAdmin, 'item.view', inA()).audit).toBe(false)
    expect(decide(memberA, 'item.export', inA()).audit).toBe(true) // decision 5
    expect(decide(agent(memberA, ['item.edit']), 'item.edit', inA()).audit).toBe(true)
    expect(decide(memberA, 'item.view', inP())).toEqual({ allowed: false, audit: false })
  })
})
