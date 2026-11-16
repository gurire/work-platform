/**
 * PROTECTED TEST. Checks that the API enforces specs/workflow.md (approved 16 Nov 2026):
 * requirements, refused moves, forced moves, reopening and re-entry.
 * Human-owned: do not edit to make code pass.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../../src/app.js'
import { createPgliteDb, type Db } from '../../src/db/db.js'
import { migrate } from '../../src/db/migrations.js'
import { insertItem } from '../../src/db/seed.js'

let db: Db
let app: FastifyInstance
const as = (user: string) => ({ 'x-dev-user': user })
const patch = (id: string, user: string, payload: object) =>
  app.inject({ method: 'PATCH', url: `/items/${id}`, headers: as(user), payload })
const workflow = async (id: string, user = 'mem') =>
  (await app.inject({ method: 'GET', url: `/items/${id}/workflow`, headers: as(user) })).json()
const history = async (id: string) =>
  (await app.inject({ method: 'GET', url: `/items/${id}/stages`, headers: as('mem') })).json()
    .history
const tick = (id: string, user: string, stepId: string, ticked = true) =>
  app.inject({
    method: 'POST',
    url: `/items/${id}/steps/${stepId}`,
    headers: as(user),
    payload: { ticked },
  })
let stepIds: string[] = []

beforeAll(async () => {
  db = await createPgliteDb()
  await migrate(db)
  await db.exec(`
    INSERT INTO users (id, name, org_role) VALUES
      ('adm', 'Team admin', 'member'), ('mem', 'Member', 'member'),
      ('out', 'Other team member', 'member'), ('vie', 'Viewer', 'viewer');
    INSERT INTO teams (id, key, name, is_private) VALUES
      ('T', 'T', 'Pipeline', false), ('O', 'O', 'Other', false);
    DELETE FROM stages WHERE team_id = 'T';
    INSERT INTO stages (team_id, key, name, category, position) VALUES
      ('T', 'analysis', 'Analysis', 'todo', 1), ('T', 'sourcing', 'Sourcing', 'in_progress', 2),
      ('T', 'validation', 'Validation', 'in_progress', 3),
      ('T', 'client_review', 'Client review', 'in_progress', 4),
      ('T', 'published', 'Published', 'done', 5), ('T', 'dropped', 'Dropped', 'cancelled', 6);
    INSERT INTO stage_steps (team_id, stage_key, label, position) VALUES
      ('T', 'validation', 'Totals checked', 1), ('T', 'validation', 'Units confirmed', 2);
    INSERT INTO stage_required_fields (team_id, stage_key, field_key, label) VALUES
      ('T', 'validation', 'coverage', 'Coverage');
    INSERT INTO team_members (team_id, user_id, role) VALUES
      ('T', 'adm', 'admin'), ('T', 'mem', 'member'), ('O', 'out', 'member');
  `)
  const at = (id: string, statusId: string, statusCategory: string) =>
    insertItem(db, {
      id,
      key: id.toUpperCase(),
      kind: 'deliverable',
      title: id,
      statusId,
      statusCategory,
      teamId: 'T',
      assigneeId: null,
      createdBy: 'mem',
      fields: {},
    })
  await at('v1', 'validation', 'in_progress')
  await at('v2', 'validation', 'in_progress')
  await at('a1', 'analysis', 'todo')
  await at('p1', 'published', 'done')
  app = buildApp({ db, devAuth: true })
  stepIds = (await workflow('v1')).steps.map((s: { id: string }) => s.id)
})

afterAll(async () => {
  await app.close()
  await db.close()
})

describe('stage rules on the API surface', () => {
  it('shows the current checklist, required fields and allowed moves, even to viewers', async () => {
    const state = await workflow('v1', 'vie')
    expect(state.steps.map((s: { label: string; ticked: boolean }) => [s.label, s.ticked])).toEqual(
      [
        ['Totals checked', false],
        ['Units confirmed', false],
      ],
    )
    expect(state.missing).toEqual(['Totals checked', 'Units confirmed', 'Coverage'])
    expect([...state.allowedMoves].sort()).toEqual(
      ['client_review', 'dropped', 'published', 'sourcing'].sort(),
    )
    expect(state.canForce).toBe(false)
    expect((await workflow('v1', 'adm')).canForce).toBe(true)
  })

  it('example 1 and 2: refuses a forward move, names what is missing, changes nothing', async () => {
    await tick('v1', 'mem', stepIds[0] as string)
    const res = await patch('v1', 'mem', { statusId: 'client_review' })
    expect(res.statusCode).toBe(409)
    expect(res.json()).toEqual({
      error: 'requirements_unmet',
      missing: ['Units confirmed', 'Coverage'],
    })
    expect((await workflow('v1')).stageKey).toBe('validation')
  })

  it('lets anyone in the team tick, records who, and refuses viewers (example 16)', async () => {
    const ticked = await tick('v1', 'adm', stepIds[1] as string)
    expect(ticked.statusCode).toBe(200)
    expect(ticked.json().steps[1]).toMatchObject({ ticked: true, tickedBy: 'adm' })
    expect((await tick('v1', 'vie', stepIds[1] as string)).statusCode).toBe(403)
    expect((await tick('v1', 'out', stepIds[1] as string)).statusCode).toBe(403)
    expect((await tick('a1', 'mem', stepIds[0] as string)).statusCode).toBe(400)
  })

  it('example 3: counts a field filled in by the same request', async () => {
    const res = await patch('v1', 'mem', {
      statusId: 'client_review',
      fields: { coverage: '2012 to 2025' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().item).toMatchObject({
      statusId: 'client_review',
      fields: { coverage: '2012 to 2025' },
    })
  })

  it('example 12: starts the checklist fresh on return, keeping field values', async () => {
    expect((await patch('v1', 'mem', { statusId: 'validation' })).statusCode).toBe(200)
    const state = await workflow('v1')
    expect(state.steps.every((s: { ticked: boolean }) => !s.ticked)).toBe(true)
    expect(state.missing).toEqual(['Totals checked', 'Units confirmed'])
  })

  it('examples 4 and 5: moving back or to a cancelled stage needs no requirements', async () => {
    expect((await patch('v2', 'mem', { statusId: 'sourcing' })).statusCode).toBe(200)
    expect((await patch('v2', 'mem', { statusId: 'validation' })).statusCode).toBe(200)
    expect((await patch('v2', 'mem', { statusId: 'dropped' })).statusCode).toBe(200)
  })

  it('examples 6 and 11: refuses a destination that is not allowed, even when forced', async () => {
    expect((await patch('a1', 'mem', { statusId: 'validation' })).json().error).toBe('not_allowed')
    const forced = await patch('a1', 'adm', {
      statusId: 'validation',
      force: true,
      reason: 'Urgent',
    })
    expect(forced.json().error).toBe('not_allowed')
  })

  it('examples 7 to 9: only a team admin forces, with a reason, and it is audited', async () => {
    const member = await patch('v1', 'mem', {
      statusId: 'client_review',
      force: true,
      reason: 'Please',
    })
    expect(member.statusCode).toBe(409)
    expect(member.json().error).toBe('cannot_force')
    const noReason = await patch('v1', 'adm', { statusId: 'client_review', force: true })
    expect(noReason.json().error).toBe('reason_required')
    const forced = await patch('v1', 'adm', {
      statusId: 'client_review',
      force: true,
      reason: 'Client deadline',
    })
    expect(forced.statusCode).toBe(200)
    const audit = await db.query<{ detail: { reason: string; missing: string[] } }>(
      "SELECT detail FROM audit_log WHERE action = 'item.forceMove' AND object_id = 'v1'",
    )
    expect(audit).toHaveLength(1)
    expect(audit[0]?.detail).toMatchObject({
      reason: 'Client deadline',
      missing: ['Totals checked', 'Units confirmed'],
    })
    expect((await history('v1')).at(-1)).toMatchObject({
      kind: 'forced',
      reason: 'Client deadline',
      movedBy: 'adm',
    })
  })

  it('examples 13 and 14: reopens a finished item only with a reason, by a team member', async () => {
    expect((await patch('p1', 'mem', { statusId: 'client_review' })).json().error).toBe(
      'reason_required',
    )
    const outsider = await patch('p1', 'out', { statusId: 'client_review', reason: 'x' })
    expect(outsider.statusCode).toBe(403)
    const viewer = await patch('p1', 'vie', { statusId: 'client_review', reason: 'x' })
    expect(viewer.statusCode).toBe(403)
    const reopened = await patch('p1', 'mem', {
      statusId: 'client_review',
      reason: 'Source corrected',
    })
    expect(reopened.statusCode).toBe(200)
    expect((await history('p1')).at(-1)).toMatchObject({
      kind: 'reopen',
      reason: 'Source corrected',
    })
  })

  it('rejects writing priority through fields', async () => {
    expect((await patch('a1', 'mem', { fields: { priority: 9 } })).statusCode).toBe(400)
  })
})
