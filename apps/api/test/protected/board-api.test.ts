/**
 * PROTECTED TEST. specs/stage-limits.md on the API surface: board figures, setting limits,
 * and that limits never block a move. Human-owned once the spec is merged.
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
const limits = (user: string, stage: string, itemLimit: unknown, targetHours: unknown) =>
  app.inject({
    method: 'PUT',
    url: `/teams/T/stages/${stage}/limits`,
    headers: as(user),
    payload: { itemLimit, targetHours },
  })
const board = async (user: string, team = 'T') =>
  app.inject({ method: 'GET', url: `/teams/${team}/board`, headers: as(user) })

beforeAll(async () => {
  db = await createPgliteDb()
  await migrate(db)
  await db.exec(`
    INSERT INTO users (id, name, org_role) VALUES
      ('adm', 'Admin', 'member'), ('mem', 'Member', 'member'), ('out', 'Outsider', 'member');
    INSERT INTO teams (id, key, name, is_private) VALUES ('T', 'T', 'Team', false),
      ('P', 'P', 'Private', true);
    INSERT INTO team_members (team_id, user_id, role) VALUES ('T', 'adm', 'admin'),
      ('T', 'mem', 'member');
  `)
  for (const [id, status] of [
    ['a', 'todo'],
    ['b', 'in_progress'],
    ['c', 'in_progress'],
  ] as const) {
    await insertItem(db, {
      id,
      key: id.toUpperCase(),
      kind: 'task',
      title: id,
      statusId: status,
      statusCategory: status === 'todo' ? 'todo' : 'in_progress',
      teamId: 'T',
      assigneeId: null,
      createdBy: null,
      fields: {},
    })
  }
  app = buildApp({ db, devAuth: true })
})

afterAll(async () => {
  await app.close()
  await db.close()
})

describe('stage limits on the API surface', () => {
  it('rule 6: team admins set limits; members and outsiders cannot', async () => {
    expect((await limits('mem', 'in_progress', 2, 48)).statusCode).toBe(403)
    expect((await limits('out', 'in_progress', 2, 48)).statusCode).toBe(403)
    const res = await limits('adm', 'in_progress', 2, 48)
    expect(res.statusCode).toBe(200)
    const teams = (await app.inject({ method: 'GET', url: '/teams', headers: as('mem') })).json()
    const team = teams.teams.find((t: { id: string }) => t.id === 'T')
    expect(team.stageLimits).toEqual([{ stageKey: 'in_progress', itemLimit: 2, targetHours: 48 }])
  })

  it('example 3 and rules 1 and 2: no limits on end stages; values must be in range', async () => {
    expect((await limits('adm', 'done', 5, null)).json().error).toBe('end_stage')
    expect((await limits('adm', 'todo', 0, null)).json().error).toBe('invalid_limit')
    expect((await limits('adm', 'todo', 1.5, null)).json().error).toBe('invalid_limit')
    expect((await limits('adm', 'todo', null, 9000)).json().error).toBe('invalid_target')
    expect((await limits('adm', 'nope', 5, null)).statusCode).toBe(404)
  })

  it('board figures count every item per stage and give each item its entry time', async () => {
    const body = (await board('out')).json()
    expect(body.counts).toEqual({ todo: 1, in_progress: 2 })
    expect(Object.keys(body.enteredAt).sort()).toEqual(['a', 'b', 'c'])
    expect((await board('out', 'P')).statusCode).toBe(404)
  })

  it('example 1 and rule 5: a move into a full stage goes ahead', async () => {
    const moved = await app.inject({
      method: 'PATCH',
      url: '/items/a',
      headers: as('mem'),
      payload: { statusId: 'in_progress' },
    })
    expect(moved.statusCode).toBe(200)
    expect((await board('mem')).json().counts.in_progress).toBe(3)
  })

  it('limits can be cleared', async () => {
    expect((await limits('adm', 'in_progress', null, null)).statusCode).toBe(200)
  })
})
