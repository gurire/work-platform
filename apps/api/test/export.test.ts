import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../src/app.js'
import { createPgliteDb, type Db } from '../src/db/db.js'
import { migrate } from '../src/db/migrations.js'

let db: Db
let app: FastifyInstance

beforeAll(async () => {
  db = await createPgliteDb()
  await migrate(db)
  await db.exec(`
    INSERT INTO users (id, name, org_role) VALUES ('boss', 'Boss', 'org_admin'), ('ana', 'Ana', 'member');
    INSERT INTO teams (id, key, name, is_private) VALUES ('DATA', 'DATA', 'Data', false);
    INSERT INTO team_members (team_id, user_id, role) VALUES ('DATA', 'ana', 'admin');
  `)
  app = buildApp({ db, devAuth: true })
  await app.ready()
  await app.inject({
    method: 'POST',
    url: '/core/items',
    headers: { 'x-dev-user': 'ana' },
    payload: { teamId: 'DATA', title: '=HYPERLINK("x"), with a comma' },
  })
})

afterAll(async () => {
  await app.close()
})

describe('full export', () => {
  it('is for org admins only', async () => {
    expect(
      (await app.inject({ method: 'GET', url: '/core/export', headers: { 'x-dev-user': 'ana' } }))
        .statusCode,
    ).toBe(403)
  })

  it('gives every table as JSON', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/core/export',
      headers: { 'x-dev-user': 'boss' },
    })
    const body = res.json() as { tables: Record<string, unknown[]> }
    expect(body.tables['work_items']).toHaveLength(1)
    expect(Object.keys(body.tables)).toContain('requests')
  })

  it('gives items as CSV that spreadsheets cannot run as formulas', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/core/export?format=csv',
      headers: { 'x-dev-user': 'boss' },
    })
    expect(res.headers['content-type']).toContain('text/csv')
    expect(res.body).toContain(`"'=HYPERLINK(""x""), with a comma"`)
  })

  it('reports a healthy database', async () => {
    expect((await app.inject({ method: 'GET', url: '/health' })).json()).toEqual({ status: 'ok' })
  })
})
