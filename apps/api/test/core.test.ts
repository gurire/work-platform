/* eslint-disable @typescript-eslint/no-explicit-any -- the tests read untyped JSON replies */
// specs/data-model.md section 4: the rules for projects, items, sub-items, milestones, stages
// and fields, checked through the API.
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
    INSERT INTO users (id, name, org_role) VALUES
      ('ana', 'Ana', 'member'), ('ben', 'Ben', 'member'), ('vic', 'Vic', 'viewer'), ('boss', 'Boss', 'org_admin');
    INSERT INTO teams (id, key, name, is_private) VALUES ('DATA', 'DATA', 'Data', false), ('ENG', 'ENG', 'Eng', false);
    INSERT INTO team_members (team_id, user_id, role) VALUES ('DATA', 'ana', 'admin'), ('DATA', 'ben', 'member'), ('ENG', 'ben', 'member');
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

describe('stages and stage types', () => {
  it('gives every default stage a type', async () => {
    const { body } = await call('ana', 'GET', '/core/teams')
    const data = body.teams.find((t: any) => t.id === 'DATA')
    expect(data.stages.map((s: any) => s.type)).toEqual([
      'waiting',
      'waiting',
      'doing',
      'review',
      'done',
      'done',
    ])
    expect(data.stages.at(-1).doneOutcome).toBe('cancelled')
  })

  it('lets only team admins change stages', async () => {
    expect(
      (await call('ben', 'POST', '/core/teams/DATA/stages', { name: 'Ingest', type: 'doing' }))
        .status,
    ).toBe(403)
    expect(
      (await call('ana', 'POST', '/core/teams/DATA/stages', { name: 'Ingest', type: 'doing' }))
        .status,
    ).toBe(201)
  })

  it('refuses changing the type of a stage that holds items (test 5)', async () => {
    const created = await call('ana', 'POST', '/core/items', {
      teamId: 'DATA',
      title: 'Holds the stage',
    })
    expect(created.body.item.stageKey).toBe('backlog')
    const res = await call('ana', 'PATCH', '/core/teams/DATA/stages/backlog', { type: 'doing' })
    expect(res.status).toBe(409)
    expect(res.body.error).toBe('stage_not_empty')
  })

  it('refuses leaving a team without a Done stage', async () => {
    await call('ana', 'POST', '/core/teams/ENG/stages', { name: 'Extra', type: 'doing' })
    const boss = await call('boss', 'PATCH', '/core/teams/ENG/stages/done', { type: 'doing' })
    expect(boss.status).toBe(200) // ENG still has "cancelled" as a Done stage.
    const last = await call('boss', 'PATCH', '/core/teams/ENG/stages/cancelled', { type: 'doing' })
    expect(last.body.error).toBe('stage_types_missing')
  })

  it('saves allowed moves between the team’s own stages only', async () => {
    expect(
      (
        await call('ana', 'PUT', '/core/teams/DATA/transitions', {
          transitions: [{ from: 'backlog', to: 'nowhere' }],
        })
      ).status,
    ).toBe(400)
    const ok = await call('ana', 'PUT', '/core/teams/DATA/transitions', {
      transitions: [{ from: 'backlog', to: 'in_progress' }],
    })
    expect(ok.status).toBe(200)
    const { body } = await call('ana', 'GET', '/core/teams')
    expect(body.teams.find((t: any) => t.id === 'DATA').transitions).toEqual([
      { from: 'backlog', to: 'in_progress' },
    ])
  })
})

describe('items', () => {
  it('refuses an item without a team (test 1)', async () => {
    expect((await call('ana', 'POST', '/core/items', { title: 'No team' })).status).toBe(400)
  })

  it('never reuses a key, even after deletion (test 3)', async () => {
    const a = await call('ana', 'POST', '/core/items', { teamId: 'DATA', title: 'One' })
    await db.query('UPDATE work_items SET deleted_at = now() WHERE id = $1', [a.body.item.id])
    const b = await call('ana', 'POST', '/core/items', { teamId: 'DATA', title: 'Two' })
    expect(b.body.item.key).not.toBe(a.body.item.key)
    const num = (k: string) => Number(k.split('-')[1])
    expect(num(b.body.item.key)).toBe(num(a.body.item.key) + 1)
  })

  it('refuses a sub-item of a sub-item, and one in another team (test 2)', async () => {
    const parent = await call('ana', 'POST', '/core/items', { teamId: 'DATA', title: 'Parent' })
    const child = await call('ana', 'POST', '/core/items', {
      teamId: 'DATA',
      title: 'Child',
      parentId: parent.body.item.id,
    })
    expect(child.status).toBe(201)
    const grandchild = await call('ana', 'POST', '/core/items', {
      teamId: 'DATA',
      title: 'Too deep',
      parentId: child.body.item.id,
    })
    expect(grandchild.body.error).toBe('parent_is_sub_item')
    const other = await call('ben', 'POST', '/core/items', {
      teamId: 'ENG',
      title: 'Other team',
      parentId: parent.body.item.id,
    })
    expect(other.body.error).toBe('parent_other_team')
  })

  it('does not let a viewer create items or projects', async () => {
    expect((await call('vic', 'POST', '/core/items', { teamId: 'DATA', title: 'No' })).status).toBe(
      403,
    )
    expect((await call('vic', 'POST', '/core/projects', { name: 'No', colour: 1 })).status).toBe(
      403,
    )
  })
})

describe('projects and milestones', () => {
  it('keeps milestones inside their project, and sub-items with their parent (test 4)', async () => {
    const p1 = await call('ben', 'POST', '/core/projects', { name: 'Census', colour: 1 })
    const p2 = await call('ben', 'POST', '/core/projects', { name: 'Summit', colour: 3 })
    expect(p1.status).toBe(201)
    const m2 = await call('ben', 'POST', `/core/projects/${p2.body.project.id}/milestones`, {
      name: 'Venue',
      dueOn: '2026-12-15',
    })
    const item = await call('ben', 'POST', '/core/items', {
      teamId: 'ENG',
      title: 'Portal',
      projectId: p1.body.project.id,
    })
    const bad = await call('ben', 'PATCH', `/core/items/${item.body.item.id}/plan`, {
      milestoneId: m2.body.id,
    })
    expect(bad.body.error).toBe('milestone_not_in_project')

    const sub = await call('ben', 'POST', '/core/items', {
      teamId: 'ENG',
      title: 'Sub',
      parentId: item.body.item.id,
    })
    expect(sub.body.item.projectId).toBe(p1.body.project.id)
    const moved = await call('ben', 'PATCH', `/core/items/${item.body.item.id}/plan`, {
      projectId: p2.body.project.id,
      milestoneId: m2.body.id,
      dueOn: '2026-12-10',
      estimate: 5,
      labels: ['Portal', 'portal'],
    })
    expect(moved.body.item).toMatchObject({
      projectId: p2.body.project.id,
      milestoneId: m2.body.id,
      dueOn: '2026-12-10',
      estimate: 5,
      labels: ['portal'],
    })
    const project = await call('ben', 'GET', `/core/projects/${p2.body.project.id}`)
    expect(project.body.items.find((i: any) => i.id === sub.body.item.id).projectId).toBe(
      p2.body.project.id,
    )
    expect(project.body.milestones[0]).toMatchObject({ name: 'Venue', total: 1, left: 1 })
    expect(project.body.progress.total).toBe(1)
  })

  it('lets only the owner or an org admin edit a project', async () => {
    const p = await call('ben', 'POST', '/core/projects', { name: 'Mine', colour: 2 })
    expect(
      (await call('ana', 'PATCH', `/core/projects/${p.body.project.id}`, { name: 'Taken' })).status,
    ).toBe(403)
    expect(
      (await call('boss', 'PATCH', `/core/projects/${p.body.project.id}`, { archived: true })).body
        .project.archived,
    ).toBe(true)
  })
})

describe('fields', () => {
  it('turning a team field off and on keeps its values (test 8)', async () => {
    const added = await call('ana', 'POST', '/core/teams/DATA/fields', {
      label: 'Rows expected',
      type: 'number',
    })
    expect(added.status).toBe(201)
    const item = await call('ana', 'POST', '/core/items', { teamId: 'DATA', title: 'With a value' })
    await call('ana', 'PATCH', `/items/${item.body.item.id}`, { fields: { rows_expected: 37 } })
    await call('ana', 'PUT', `/core/teams/DATA/fields/${added.body.id}`, { enabled: false })
    let fields = (await call('ana', 'GET', '/core/teams/DATA/fields')).body.fields
    expect(fields.find((f: any) => f.id === added.body.id).enabled).toBe(false)
    await call('ana', 'PUT', `/core/teams/DATA/fields/${added.body.id}`, { enabled: true })
    fields = (await call('ana', 'GET', '/core/teams/DATA/fields')).body.fields
    expect(fields.find((f: any) => f.id === added.body.id).enabled).toBe(true)
    const items = (await call('ana', 'GET', '/core/teams/DATA/items')).body.items
    expect(items.find((i: any) => i.id === item.body.item.id).fields.rows_expected).toBe(37)
  })

  it('needs options for pick fields and refuses duplicates', async () => {
    expect(
      (await call('ana', 'POST', '/core/teams/DATA/fields', { label: 'Kind', type: 'pick_one' }))
        .body.error,
    ).toBe('options_required')
    expect(
      (
        await call('ana', 'POST', '/core/teams/DATA/fields', {
          label: 'Rows expected',
          type: 'number',
        })
      ).status,
    ).toBe(409)
  })
})
