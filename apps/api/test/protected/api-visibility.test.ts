/**
 * PROTECTED TEST. Checks that the API surface enforces specs/permission-matrix.md:
 * hidden items never appear in lists, look like missing items when fetched, and
 * changes are refused outside the caller's own teams.
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
const base = {
  kind: 'task',
  statusId: 'todo',
  statusCategory: 'todo',
  assigneeId: null,
  fields: {},
}

beforeAll(async () => {
  db = await createPgliteDb()
  await migrate(db)
  await db.exec(`
    INSERT INTO users (id, name, org_role) VALUES
      ('org-admin', 'Org Admin', 'org_admin'),
      ('member-a', 'Member A', 'member'),
      ('member-b', 'Member B', 'member'),
      ('member-p', 'Member P', 'member'),
      ('viewer', 'Viewer', 'viewer');
    INSERT INTO teams (id, key, name, is_private) VALUES
      ('A', 'A', 'Team A', false), ('B', 'B', 'Team B', false), ('P', 'P', 'Private', true);
    INSERT INTO team_members (team_id, user_id, role) VALUES
      ('A', 'member-a', 'member'), ('B', 'member-b', 'member'), ('P', 'member-p', 'member');
  `)
  await insertItem(db, {
    ...base,
    id: 'a1',
    key: 'A-1',
    title: 'Open A',
    teamId: 'A',
    createdBy: 'member-a',
  })
  await insertItem(db, {
    ...base,
    id: 'b1',
    key: 'B-1',
    title: 'Open B',
    teamId: 'B',
    createdBy: 'member-b',
  })
  await insertItem(db, {
    ...base,
    id: 'p1',
    key: 'P-1',
    title: 'Secret P',
    teamId: 'P',
    createdBy: 'member-p',
  })
  app = buildApp({ db, devAuth: true })
})

afterAll(async () => {
  await app.close()
  await db.close()
})

const listKeys = async (user: string, query = '') => {
  const res = await app.inject({ method: 'GET', url: `/items${query}`, headers: as(user) })
  expect(res.statusCode).toBe(200)
  return (res.json().items as { key: string }[]).map((item) => item.key).sort()
}

describe('API visibility (permission matrix on the API surface)', () => {
  it('refuses callers who are not signed in', async () => {
    expect((await app.inject({ method: 'GET', url: '/items' })).statusCode).toBe(401)
    expect((await app.inject({ method: 'GET', url: '/items/a1' })).statusCode).toBe(401)
    const unknown = await app.inject({ method: 'GET', url: '/items', headers: as('nobody') })
    expect(unknown.statusCode).toBe(401)
  })

  it('has no item routes at all when dev sign-in is off', async () => {
    const strict = buildApp({ db, devAuth: false })
    const res = await strict.inject({ method: 'GET', url: '/items', headers: as('org-admin') })
    expect(res.statusCode).toBe(401)
    await strict.close()
  })

  it('lists open teams to everyone internal, private teams only to their members', async () => {
    expect(await listKeys('member-a')).toEqual(['A-1', 'B-1'])
    expect(await listKeys('viewer')).toEqual(['A-1', 'B-1'])
    expect(await listKeys('member-p')).toEqual(['A-1', 'B-1', 'P-1'])
    expect(await listKeys('org-admin')).toEqual(['A-1', 'B-1', 'P-1'])
  })

  it('does not leak private items through filters or search', async () => {
    expect(await listKeys('member-a', '?team=P')).toEqual([])
    expect(await listKeys('member-a', '?q=Secret')).toEqual([])
    expect(await listKeys('member-a', '?q=P-1')).toEqual([])
  })

  it('makes a hidden item look exactly like a missing one', async () => {
    const hidden = await app.inject({ method: 'GET', url: '/items/p1', headers: as('member-a') })
    const missing = await app.inject({ method: 'GET', url: '/items/nope', headers: as('member-a') })
    expect(hidden.statusCode).toBe(404)
    expect(hidden.json()).toEqual(missing.json())
    const patch = await app.inject({
      method: 'PATCH',
      url: '/items/p1',
      headers: as('member-a'),
      payload: { statusId: 'done' },
    })
    expect(patch.statusCode).toBe(404)
  })

  it('lets members change items only in their own teams', async () => {
    const own = await app.inject({
      method: 'PATCH',
      url: '/items/a1',
      headers: as('member-a'),
      payload: { statusId: 'in_progress', assigneeId: 'member-a' },
    })
    expect(own.statusCode).toBe(200)
    expect(own.json().item).toMatchObject({
      statusId: 'in_progress',
      statusCategory: 'in_progress',
      assigneeId: 'member-a',
    })
    const other = await app.inject({
      method: 'PATCH',
      url: '/items/b1',
      headers: as('member-a'),
      payload: { statusId: 'done' },
    })
    expect(other.statusCode).toBe(403)
    const viewer = await app.inject({
      method: 'PATCH',
      url: '/items/a1',
      headers: as('viewer'),
      payload: { title: 'Changed' },
    })
    expect(viewer.statusCode).toBe(403)
    const check = await app.inject({ method: 'GET', url: '/items/b1', headers: as('member-b') })
    expect(check.json().item.statusId).toBe('todo')
  })

  it('rejects unknown statuses, assignees and fields', async () => {
    const patch = (payload: object) =>
      app.inject({ method: 'PATCH', url: '/items/a1', headers: as('member-a'), payload })
    expect((await patch({ statusId: 'made-up' })).statusCode).toBe(400)
    expect((await patch({ assigneeId: 'nobody' })).statusCode).toBe(400)
    expect((await patch({ teamId: 'P' })).statusCode).toBe(400)
    expect((await patch({})).statusCode).toBe(400)
  })

  it('audits an org admin reading a private team (decision 9)', async () => {
    await db.exec('DELETE FROM audit_log')
    await app.inject({ method: 'GET', url: '/items/p1', headers: as('org-admin') })
    await app.inject({ method: 'GET', url: '/items/a1', headers: as('org-admin') })
    await app.inject({ method: 'GET', url: '/items/p1', headers: as('member-p') })
    const rows = await db.query<{ actor_id: string; action: string; object_id: string }>(
      'SELECT actor_id, action, object_id FROM audit_log',
    )
    expect(rows).toEqual([{ actor_id: 'org-admin', action: 'item.view', object_id: 'p1' }])
  })

  it('requires sign-in for /me and /users and reports the caller', async () => {
    expect((await app.inject({ method: 'GET', url: '/me' })).statusCode).toBe(401)
    expect((await app.inject({ method: 'GET', url: '/users' })).statusCode).toBe(401)
    const me = await app.inject({ method: 'GET', url: '/me', headers: as('member-a') })
    expect(me.json()).toEqual({
      id: 'member-a',
      name: 'Member A',
      orgRole: 'member',
      teams: { A: 'member' },
    })
    const users = await app.inject({ method: 'GET', url: '/users', headers: as('viewer') })
    expect(users.json().users).toHaveLength(5)
  })

  it('changes priority only for members of the team', async () => {
    const own = await app.inject({
      method: 'PATCH',
      url: '/items/a1',
      headers: as('member-a'),
      payload: { priority: 3 },
    })
    expect(own.json().item.fields).toEqual({ priority: 3 })
    const other = await app.inject({
      method: 'PATCH',
      url: '/items/a1',
      headers: as('member-b'),
      payload: { priority: 1 },
    })
    expect(other.statusCode).toBe(403)
    const bad = await app.inject({
      method: 'PATCH',
      url: '/items/a1',
      headers: as('member-a'),
      payload: { priority: 9 },
    })
    expect(bad.statusCode).toBe(400)
  })

  it('pages through results without skipping or repeating', async () => {
    const first = await app.inject({
      method: 'GET',
      url: '/items?limit=1',
      headers: as('member-a'),
    })
    const { items, nextAfter } = first.json()
    expect(items).toHaveLength(1)
    expect(nextAfter).not.toBeNull()
    const second = await app.inject({
      method: 'GET',
      url: `/items?limit=1&after=${nextAfter}`,
      headers: as('member-a'),
    })
    expect(second.json().items[0].key).not.toBe(items[0].key)
  })
})
