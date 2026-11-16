/**
 * PROTECTED TEST. specs/code-status.md on the API surface: signatures, finding items, team
 * rules, automatic moves that follow the stage rules, reasons, and audited overrides.
 * Human-owned once the spec is merged: do not edit to make code pass.
 */
import { createHmac } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../../src/app.js'
import { createPgliteDb, type Db } from '../../src/db/db.js'
import { migrate } from '../../src/db/migrations.js'
import { insertItem } from '../../src/db/seed.js'

const SECRET = 'test-secret'
let db: Db
let app: FastifyInstance
const as = (user: string) => ({ 'x-dev-user': user })
const sign = (body: string, secret = SECRET) =>
  `sha256=${createHmac('sha256', secret).update(body, 'utf8').digest('hex')}`
const deliver = (event: string, payload: object, signature?: string) => {
  const body = JSON.stringify(payload)
  return app.inject({
    method: 'POST',
    url: '/integrations/github',
    headers: {
      'content-type': 'application/json',
      'x-github-event': event,
      'x-hub-signature-256': signature ?? sign(body),
    },
    payload: body,
  })
}
const repository = { full_name: 'acme/app' }
const pr = (number: number, branch: string, title: string, merged = false) => ({
  number,
  html_url: `https://github.com/acme/app/pull/${number}`,
  title,
  head: { ref: branch },
  draft: false,
  merged,
})
const opened = (number: number, branch: string, title = 'Change') =>
  deliver('pull_request', { action: 'opened', pull_request: pr(number, branch, title), repository })
const checks = (number: number, branch: string, conclusion: string) =>
  deliver('check_suite', {
    action: 'completed',
    check_suite: {
      conclusion,
      head_branch: branch,
      pull_requests: [{ number, head: { ref: branch } }],
    },
    repository,
  })
const merged = (number: number, branch: string) =>
  deliver('pull_request', {
    action: 'closed',
    pull_request: pr(number, branch, 'Change', true),
    repository,
  })
const stageOf = async (id: string) =>
  (await app.inject({ method: 'GET', url: `/items/${id}/workflow`, headers: as('dev') })).json()
    .stageKey
const lastHistory = async (id: string) =>
  (await app.inject({ method: 'GET', url: `/items/${id}/stages`, headers: as('dev') }))
    .json()
    .history.at(-1)

beforeAll(async () => {
  db = await createPgliteDb()
  await migrate(db)
  await db.exec(`
    INSERT INTO users (id, name, org_role) VALUES ('dev', 'Developer', 'member'),
      ('lead', 'Lead', 'member');
    INSERT INTO teams (id, key, name, is_private) VALUES ('ENG', 'ENG', 'Engineering', false),
      ('DATA', 'DATA', 'Data', false);
    INSERT INTO team_members (team_id, user_id, role) VALUES ('ENG', 'dev', 'member'),
      ('ENG', 'lead', 'admin'), ('DATA', 'dev', 'member');
    INSERT INTO code_rules (team_id, event_kind, stage_key) VALUES
      ('ENG', 'pr_opened', 'in_review'), ('ENG', 'checks_failed', 'in_progress'),
      ('ENG', 'pr_merged', 'done');
    INSERT INTO stage_steps (team_id, stage_key, label, position) VALUES
      ('ENG', 'in_review', 'Release notes written', 1);
  `)
  const item = (id: string, key: string, teamId: string, statusId: string) =>
    insertItem(db, {
      id,
      key,
      kind: 'task',
      title: id,
      statusId,
      statusCategory: statusId === 'todo' ? 'todo' : 'in_progress',
      teamId,
      assigneeId: 'dev',
      createdBy: 'dev',
      fields: {},
    })
  await item('e142', 'ENG-142', 'ENG', 'in_progress')
  await item('e200', 'ENG-200', 'ENG', 'in_progress')
  await item('e300', 'ENG-300', 'ENG', 'todo')
  await item('d7', 'DATA-7', 'DATA', 'in_progress')
  app = buildApp({ db, devAuth: true, codeWebhookSecret: SECRET })
})

afterAll(async () => {
  await app.close()
  await db.close()
})

describe('status that follows the code', () => {
  it('example 7 and rule 1: a wrong or missing signature is refused and changes nothing', async () => {
    const body = { action: 'opened', pull_request: pr(31, 'eng-142-x', 'x'), repository }
    expect((await deliver('pull_request', body, sign('{}'))).statusCode).toBe(401)
    expect((await deliver('pull_request', body, 'sha256=00')).statusCode).toBe(401)
    expect(
      (await deliver('pull_request', body, sign(JSON.stringify(body), 'other'))).statusCode,
    ).toBe(401)
    expect(await stageOf('e142')).toBe('in_progress')
    const count = await db.query<{ n: string }>('SELECT count(*) AS n FROM code_links')
    expect(Number(count[0]?.n)).toBe(0)
  })

  it('without a secret the endpoint is off', async () => {
    const off = buildApp({ db, devAuth: true })
    const body = JSON.stringify({ repository })
    const res = await off.inject({
      method: 'POST',
      url: '/integrations/github',
      headers: { 'content-type': 'application/json', 'x-hub-signature-256': sign(body) },
      payload: body,
    })
    expect(res.statusCode).toBe(404)
    await off.close()
  })

  it('example 1 and rule 6: an opened pull request moves the item, with the reason', async () => {
    const res = await opened(31, 'eng-142-login-timeout', 'Fix login timeout')
    expect(res.json().results).toEqual([
      { item: 'ENG-142', outcome: 'moved', detail: 'Pull request #31 opened' },
    ])
    expect(await stageOf('e142')).toBe('in_review')
    expect(await lastHistory('e142')).toMatchObject({
      stageKey: 'in_review',
      kind: 'automatic',
      movedBy: null,
      reason: 'Pull request #31 opened',
    })
  })

  it('examples 2 and 3: failed checks move it back; passed checks with no rule only update the PR', async () => {
    await checks(31, 'eng-142-login-timeout', 'failure')
    expect(await stageOf('e142')).toBe('in_progress')
    const passed = await checks(31, 'eng-142-login-timeout', 'success')
    expect(passed.json().results[0]).toMatchObject({ item: 'ENG-142', outcome: 'no_rule' })
    expect(await stageOf('e142')).toBe('in_progress')
    const code = (
      await app.inject({ method: 'GET', url: '/items/e142/code', headers: as('dev') })
    ).json()
    expect(code.pullRequests[0]).toMatchObject({
      repo: 'acme/app',
      number: 31,
      title: 'Fix login timeout',
      state: 'open',
      checks: 'passing',
    })
  })

  it('rule 5: automatic moves follow the stage rules and are never forced', async () => {
    // In Review has a checklist step, so merging cannot move ENG-142 on to Done yet.
    await opened(31, 'eng-142-login-timeout', 'Fix login timeout')
    const res = await merged(31, 'eng-142-login-timeout')
    expect(res.json().results[0]).toEqual({
      item: 'ENG-142',
      outcome: 'not_moved',
      detail: 'still needs: Release notes written',
    })
    expect(await stageOf('e142')).toBe('in_review')
    // Todo cannot jump straight to In Review under the default moves.
    expect((await opened(40, 'eng-300-x')).json().results[0]).toMatchObject({
      item: 'ENG-300',
      outcome: 'not_moved',
      detail: 'that stage cannot be reached from here',
    })
  })

  it('example 4: merging moves the item to Done once nothing is missing', async () => {
    await opened(50, 'feature/cache', 'ENG-200 cache warm-up')
    expect(await stageOf('e200')).toBe('in_review')
    const steps = (
      await app.inject({ method: 'GET', url: '/items/e200/workflow', headers: as('dev') })
    ).json().steps
    await app.inject({
      method: 'POST',
      url: `/items/e200/steps/${steps[0].id}`,
      headers: as('dev'),
      payload: { ticked: true },
    })
    // Check events carry no title; the item is found through the pull request it is linked to.
    await deliver('pull_request', {
      action: 'closed',
      pull_request: pr(50, 'feature/cache', 'ENG-200 cache warm-up', true),
      repository,
    })
    expect(await stageOf('e200')).toBe('done')
    const audit = await db.query<{ actor_id: string; action: string }>(
      "SELECT actor_id, action FROM audit_log WHERE object_id = 'e200' ORDER BY seq",
    )
    expect(audit.map((a) => a.action)).toEqual(['item.automaticMove', 'item.automaticMove'])
    expect(audit[0]?.actor_id).toBe('integration:github')
  })

  it('example 5 and rule 8: a person may override, and the override is audited', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/items/e200',
      headers: as('lead'),
      // Reopening goes to the nearest earlier working stage (specs/workflow.md, rule 8).
      payload: { statusId: 'in_review', reason: 'Fix is incomplete' },
    })
    expect(res.statusCode).toBe(200)
    const audit = await db.query<{ actor_id: string; detail: { from: string; to: string } }>(
      "SELECT actor_id, detail FROM audit_log WHERE object_id = 'e200' AND action = 'item.overrideAutomatic'",
    )
    expect(audit).toEqual([{ actor_id: 'lead', detail: { from: 'done', to: 'in_review' } }])
  })

  it('example 6 and rule 4: a team without rules keeps the PR but does not move', async () => {
    const res = await opened(60, 'tidy', 'DATA-7 tidy columns')
    expect(res.json().results).toEqual([{ item: 'DATA-7', outcome: 'no_rule', detail: null }])
    expect(await stageOf('d7')).toBe('in_progress')
  })

  it('rule 9: only team admins set code rules, to stages of their team', async () => {
    const put = (user: string, rules: object) =>
      app.inject({
        method: 'PUT',
        url: '/teams/ENG/code-rules',
        headers: as(user),
        payload: { rules },
      })
    expect((await put('dev', { pr_opened: 'todo' })).statusCode).toBe(403)
    expect((await put('lead', { pr_opened: 'nowhere' })).json().error).toBe('unknown_stage')
    expect((await put('lead', { deploy: 'done' })).statusCode).toBe(400)
    const res = await put('lead', { checks_failed: null, pr_closed: 'cancelled' })
    expect(res.json().rules).toEqual({
      pr_opened: 'in_review',
      pr_merged: 'done',
      pr_closed: 'cancelled',
    })
  })
})
