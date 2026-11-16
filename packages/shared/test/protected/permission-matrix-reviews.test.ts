/**
 * PROTECTED TEST. The review rows and the Reviewer team role added to the permission matrix by
 * specs/reviews.md, section 4 (merged 17 Nov 2026). Human-owned: do not edit to make code pass.
 */
import { describe, expect, it } from 'vitest'
import {
  can,
  PERMISSION_ACTIONS,
  type AgentPrincipal,
  type PermissionAction,
  type PermissionTarget,
  type TeamRef,
  type UserPrincipal,
} from '../../src/index.js'

const A: TeamRef = { id: 'team-a', isPrivate: false }
const B: TeamRef = { id: 'team-b', isPrivate: false }
const P: TeamRef = { id: 'team-p', isPrivate: true }
const user = (id: string, orgRole: UserPrincipal['orgRole'], teams: UserPrincipal['teams']) =>
  ({ kind: 'user', id, orgRole, teams }) satisfies UserPrincipal
const orgAdmin = user('org-admin', 'org_admin', {})
const adminA = user('admin-a', 'member', { 'team-a': 'admin' })
const memberA = user('member-a', 'member', { 'team-a': 'member' })
const reviewerA = user('reviewer-a', 'member', { 'team-a': 'reviewer' })
const reviewerP = user('reviewer-p', 'member', { 'team-p': 'reviewer' })
const viewer = user('viewer', 'viewer', {})
const agent = (owner: UserPrincipal, actions: PermissionAction[]): AgentPrincipal => ({
  kind: 'agent',
  id: `agent-of-${owner.id}`,
  owner,
  scopes: new Set(actions),
  grants: new Set(actions),
})
const inA = (extra: Partial<PermissionTarget> = {}): PermissionTarget => ({ team: A, ...extra })
const inB: PermissionTarget = { team: B }

type Row = [string, UserPrincipal | AgentPrincipal, PermissionAction, PermissionTarget, boolean]

const rows: Row[] = [
  // Review: open a round (Y / Team / Team / N / N / By scope)
  ['org admin opens a round', orgAdmin, 'review.open', inA(), true],
  ['team admin opens a round', adminA, 'review.open', inA(), true],
  ['member opens a round in own team', memberA, 'review.open', inA(), true],
  ['member cannot open a round in another team', memberA, 'review.open', inB, false],
  ['reviewer cannot open a round', reviewerA, 'review.open', inA(), false],
  ['viewer cannot open a round', viewer, 'review.open', inA(), false],
  ['agent with scope opens a round', agent(memberA, ['review.open']), 'review.open', inA(), true],

  // Review: give or change a verdict (Y / Team / Team / Team / N / N)
  ['org admin gives a verdict', orgAdmin, 'review.verdict', inA(), true],
  ['team admin gives a verdict', adminA, 'review.verdict', inA(), true],
  ['member gives a verdict in own team', memberA, 'review.verdict', inA(), true],
  ['reviewer gives a verdict in own team', reviewerA, 'review.verdict', inA(), true],
  ['reviewer cannot give a verdict in another team', reviewerA, 'review.verdict', inB, false],
  ['viewer cannot give a verdict', viewer, 'review.verdict', inA(), false],
  [
    'agent can never give a verdict (default 3)',
    agent(adminA, ['review.verdict']),
    'review.verdict',
    inA(),
    false,
  ],

  // Review: withdraw a round (Y / Team / Own / N / N / N)
  ['org admin withdraws', orgAdmin, 'review.withdraw', inA({ createdBy: 'x' }), true],
  ['team admin withdraws any round', adminA, 'review.withdraw', inA({ createdBy: 'x' }), true],
  ['member withdraws own round', memberA, 'review.withdraw', inA({ createdBy: 'member-a' }), true],
  ['member cannot withdraw others', memberA, 'review.withdraw', inA({ createdBy: 'x' }), false],
  [
    'reviewer cannot withdraw',
    reviewerA,
    'review.withdraw',
    inA({ createdBy: 'reviewer-a' }),
    false,
  ],
  [
    'agent can never withdraw',
    agent(adminA, ['review.withdraw']),
    'review.withdraw',
    inA({ createdBy: 'agent-of-admin-a' }),
    false,
  ],

  // Comment: add — reviewers may comment on their team's items
  ['reviewer comments in own team', reviewerA, 'comment.add', inA(), true],
  ['reviewer cannot comment in another team', reviewerA, 'comment.add', inB, false],

  // Team configuration: review stages (= team.config.edit)
  ['team admin sets up review stages', adminA, 'team.config.edit', inA(), true],
  ['member cannot set up review stages', memberA, 'team.config.edit', inA(), false],
  ['reviewer cannot set up review stages', reviewerA, 'team.config.edit', inA(), false],
]

describe('permission matrix: review rows (specs/reviews.md, section 4)', () => {
  it.each(rows)('%s', (_name, principal, action, target, expected) => {
    expect(can(principal, action, target)).toBe(expected)
  })
})

describe('the Reviewer team role (specs/reviews.md, section 4)', () => {
  const allowed = new Set<PermissionAction>([
    'item.view',
    'item.export',
    'comment.add',
    'review.verdict',
  ])

  it('views what a member views, including its own private team', () => {
    expect(can(reviewerA, 'item.view', inA())).toBe(true)
    expect(can(reviewerA, 'item.view', inB)).toBe(true)
    expect(can(reviewerP, 'item.view', { team: P })).toBe(true)
    expect(can(reviewerA, 'item.view', { team: P })).toBe(false)
  })

  it('may do nothing else in its team: no editing, moving, assigning or ticking', () => {
    for (const action of PERMISSION_ACTIONS) {
      if (allowed.has(action)) continue
      // Own comments and own saved views are the reviewer's own objects.
      if (action === 'comment.editOwn' || action === 'savedView.manage') continue
      expect(can(reviewerA, action, inA()), action).toBe(false)
    }
  })

  it('a reviewer role in the destination team does not allow moving items there', () => {
    const memberAReviewerB = user('mix', 'member', { 'team-a': 'member', 'team-b': 'reviewer' })
    expect(can(memberAReviewerB, 'item.move', inA({ destinationTeam: B }))).toBe(false)
  })
})
