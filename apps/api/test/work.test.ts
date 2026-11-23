/* eslint-disable @typescript-eslint/no-explicit-any -- the tests read untyped JSON replies */
// Phase 3: recurring runs (data model tests 6 and 7), descriptions, attachments and search.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../src/app.js'
import { createPgliteDb, type Db } from '../src/db/db.js'
import { migrate } from '../src/db/migrations.js'
import { memoryFileStore } from '../src/files.js'
import { runDueSchedules } from '../src/runs.js'

let db: Db
let app: FastifyInstance

beforeAll(async () => {
  db = await createPgliteDb()
  await migrate(db)
  await db.exec(`
    INSERT INTO users (id, name, org_role) VALUES ('ana', 'Ana', 'member'), ('ben', 'Ben', 'member'), ('out', 'Out', 'member');
    INSERT INTO teams (id, key, name, is_private) VALUES ('DATA', 'DATA', 'Data', false), ('SEC', 'SEC', 'Secret', true);
    INSERT INTO team_members (team_id, user_id, role) VALUES ('DATA', 'ana', 'admin'), ('DATA', 'ben', 'member'), ('SEC', 'ben', 'member');
  `)
  app = buildApp({ db, devAuth: true, files: memoryFileStore() })
  await app.ready()
})

afterAll(async () => {
  await app.close()
})

async function call(
  user: string,
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  url: string,
  payload?: unknown,
) {
  const res = await app.inject({
    method,
    url,
    headers: { 'x-dev-user': user },
    ...(payload ? { payload: payload as object } : {}),
  })
  return { status: res.statusCode, body: res.json() as Record<string, any> }
}

const newItem = async (title: string) =>
  (await call('ana', 'POST', '/core/items', { teamId: 'DATA', title })).body.item

describe('recurring runs', () => {
  it('starts a run by hand, keeps passes and comments per run, and ends it at Done (test 7)', async () => {
    const item = await newItem('Pull monthly GST collections')
    const set = await call('ana', 'PUT', `/core/items/${item.id}/schedule`, {
      rule: { kind: 'monthly', day: 'first_working' },
      startStage: 'in_progress',
      ownerId: 'ben',
    })
    expect(set.body.schedule.text).toBe('Every month on the first working day at 09:00')

    expect((await call('ana', 'POST', `/core/items/${item.id}/runs`, {})).body.number).toBe(1)
    await call('ben', 'POST', `/items/${item.id}/comments`, { body: 'Run one note' })
    await call('ben', 'PATCH', `/items/${item.id}`, { statusId: 'done' })
    expect((await call('ana', 'POST', `/core/items/${item.id}/runs`, {})).body.number).toBe(2)
    await call('ben', 'POST', `/items/${item.id}/comments`, { body: 'Run two note' })
    await call('ben', 'POST', `/items/${item.id}/comments`, { body: 'Another' })

    const { body } = await call('ana', 'GET', `/core/items/${item.id}/runs`)
    const [two, one] = body.runs
    expect(one).toMatchObject({ number: 1, startedBy: 'manual', outcome: 'completed', comments: 1 })
    expect(one.endedAt).not.toBeNull()
    expect(one.fieldValues.ownerId).toBe('ben')
    expect(one.passes.map((p: any) => p.stageKey)).toEqual(['in_progress', 'done'])
    expect(two).toMatchObject({ number: 2, endedAt: null, comments: 2 })
  })

  it('does not start a scheduled run while one is open, and tells people (test 6)', async () => {
    const item = await newItem('Weekly export')
    await call('ana', 'PUT', `/core/items/${item.id}/schedule`, {
      rule: { kind: 'daily' },
      startStage: 'in_progress',
      ownerId: 'ben',
    })
    await db.query(
      "UPDATE item_schedules SET next_at = now() - interval '1 minute' WHERE item_id = $1",
      [item.id],
    )
    expect((await runDueSchedules(db)).started).toBeGreaterThanOrEqual(1)

    await db.query(
      "UPDATE item_schedules SET next_at = now() - interval '1 minute' WHERE item_id = $1",
      [item.id],
    )
    const second = await runDueSchedules(db)
    expect(second.blocked).toBe(1)
    const inbox = await db.query<{ user_id: string }>(
      "SELECT user_id FROM inbox WHERE kind = 'run_blocked' AND item_id = $1",
      [item.id],
    )
    expect(inbox.map((r) => r.user_id).sort()).toEqual(['ana', 'ben'])

    // When the open run ends, the waiting run starts on the next check.
    await call('ben', 'PATCH', `/items/${item.id}`, { statusId: 'done' })
    await runDueSchedules(db)
    const runs = (await call('ana', 'GET', `/core/items/${item.id}/runs`)).body.runs
    expect(runs.map((r: any) => r.number)).toEqual([2, 1])
    expect(runs[0].startedBy).toBe('schedule')
  })

  it('refuses a bad schedule', async () => {
    const item = await newItem('Bad schedule')
    expect(
      (
        await call('ana', 'PUT', `/core/items/${item.id}/schedule`, {
          rule: { kind: 'weekly', weekdays: [] },
          startStage: 'todo',
        })
      ).body.error,
    ).toBe('bad_weekdays')
  })
})

describe('attachments', () => {
  it('stores allowed files and always downloads them', async () => {
    const item = await newItem('With a file')
    const up = await app.inject({
      method: 'POST',
      url: `/core/items/${item.id}/attachments?name=${encodeURIComponent('rows.csv')}&type=text/csv`,
      headers: { 'x-dev-user': 'ana', 'content-type': 'application/octet-stream' },
      payload: Buffer.from('state,total\nKA,10\n'),
    })
    expect(up.statusCode).toBe(201)
    const down = await app.inject({
      method: 'GET',
      url: `/core/attachments/${up.json().id}/content`,
      headers: { 'x-dev-user': 'ben' },
    })
    expect(down.body).toContain('KA,10')
    expect(down.headers['content-disposition']).toContain('attachment')
    expect((await call('out', 'DELETE', `/core/attachments/${up.json().id}`)).status).toBe(403)
  })

  it('refuses file types that are not allowed', async () => {
    const item = await newItem('No scripts')
    const up = await app.inject({
      method: 'POST',
      url: `/core/items/${item.id}/attachments?name=x.html&type=text/html`,
      headers: { 'x-dev-user': 'ana', 'content-type': 'application/octet-stream' },
      payload: Buffer.from('<script>alert(1)</script>'),
    })
    expect(up.json().error).toBe('file_type_not_allowed')
  })
})

describe('search', () => {
  it('finds titles, descriptions and comments in teams you can see, and nothing private', async () => {
    const item = await newItem('Rainfall series cleanup')
    await call('ana', 'PUT', `/core/items/${item.id}/description`, {
      description: 'District codes need checking',
    })
    await call('ana', 'POST', `/items/${item.id}/comments`, { body: 'Monsoon months look odd' })
    await db.exec(
      `INSERT INTO work_items (id, key, kind, title, status_id, status_category, team_id) VALUES ('s1', 'SEC-1', 'task', 'Rainfall secret', 'backlog', 'todo', 'SEC')`,
    )

    const titles = async (user: string, q: string) =>
      (await call(user, 'GET', `/core/search?q=${encodeURIComponent(q)}`)).body.results.map(
        (r: any) => r.key,
      )
    expect(await titles('ana', 'rainf')).toEqual([item.key])
    expect(await titles('ben', 'rainfall')).toEqual(expect.arrayContaining([item.key, 'SEC-1']))
    expect(await titles('ana', 'district codes')).toEqual([item.key])
    expect(await titles('ana', 'monsoon')).toEqual([item.key])
  })
})
