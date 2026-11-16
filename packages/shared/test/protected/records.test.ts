/**
 * PROTECTED TEST. specs/records.md: field rules (rule 2), history (rule 3) and the permission
 * rows (section 4). Human-owned once the spec is merged: do not edit to make code pass.
 */
import { describe, expect, it } from 'vitest'
import {
  can,
  checkRecordValues,
  recordChanges,
  type AgentPrincipal,
  type PermissionAction,
  type PermissionTarget,
  type RecordType,
  type UserPrincipal,
} from '../../src/index.js'

const dataset: RecordType = {
  key: 'dataset',
  name: 'Dataset',
  fields: [
    { key: 'source', label: 'Source', kind: 'text', required: true },
    { key: 'rows', label: 'Rows', kind: 'number', required: false },
    { key: 'refreshed', label: 'Last refreshed', kind: 'date', required: false },
    { key: 'url', label: 'Link', kind: 'link', required: false },
    {
      key: 'frequency',
      label: 'Frequency',
      kind: 'choice',
      required: false,
      options: ['monthly', 'quarterly', 'yearly'],
    },
  ],
}
const current = {
  source: 'IMD',
  rows: 1200,
  refreshed: '2026-10-01',
  url: null,
  frequency: 'monthly',
}

describe('record field values (specs/records.md, rule 2)', () => {
  it('accepts values that fit and returns the full set after the change', () => {
    expect(checkRecordValues(dataset, { source: ' IMD gridded ' }, current)).toEqual({
      ok: true,
      values: { ...current, source: 'IMD gridded' },
    })
    expect(
      checkRecordValues(dataset, { url: 'https://example.org/rain', rows: 0 }, current).ok,
    ).toBe(true)
  })

  it('example 2: a choice must be one of its options', () => {
    expect(checkRecordValues(dataset, { frequency: 'weekly' }, current)).toEqual({
      ok: false,
      error: 'invalid_value',
      field: 'frequency',
    })
  })

  it('example 3: a required field can never be emptied', () => {
    expect(checkRecordValues(dataset, { source: '  ' }, current)).toEqual({
      ok: false,
      error: 'required_missing',
      field: 'source',
    })
    expect(checkRecordValues(dataset, { rows: 5 })).toEqual({
      ok: false,
      error: 'required_missing',
      field: 'source',
    })
  })

  it('numbers, dates and links must be real ones; unknown fields are refused', () => {
    const bad: [Record<string, string | number | null>, string][] = [
      [{ rows: '12' }, 'rows'],
      [{ rows: Number.NaN }, 'rows'],
      [{ refreshed: '2026-02-30' }, 'refreshed'],
      [{ refreshed: '01/10/2026' }, 'refreshed'],
      [{ url: 'ftp://example.org' }, 'url'],
      [{ url: 'javascript:alert(1)' }, 'url'],
    ]
    for (const [changes, field] of bad) {
      expect(checkRecordValues(dataset, changes, current)).toEqual({
        ok: false,
        error: 'invalid_value',
        field,
      })
    }
    expect(checkRecordValues(dataset, { colour: 'red' }, current)).toEqual({
      ok: false,
      error: 'unknown_field',
      field: 'colour',
    })
  })

  it('emptying an optional field stores null', () => {
    const result = checkRecordValues(dataset, { frequency: '' }, current)
    expect(result.ok && result.values.frequency).toBe(null)
  })

  it('rule 3: history lists each changed field with old and new values', () => {
    expect(recordChanges(current, { ...current, source: 'IMD gridded', url: null })).toEqual([
      { field: 'source', from: 'IMD', to: 'IMD gridded' },
    ])
    expect(recordChanges({}, { source: 'IMD' })).toEqual([
      { field: 'source', from: null, to: 'IMD' },
    ])
  })
})

const user = (id: string, orgRole: UserPrincipal['orgRole'], teams: UserPrincipal['teams']) =>
  ({ kind: 'user', id, orgRole, teams }) satisfies UserPrincipal
const orgAdmin = user('org-admin', 'org_admin', {})
const adminD = user('admin-d', 'member', { DATA: 'admin' })
const memberD = user('member-d', 'member', { DATA: 'member' })
const reviewerD = user('reviewer-d', 'member', { DATA: 'reviewer' })
const memberE = user('member-e', 'member', { ENG: 'member' })
const viewer = user('viewer', 'viewer', {})
const agent = (owner: UserPrincipal, actions: PermissionAction[]): AgentPrincipal => ({
  kind: 'agent',
  id: `agent-of-${owner.id}`,
  owner,
  scopes: new Set(actions),
  grants: new Set(actions),
})
const homeData: PermissionTarget = { team: { id: 'DATA', isPrivate: false } }
const homeSec: PermissionTarget = { team: { id: 'SEC', isPrivate: true } }

type Row = [string, UserPrincipal | AgentPrincipal, PermissionAction, PermissionTarget, boolean]
const rows: Row[] = [
  // Record: view = item.view on the home team (default 2)
  ['member of another team sees a record of an open team', memberE, 'item.view', homeData, true],
  ['example 5: a private home team hides the record', memberE, 'item.view', homeSec, false],
  ['viewer sees a record of an open team', viewer, 'item.view', homeData, true],
  // Record: create in a home team (Y / Team / Team / N / N / By scope)
  ['org admin creates a record', orgAdmin, 'record.create', homeData, true],
  ['member creates a record in own team', memberD, 'record.create', homeData, true],
  ['member cannot create in another team', memberE, 'record.create', homeData, false],
  ['reviewer cannot create a record', reviewerD, 'record.create', homeData, false],
  ['viewer cannot create a record', viewer, 'record.create', homeData, false],
  ['agent with scope creates', agent(memberD, ['record.create']), 'record.create', homeData, true],
  // Record: edit fields (Y / Team / Team / N / N / By scope) — default 1
  ['team admin edits a record', adminD, 'record.edit', homeData, true],
  ['member of the home team edits a record', memberD, 'record.edit', homeData, true],
  ['example 4: a team that only links may not edit', memberE, 'record.edit', homeData, false],
  ['reviewer cannot edit a record', reviewerD, 'record.edit', homeData, false],
  // Record: archive (Y / Team / N / N / N / N) — defaults 3 and 4
  ['org admin archives', orgAdmin, 'record.archive', homeData, true],
  ['team admin archives', adminD, 'record.archive', homeData, true],
  ['member cannot archive', memberD, 'record.archive', homeData, false],
  ['agent can never archive', agent(adminD, ['record.archive']), 'record.archive', homeData, false],
  // Record types: the catalogue is org configuration (rule 6)
  ['org admin edits the catalogue', orgAdmin, 'org.config.edit', {}, true],
  ['team admin cannot edit the catalogue', adminD, 'org.config.edit', {}, false],
]

describe('permission matrix: record rows (specs/records.md, section 4)', () => {
  it.each(rows)('%s', (_name, principal, action, target, expected) => {
    expect(can(principal, action, target)).toBe(expected)
  })
})
