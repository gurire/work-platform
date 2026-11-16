/**
 * PROTECTED TEST. The four rows added to specs/permission-matrix.md by specs/workflow.md,
 * section 4 (approved 16 Nov 2026). Human-owned: do not edit to make code pass.
 */
import { describe, expect, it } from 'vitest'
import {
  can,
  decide,
  type AgentPrincipal,
  type PermissionAction,
  type PermissionTarget,
  type TeamRef,
  type UserPrincipal,
} from '../../src/index.js'

const A: TeamRef = { id: 'team-a', isPrivate: false }
const B: TeamRef = { id: 'team-b', isPrivate: false }
const user = (id: string, orgRole: UserPrincipal['orgRole'], teams: UserPrincipal['teams']) =>
  ({ kind: 'user', id, orgRole, teams }) satisfies UserPrincipal
const orgAdmin = user('org-admin', 'org_admin', {})
const adminA = user('admin-a', 'member', { 'team-a': 'admin' })
const memberA = user('member-a', 'member', { 'team-a': 'member' })
const viewer = user('viewer', 'viewer', {})
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
const inA: PermissionTarget = { team: A }
const inB: PermissionTarget = { team: B }

type Row = [string, UserPrincipal | AgentPrincipal, PermissionAction, PermissionTarget, boolean]

const rows: Row[] = [
  // Tick or untick a stage step (Y / Team / Team / N / By scope)
  ['org admin ticks a step', orgAdmin, 'item.tickStep', inA, true],
  ['team admin ticks a step in own team', adminA, 'item.tickStep', inA, true],
  ['member ticks a step in own team', memberA, 'item.tickStep', inA, true],
  ['member cannot tick a step in another team', memberA, 'item.tickStep', inB, false],
  ['viewer cannot tick a step (example 16)', viewer, 'item.tickStep', inA, false],
  ['agent with scope ticks a step', agent(memberA, ['item.tickStep']), 'item.tickStep', inA, true],
  ['agent without scope cannot tick', agent(memberA, []), 'item.tickStep', inA, false],

  // Force a move, audited (Y / Team / N / N / N)
  ['org admin forces a move', orgAdmin, 'item.forceMove', inA, true],
  ['team admin forces a move in own team', adminA, 'item.forceMove', inA, true],
  ['team admin cannot force in another team', adminA, 'item.forceMove', inB, false],
  ['member cannot force a move', memberA, 'item.forceMove', inA, false],
  ['viewer cannot force a move', viewer, 'item.forceMove', inA, false],
  [
    'agent owned by a team admin can never force',
    agent(adminA, ['item.forceMove'], ['item.forceMove']),
    'item.forceMove',
    inA,
    false,
  ],

  // Reopen from an end stage (Y / Team / Team / N / By scope)
  ['member reopens in own team', memberA, 'item.reopen', inA, true],
  ['member cannot reopen in another team', memberA, 'item.reopen', inB, false],
  ['viewer cannot reopen', viewer, 'item.reopen', inA, false],
  ['agent with scope reopens', agent(memberA, ['item.reopen']), 'item.reopen', inA, true],

  // Edit stage rules is team configuration (Y / Team / N / N / Granted)
  ['team admin edits stage rules', adminA, 'team.config.edit', inA, true],
  ['member cannot edit stage rules', memberA, 'team.config.edit', inA, false],
  [
    'agent edits stage rules only when granted',
    agent(adminA, ['team.config.edit']),
    'team.config.edit',
    inA,
    false,
  ],
]

describe('permission matrix: workflow rows', () => {
  it.each(rows)('%s', (_name, principal, action, target, expected) => {
    expect(can(principal, action, target)).toBe(expected)
  })

  it('audits every forced move', () => {
    expect(decide(adminA, 'item.forceMove', inA)).toEqual({ allowed: true, audit: true })
    expect(decide(orgAdmin, 'item.forceMove', inA)).toEqual({ allowed: true, audit: true })
  })
})
