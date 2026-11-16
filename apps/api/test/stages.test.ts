import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../src/app.js'
import { createPgliteDb, type Db } from '../src/db/db.js'
import { migrate } from '../src/db/migrations.js'
import { insertItem } from '../src/db/seed.js'

let db: Db
let app: FastifyInstance
const as = (user: string) => ({ 'x-dev-user': user })
const patch = (id: string, user: string, payload: object) =>
  app.inject({ method: 'PATCH', url: `/items/${id}`, headers: as(user), payload })
const history = async (id: string, user: string) =>
  (await app.inject({ method: 'GET', url: `/items/${id}/stages`, headers: as(user) })).json()
    .history as { stageKey: string; ownerId: string | null; leftAt: string | null }[]

beforeAll(async () => {
  db = await createPgliteDb()
  await migrate(db)
  await db.exec(`
    INSERT INTO users (id, name, org_role) VALUES
      ('ana', 'Ana', 'member'), ('ben', 'Ben', 'member'), ('eve', 'Eve', 'member');
    INSERT INTO teams (id, key, name, is_private, hand_off_clears_owner) VALUES
      ('PIPE', 'PIPE', 'Pipeline', false, true), ('SOFT', 'SOFT', 'Software', false, false),
      ('PRIV', 'PRIV', 'Private', true, false);
    DELETE FROM stages WHERE team_id = 'PIPE';
    INSERT INTO stages (team_id, key, name, category, position) VALUES
      ('PIPE', 'analysis', 'Analysis', 'todo', 1), ('PIPE', 'validation', 'Validation', 'in_progress', 2),
      ('PIPE', 'published', 'Published', 'done', 3);
    INSERT INTO team_members (team_id, user_id, role) VALUES
      ('PIPE', 'ana', 'member'), ('PIPE', 'ben', 'member'), ('SOFT', 'ana', 'member');
  `)
  const base = { kind: 'task', fields: {}, createdBy: 'ana' }
  await insertItem(db, {
    ...base,
    id: 'p1',
    key: 'PIPE-1',
    title: 'Dataset',
    teamId: 'PIPE',
    statusId: 'analysis',
    statusCategory: 'todo',
    assigneeId: 'ana',
  })
  await insertItem(db, {
    ...base,
    id: 's1',
    key: 'SOFT-1',
    title: 'Bug',
    teamId: 'SOFT',
    statusId: 'todo',
    statusCategory: 'todo',
    assigneeId: 'ana',
  })
  app = buildApp({ db, devAuth: true })
})

afterAll(async () => {
  await app.close()
  await db.close()
})

describe('stages', () => {
  it('gives every new team the default stages', async () => {
    const rows = await db.query<{ key: string }>(
      "SELECT key FROM stages WHERE team_id = 'SOFT' ORDER BY position",
    )
    expect(rows.map((r) => r.key)).toEqual([
      'backlog',
      'todo',
      'in_progress',
      'in_review',
      'done',
      'cancelled',
    ])
  })

  it('lists visible teams with their stages in order, and hides private teams', async () => {
    const res = await app.inject({ method: 'GET', url: '/teams', headers: as('eve') })
    const teams = res.json().teams as {
      id: string
      handOffClearsOwner: boolean
      stages: { key: string }[]
    }[]
    expect(teams.map((t) => t.id)).toEqual(['PIPE', 'SOFT'])
    expect(teams[0]?.stages.map((s) => s.key)).toEqual(['analysis', 'validation', 'published'])
    expect(teams[0]?.handOffClearsOwner).toBe(true)
    expect((await app.inject({ method: 'GET', url: '/teams' })).statusCode).toBe(401)
  })

  it('only accepts stages that belong to the item team', async () => {
    expect((await patch('p1', 'ana', { statusId: 'in_review' })).statusCode).toBe(400)
    expect((await patch('s1', 'ana', { statusId: 'validation' })).statusCode).toBe(400)
  })

  it('clears the owner on a hand-over in a pipeline team and records each stage owner', async () => {
    const moved = await patch('p1', 'ana', { statusId: 'validation' })
    expect(moved.json().item).toMatchObject({
      statusId: 'validation',
      statusCategory: 'in_progress',
      assigneeId: null,
    })
    await patch('p1', 'ben', { assigneeId: 'ben' })
    const done = await patch('p1', 'ben', { statusId: 'published', assigneeId: 'ben' })
    expect(done.json().item).toMatchObject({ statusCategory: 'done', assigneeId: 'ben' })
    const entries = await history('p1', 'eve')
    expect(entries.map((e) => [e.stageKey, e.ownerId])).toEqual([
      ['analysis', 'ana'],
      ['validation', 'ben'],
      ['published', 'ben'],
    ])
    expect(entries.map((e) => e.leftAt === null)).toEqual([false, false, true])
  })

  it('keeps the owner when a software team moves an item', async () => {
    const moved = await patch('s1', 'ana', { statusId: 'in_progress' })
    expect(moved.json().item).toMatchObject({ statusId: 'in_progress', assigneeId: 'ana' })
  })

  it('does not add history when the stage is unchanged', async () => {
    await patch('s1', 'ana', { statusId: 'in_progress' })
    expect(await history('s1', 'ana')).toHaveLength(2)
  })

  it('hides stage history of items the caller cannot see', async () => {
    await insertItem(db, {
      id: 'x1',
      key: 'PRIV-1',
      kind: 'task',
      title: 'Secret',
      teamId: 'PRIV',
      statusId: 'todo',
      statusCategory: 'todo',
      assigneeId: null,
      createdBy: null,
      fields: {},
    })
    const res = await app.inject({ method: 'GET', url: '/items/x1/stages', headers: as('ana') })
    expect(res.statusCode).toBe(404)
  })
})
