/* eslint-disable @typescript-eslint/no-explicit-any -- the tests read untyped JSON replies */
// Phase 4: calendar, workload, dashboard, intake forms with triage, and live updates.
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
    INSERT INTO users (id, name, org_role) VALUES ('ana', 'Ana', 'member'), ('ben', 'Ben', 'member'), ('req', 'Requester', 'member');
    INSERT INTO teams (id, key, name, is_private) VALUES ('DATA', 'DATA', 'Data', false), ('SEC', 'SEC', 'Secret', true);
    INSERT INTO team_members (team_id, user_id, role) VALUES ('DATA', 'ana', 'admin'), ('DATA', 'ben', 'member'), ('SEC', 'ben', 'member');
  `)
  app = buildApp({ db, devAuth: true })
  await app.ready()
})

afterAll(async () => {
  await app.close()
})

async function call(
  user: string,
  method: 'GET' | 'POST' | 'PATCH' | 'PUT',
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

const today = new Date().toISOString().slice(0, 10)

describe('calendar, workload and dashboard', () => {
  it('shows items on their due dates and leaves private teams out', async () => {
    const item = (await call('ana', 'POST', '/core/items', { teamId: 'DATA', title: 'Due today' }))
      .body.item
    await call('ana', 'PATCH', `/core/items/${item.id}/plan`, { dueOn: today, estimate: 6 })
    await call('ana', 'PATCH', `/items/${item.id}`, { assigneeId: 'ben' })
    await db.exec(
      `INSERT INTO work_items (id, key, kind, title, status_id, status_category, team_id, due_on) VALUES ('s1', 'SEC-1', 'task', 'Secret', 'backlog', 'todo', 'SEC', current_date)`,
    )
    const cal = (await call('ana', 'GET', `/core/calendar?from=${today}&to=${today}`)).body
    expect(cal.items.map((i: any) => i.key)).toEqual([item.key])
    expect(
      (await call('ben', 'GET', `/core/calendar?from=${today}&to=${today}`)).body.items,
    ).toHaveLength(2)
  })

  it('adds up open estimates per person per week against capacity', async () => {
    const wl = (await call('ana', 'GET', '/core/workload?teamId=DATA&weeks=2')).body
    expect(wl.weekStarts).toHaveLength(2)
    const ben = wl.people.find((p: any) => p.id === 'ben')
    expect(ben.capacity).toBe(30)
    expect(ben.weeks[0]).toEqual({ load: 6, items: 1 })
  })

  it('counts open work per person and per stage type', async () => {
    const dash = (await call('ana', 'GET', '/core/dashboard?teamId=DATA')).body
    expect(dash.tiles.open).toBeGreaterThan(0)
    expect(dash.people.find((p: any) => p.id === 'ben')).toMatchObject({ waiting: 1 })
  })
})

describe('intake forms and triage (data model rules 28 and 29)', () => {
  let formId = ''
  it('lets only team admins create forms', async () => {
    const body = {
      name: 'Data pull',
      questions: [
        { label: 'Which dataset?', type: 'short_text', required: true },
        { label: 'Needed by', type: 'date' },
      ],
      startStage: 'backlog',
    }
    expect((await call('ben', 'POST', '/core/teams/DATA/forms', body)).status).toBe(403)
    const res = await call('ana', 'POST', '/core/teams/DATA/forms', body)
    expect(res.status).toBe(201)
    formId = res.body.id
  })

  it('takes a request from anyone, checks required answers, and tells the team admins', async () => {
    expect(
      (
        await call('req', 'POST', `/core/forms/${formId}/requests`, {
          title: 'School data',
          answers: {},
        })
      ).body.error,
    ).toBe('required_missing')
    const sent = await call('req', 'POST', `/core/forms/${formId}/requests`, {
      title: 'School data',
      answers: { q1: 'Enrolment by block', q2: '2026-12-10' },
    })
    expect(sent.status).toBe(201)
    const inbox = (await call('ana', 'GET', '/inbox')).body.entries
    expect(inbox.find((e: any) => e.kind === 'request_new')).toMatchObject({
      itemTitle: 'School data',
      requestId: sent.body.id,
    })
    const triage = (await call('ben', 'GET', '/core/teams/DATA/requests')).body.requests
    expect(triage[0]).toMatchObject({ title: 'School data', status: 'new' })
    expect(triage[0].answers).toEqual([
      { label: 'Which dataset?', value: 'Enrolment by block' },
      { label: 'Needed by', value: '2026-12-10' },
    ])
    expect((await call('req', 'GET', '/core/teams/DATA/requests')).status).toBe(403)
  })

  it('turns an accepted request into an item and tells the requester', async () => {
    const id = (await call('ben', 'GET', '/core/teams/DATA/requests')).body.requests[0].id
    const accepted = await call('ben', 'POST', `/core/requests/${id}/accept`, {})
    expect(accepted.body.itemKey).toMatch(/^DATA-\d+$/)
    const item = (await call('ben', 'GET', `/core/items/${accepted.body.itemKey}`)).body.item
    expect(item).toMatchObject({ title: 'School data', stageKey: 'backlog' })
    const mine = (await call('req', 'GET', '/core/me/requests')).body.requests
    expect(mine[0]).toMatchObject({ status: 'accepted', itemKey: accepted.body.itemKey })
    expect(
      (await call('ben', 'POST', `/core/requests/${id}/decline`, { note: 'too late' })).status,
    ).toBe(409)
    const inbox = (await call('req', 'GET', '/inbox')).body.entries
    expect(inbox[0].kind).toBe('request_update')
  })

  it('asks for more information with a note', async () => {
    const sent = await call('req', 'POST', `/core/forms/${formId}/requests`, {
      title: 'Vague',
      answers: { q1: 'Something' },
    })
    expect(
      (await call('ana', 'POST', `/core/requests/${sent.body.id}/ask`, { note: 'Which years?' }))
        .body.status,
    ).toBe('needs_info')
    expect((await call('req', 'GET', '/core/me/requests')).body.requests[0]).toMatchObject({
      status: 'needs_info',
      note: 'Which years?',
    })
  })
})

describe('live updates', () => {
  it('tells open pages that something changed, without any item data', async () => {
    const ws = await (app as any).injectWS('/live?user=ana')
    const messages: string[] = []
    ws.on('message', (m: Buffer) => messages.push(m.toString()))
    await new Promise((r) => setTimeout(r, 100))
    await call('ana', 'POST', '/core/items', { teamId: 'DATA', title: 'Triggers a refresh' })
    await new Promise((r) => setTimeout(r, 400))
    ws.terminate()
    const changed = messages.map((m) => JSON.parse(m)).filter((m) => m.type === 'changed')
    expect(changed.length).toBeGreaterThanOrEqual(1)
    for (const m of changed) expect(Object.keys(m).sort()).toEqual(['at', 'type'])
  })

  it('refuses a live connection without a signed-in person', async () => {
    const ws = await (app as any).injectWS('/live')
    const code = await new Promise<number>((resolve) => ws.on('close', (c: number) => resolve(c)))
    expect(code).toBe(4401)
  })
})
