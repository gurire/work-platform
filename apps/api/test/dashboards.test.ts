import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../src/app.js'
import { createPgliteDb, type Db } from '../src/db/db.js'
import { migrate } from '../src/db/migrations.js'
import { insertItem } from '../src/db/seed.js'

let db: Db
let app: FastifyInstance
const as = (user: string) => ({ 'x-dev-user': user })
const get = (url: string, user: string) => app.inject({ method: 'GET', url, headers: as(user) })

/** Replace an item's history with stages entered the given number of days ago. */
async function history(id: string, steps: [string, number][]) {
  await db.query('DELETE FROM stage_history WHERE item_id = $1', [id])
  for (const [i, [stage, ago]] of steps.entries()) {
    const next = steps[i + 1]
    await db.query(
      `INSERT INTO stage_history (item_id, stage_key, entered_at, left_at)
       VALUES ($1, $2, now() - make_interval(hours => $3), $4)`,
      [id, stage, Math.round(ago * 24), next ? new Date(Date.now() - next[1] * 86_400_000) : null],
    )
  }
  const last = steps.at(-1)
  if (last) await db.query('UPDATE work_items SET status_id = $2 WHERE id = $1', [id, last[0]])
}

beforeAll(async () => {
  db = await createPgliteDb()
  await migrate(db)
  await db.exec(`
    INSERT INTO users (id, name, org_role) VALUES
      ('ana', 'Ana', 'member'), ('ben', 'Ben', 'member'), ('rev', 'Rev', 'member'),
      ('boss', 'Boss', 'org_admin');
    INSERT INTO teams (id, key, name, is_private) VALUES
      ('PIPE', 'PIPE', 'Pipeline', false), ('PRIV', 'PRIV', 'Private', true);
    DELETE FROM stages WHERE team_id = 'PIPE';
    INSERT INTO stages (team_id, key, name, category, position, target_hours) VALUES
      ('PIPE', 'analysis', 'Analysis', 'todo', 1, NULL),
      ('PIPE', 'processing', 'Processing', 'in_progress', 2, NULL),
      ('PIPE', 'validation', 'Validation', 'in_progress', 3, 48),
      ('PIPE', 'published', 'Published', 'done', 4, NULL),
      ('PIPE', 'dropped', 'Dropped', 'cancelled', 5, NULL);
    INSERT INTO team_members (team_id, user_id, role) VALUES
      ('PIPE', 'ana', 'admin'), ('PIPE', 'ben', 'member'), ('PRIV', 'ben', 'member'),
      ('PIPE', 'rev', 'reviewer');
  `)
  const base = { kind: 'task', fields: {}, createdBy: 'ana', statusCategory: 'todo' }
  const items: [string, string, string, string | null][] = [
    ['p1', 'PIPE-1', 'PIPE', 'ana'],
    ['p2', 'PIPE-2', 'PIPE', 'ben'],
    ['p3', 'PIPE-3', 'PIPE', null],
    ['p4', 'PIPE-4', 'PIPE', 'ana'],
    ['x1', 'PRIV-1', 'PRIV', 'ben'],
  ]
  for (const [id, key, teamId, assigneeId] of items) {
    await insertItem(db, {
      ...base,
      id,
      key,
      title: key,
      teamId,
      assigneeId,
      statusId: teamId === 'PIPE' ? 'analysis' : 'todo',
    })
  }
  // p1: started 10 days ago, published 3 days ago: cycle time 7 days.
  await history('p1', [
    ['analysis', 12],
    ['processing', 10],
    ['validation', 6],
    ['published', 3],
  ])
  // p2: in validation for 3 days, target 48 hours: past target.
  await history('p2', [
    ['analysis', 8],
    ['processing', 6],
    ['validation', 3],
  ])
  // p3: waiting in analysis, not started.
  await history('p3', [['analysis', 1]])
  // p4: dropped: never finished.
  await history('p4', [
    ['analysis', 5],
    ['processing', 4],
    ['dropped', 2],
  ])
  app = buildApp({ db, devAuth: true })
  await app.ready()
})

afterAll(async () => {
  await app.close()
})

describe('team dashboard (specs/dashboards.md)', () => {
  it('works out the headline numbers from stage history', async () => {
    const res = await get('/teams/PIPE/dashboard', 'ben')
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.headline.open).toBe(2)
    expect(body.headline.pastTarget).toBe(1)
    expect(body.headline.cycle85).toBe(7)
    expect(body.cycle).toEqual([expect.objectContaining({ key: 'PIPE-1', days: 7 })])
    // Only started open items are on the ageing chart; p2 started 6 days ago.
    expect(body.ageing).toEqual([
      expect.objectContaining({
        key: 'PIPE-2',
        stageKey: 'validation',
        ageDays: 6,
        pastTarget: true,
      }),
    ])
    // Workload counts open items in working stages, per person.
    expect(body.workload).toEqual([{ assigneeId: 'ben', counts: { validation: 1 } }])
    // Cumulative flow leaves out cancelled stages; today ends with one item in each of
    // analysis, validation and published.
    const today = Object.fromEntries(
      body.flow.series.map((s: { stageKey: string; counts: number[] }) => [
        s.stageKey,
        s.counts.at(-1),
      ]),
    )
    expect(today).toEqual({ analysis: 1, processing: 0, validation: 1, published: 1 })
    expect(body.throughput.reduce((sum: number, w: { count: number }) => sum + w.count, 0)).toBe(1)
    expect(body.forecastBasis).toHaveLength(12)
  })

  it('is "not found" for anyone who cannot view the team (section 2, rule 1)', async () => {
    expect((await get('/teams/PRIV/dashboard', 'ana')).statusCode).toBe(404)
    expect((await get('/teams/NOPE/dashboard', 'ana')).statusCode).toBe(404)
    expect((await get('/teams/PRIV/dashboard', 'ben')).statusCode).toBe(200)
  })
})

describe('cross-team view', () => {
  it('lists only visible teams, so hidden teams add nothing (section 2, rule 2)', async () => {
    const ana = (await get('/dashboards/teams', 'ana')).json()
    expect(ana.teams.map((t: { team: { id: string } }) => t.team.id)).toEqual(['PIPE'])
    const ben = (await get('/dashboards/teams', 'ben')).json()
    expect(ben.teams.map((t: { team: { id: string } }) => t.team.id).sort()).toEqual([
      'PIPE',
      'PRIV',
    ])
    // Example 5: the PIPE row is the same whoever looks.
    const pipeFor = (body: { teams: { team: { id: string } }[] }) =>
      body.teams.find((t) => t.team.id === 'PIPE')
    expect(pipeFor(ana)).toEqual(pipeFor(ben))
  })

  it('gives status, past target and where work is stuck', async () => {
    const row = (await get('/dashboards/teams', 'ana')).json().teams[0]
    // One of one started open item is past target: at risk.
    expect(row.status).toBe('at_risk')
    expect(row.pastTarget).toBe(1)
    // Validation's name has no "review" in it, so it is a working stage: 72 h / 48 h = 150%.
    expect(row.stuck.working).toBe(150)
    expect(row.stuck.review).toBeNull()
  })
})

describe('stage kinds', () => {
  const put = (user: string, stage: string, kind: unknown) =>
    app.inject({
      method: 'PUT',
      url: `/teams/PIPE/stages/${stage}/kind`,
      headers: as(user),
      payload: { kind },
    })

  it('team admins set a kind, and the stuck view follows it', async () => {
    expect((await put('ana', 'validation', 'review')).statusCode).toBe(200)
    const row = (await get('/dashboards/teams', 'ana')).json().teams[0]
    expect(row.stuck.review).toBe(150)
    expect(row.stuck.working).toBeNull()
    expect((await put('ana', 'validation', null)).statusCode).toBe(200)
  })

  it('members cannot, end stages have none, and unknown kinds are refused', async () => {
    expect((await put('ben', 'validation', 'review')).statusCode).toBe(403)
    expect((await put('ana', 'published', 'review')).statusCode).toBe(422)
    expect((await put('ana', 'validation', 'sideways')).statusCode).toBe(400)
  })
})
