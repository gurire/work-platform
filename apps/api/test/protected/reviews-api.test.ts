/**
 * PROTECTED TEST. Checks that the API enforces specs/reviews.md (merged 17 Nov 2026): opening
 * rounds, verdicts, send-back, approval as a requirement, withdrawing and review stage setup.
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
const reviews = async (id: string, user = 'mem') =>
  (await app.inject({ method: 'GET', url: `/items/${id}/reviews`, headers: as(user) })).json()
const open = (id: string, user: string, reviewers: string[]) =>
  app.inject({
    method: 'POST',
    url: `/items/${id}/reviews`,
    headers: as(user),
    payload: { reviewers },
  })
const verdict = (roundId: string, user: string, payload: object) =>
  app.inject({ method: 'POST', url: `/reviews/${roundId}/verdict`, headers: as(user), payload })
const withdraw = (roundId: string, user: string) =>
  app.inject({ method: 'POST', url: `/reviews/${roundId}/withdraw`, headers: as(user) })
const patch = (id: string, user: string, payload: object) =>
  app.inject({ method: 'PATCH', url: `/items/${id}`, headers: as(user), payload })
const workflow = async (id: string) =>
  (await app.inject({ method: 'GET', url: `/items/${id}/workflow`, headers: as('mem') })).json()
const history = async (id: string) =>
  (await app.inject({ method: 'GET', url: `/items/${id}/stages`, headers: as('mem') })).json()
    .history
const openRoundId = async (id: string): Promise<string> => {
  const body = await reviews(id)
  const round = body.rounds.find((r: { state: string }) => r.state === 'open')
  return round.id
}

beforeAll(async () => {
  db = await createPgliteDb()
  await migrate(db)
  await db.exec(`
    INSERT INTO users (id, name, org_role) VALUES
      ('adm', 'Team admin', 'member'), ('mem', 'Member', 'member'), ('own', 'Owner', 'member'),
      ('rev1', 'Reviewer one', 'member'), ('rev2', 'Reviewer two', 'member'),
      ('out', 'Other team member', 'member'), ('vie', 'Viewer', 'viewer');
    INSERT INTO teams (id, key, name, is_private) VALUES
      ('T', 'T', 'Pipeline', false), ('O', 'O', 'Other', false), ('P', 'P', 'Private', true);
    -- New teams get default stages; this test sets its own.
    DELETE FROM stages WHERE team_id IN ('T', 'P');
    INSERT INTO stages (team_id, key, name, category, position, review_send_back_to) VALUES
      ('T', 'intake', 'Intake', 'todo', 1, NULL),
      ('T', 'processing', 'Processing', 'in_progress', 2, NULL),
      ('T', 'validation', 'Validation', 'in_progress', 3, 'processing'),
      ('T', 'published', 'Published', 'done', 4, NULL),
      ('T', 'dropped', 'Dropped', 'cancelled', 5, NULL),
      ('P', 'validation', 'Validation', 'in_progress', 1, NULL),
      ('P', 'review', 'Review', 'in_progress', 2, 'validation');
    INSERT INTO team_members (team_id, user_id, role) VALUES
      ('T', 'adm', 'admin'), ('T', 'mem', 'member'), ('T', 'own', 'member'),
      ('T', 'rev1', 'reviewer'), ('T', 'rev2', 'reviewer'), ('O', 'out', 'member'),
      ('P', 'adm', 'admin');
  `)
  const at = (id: string, statusId: string, teamId = 'T') =>
    insertItem(db, {
      id,
      key: id.toUpperCase(),
      kind: 'deliverable',
      title: id,
      statusId,
      statusCategory: 'in_progress',
      teamId,
      assigneeId: 'own',
      createdBy: 'mem',
      fields: {},
    })
  for (const id of ['r1', 'r2', 'r3', 'r4', 'r5']) await at(id, 'validation')
  await at('n1', 'processing')
  await at('hidden', 'review', 'P')
  app = buildApp({ db, devAuth: true })
})

afterAll(async () => {
  await app.close()
  await db.close()
})

describe('review rounds on the API surface', () => {
  it('only review stages take rounds, and only admins and members open them', async () => {
    expect((await open('n1', 'mem', ['rev1'])).json().error).toBe('not_review_stage')
    expect((await open('r1', 'rev1', ['rev2'])).statusCode).toBe(403)
    expect((await open('r1', 'vie', ['rev1'])).statusCode).toBe(403)
    expect((await open('r1', 'out', ['rev1'])).statusCode).toBe(403)
    const state = await workflow('r1')
    expect(state.review).toEqual({ sendBackTo: 'processing', approved: false })
    expect(state.missing).toEqual(['Review approved'])
  })

  it('example 5 and default 1: no reviewing your own work; reviewers must be allowed', async () => {
    expect((await open('r1', 'mem', ['mem', 'rev1'])).json()).toEqual({
      error: 'self_review',
      who: 'mem',
    })
    expect((await open('r1', 'mem', ['own'])).json()).toEqual({ error: 'self_review', who: 'own' })
    expect((await open('r1', 'mem', ['out'])).json()).toEqual({
      error: 'not_a_reviewer',
      who: 'out',
    })
    expect((await open('r1', 'mem', ['vie'])).json().error).toBe('not_a_reviewer')
    expect((await open('r1', 'mem', ['nobody'])).json().error).toBe('not_a_reviewer')
  })

  it('examples 1 and 2: all reviewers must approve; approval is a requirement, not a move', async () => {
    const res = await open('r1', 'mem', ['rev1', 'rev2'])
    expect(res.statusCode).toBe(200)
    expect(res.json().rounds[0]).toMatchObject({ number: 1, state: 'open', requestedBy: 'mem' })
    expect((await open('r1', 'mem', ['adm'])).json().error).toBe('round_open')

    const round = await openRoundId('r1')
    expect((await verdict(round, 'rev1', { verdict: 'approved' })).statusCode).toBe(200)
    expect((await workflow('r1')).missing).toEqual(['Review approved'])
    const refused = await patch('r1', 'mem', { statusId: 'published' })
    expect(refused.statusCode).toBe(409)
    expect(refused.json()).toEqual({ error: 'requirements_unmet', missing: ['Review approved'] })

    const done = await verdict(round, 'rev2', { verdict: 'approved', comment: 'Looks right' })
    expect(done.json().rounds[0].state).toBe('approved')
    expect((await workflow('r1')).stageKey).toBe('validation') // approval does not move it
    expect((await workflow('r1')).missing).toEqual([])
    expect((await patch('r1', 'mem', { statusId: 'published' })).statusCode).toBe(200)
  })

  it('example 3: any "changes requested" ends the round and sends the item back', async () => {
    expect((await open('r2', 'mem', ['rev1', 'rev2'])).statusCode).toBe(200)
    const round = await openRoundId('r2')
    await verdict(round, 'rev1', { verdict: 'approved' })
    expect((await verdict(round, 'rev2', { verdict: 'changes_requested' })).json().error).toBe(
      'comment_required',
    )
    const res = await verdict(round, 'rev2', {
      verdict: 'changes_requested',
      comment: 'Row counts do not match the source',
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().rounds[0].state).toBe('changes_requested')
    expect((await workflow('r2')).stageKey).toBe('processing')
    const last = (await history('r2')).at(-1)
    expect(last).toMatchObject({
      stageKey: 'processing',
      kind: 'sent_back',
      movedBy: 'rev2',
      reason: 'Row counts do not match the source',
    })
    // Verdicts are final once the round has closed (default 2).
    expect((await verdict(round, 'rev1', { verdict: 'approved' })).json().error).toBe(
      'round_closed',
    )
  })

  it('example 4: coming back to the review stage needs a new round', async () => {
    expect((await patch('r2', 'mem', { statusId: 'validation' })).statusCode).toBe(200)
    expect((await workflow('r2')).missing).toEqual(['Review approved'])
    const res = await open('r2', 'mem', ['rev1'])
    expect(res.json().rounds.map((r: { number: number }) => r.number)).toEqual([2, 1])
  })

  it('only reviewers in the round give verdicts; a reviewer may change theirs while open', async () => {
    expect((await open('r3', 'mem', ['rev1', 'rev2'])).statusCode).toBe(200)
    const round = await openRoundId('r3')
    expect((await verdict(round, 'adm', { verdict: 'approved' })).json().error).toBe('not_reviewer')
    expect((await verdict(round, 'mem', { verdict: 'approved' })).statusCode).toBe(403)
    await verdict(round, 'rev1', { verdict: 'approved' })
    const changed = await verdict(round, 'rev1', {
      verdict: 'changes_requested',
      comment: 'Spotted a gap after all',
    })
    expect(changed.json().rounds[0].state).toBe('changes_requested')
    expect((await workflow('r3')).stageKey).toBe('processing')
  })

  it('example 6: leaving the stage another way withdraws the open round', async () => {
    expect((await open('r4', 'mem', ['rev1'])).statusCode).toBe(200)
    const forced = await patch('r4', 'adm', {
      statusId: 'published',
      force: true,
      reason: 'Client signed off by email',
    })
    expect(forced.statusCode).toBe(200)
    expect((await reviews('r4')).rounds[0].state).toBe('withdrawn')
  })

  it('rule 9: the requester or a team admin may withdraw', async () => {
    expect((await open('r5', 'mem', ['rev1'])).statusCode).toBe(200)
    const round = await openRoundId('r5')
    expect((await withdraw(round, 'rev1')).statusCode).toBe(403)
    expect((await withdraw(round, 'own')).statusCode).toBe(403)
    expect((await withdraw(round, 'out')).statusCode).toBe(403)
    expect((await withdraw(round, 'mem')).json().rounds[0].state).toBe('withdrawn')
    expect((await withdraw(round, 'mem')).json().error).toBe('round_closed')
    expect((await open('r5', 'mem', ['rev2'])).statusCode).toBe(200)
    expect((await withdraw(await openRoundId('r5'), 'adm')).statusCode).toBe(200)
  })

  it('hidden items look missing', async () => {
    expect(
      (await app.inject({ method: 'GET', url: '/items/hidden/reviews', headers: as('mem') }))
        .statusCode,
    ).toBe(404)
    expect((await open('hidden', 'mem', ['rev1'])).statusCode).toBe(404)
  })

  it('team admins set up review stages; the send-back stage must be earlier and not an end', async () => {
    const put = (user: string, stage: string, sendBackTo: string | null) =>
      app.inject({
        method: 'PUT',
        url: `/teams/T/stages/${stage}/review`,
        headers: as(user),
        payload: { sendBackTo },
      })
    expect((await put('mem', 'processing', 'intake')).statusCode).toBe(403)
    expect((await put('rev1', 'processing', 'intake')).statusCode).toBe(403)
    expect((await put('adm', 'processing', 'validation')).json().error).toBe('send_back_invalid')
    expect((await put('adm', 'published', 'processing')).json().error).toBe('send_back_invalid')
    expect((await put('adm', 'processing', 'intake')).statusCode).toBe(200)
    expect((await workflow('n1')).missing).toEqual(['Review approved'])
    expect((await put('adm', 'processing', null)).statusCode).toBe(200)
    expect((await workflow('n1')).missing).toEqual([])
  })
})
