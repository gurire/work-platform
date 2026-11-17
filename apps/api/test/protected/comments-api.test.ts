/**
 * PROTECTED TEST. specs/comments.md on the API surface: who may comment, edit and delete,
 * mentions that only reach people who can see the item, and the personal inbox.
 * Human-owned once the spec is merged: do not edit to make code pass.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { mentionToken } from '@wm/shared'
import { buildApp } from '../../src/app.js'
import { createPgliteDb, type Db } from '../../src/db/db.js'
import { migrate } from '../../src/db/migrations.js'
import { insertItem } from '../../src/db/seed.js'

let db: Db
let app: FastifyInstance
const as = (user: string) => ({ 'x-dev-user': user })
const comment = (item: string, user: string, body: string, internal?: boolean) =>
  app.inject({
    method: 'POST',
    url: `/items/${item}/comments`,
    headers: as(user),
    payload: internal === undefined ? { body } : { body, internal },
  })
const comments = async (item: string, user: string) =>
  (await app.inject({ method: 'GET', url: `/items/${item}/comments`, headers: as(user) })).json()
const inbox = async (user: string) =>
  (await app.inject({ method: 'GET', url: '/inbox', headers: as(user) })).json()
const last = <T>(list: T[]): T => list[list.length - 1] as T

beforeAll(async () => {
  db = await createPgliteDb()
  await migrate(db)
  await db.exec(`
    INSERT INTO users (id, name, org_role) VALUES
      ('grace', 'Grace Lim', 'member'), ('chen', 'Chen Wei', 'member'), ('hugo', 'Hugo', 'member'),
      ('ines', 'Ines', 'member'), ('asha', 'Asha', 'member'), ('vie', 'Viewer', 'viewer'),
      ('ben', 'Ben', 'member');
    INSERT INTO teams (id, key, name, is_private) VALUES ('DATA', 'DATA', 'Data', false),
      ('ENG', 'ENG', 'Engineering', false), ('SEC', 'SEC', 'Security', true);
    INSERT INTO team_members (team_id, user_id, role) VALUES
      ('DATA', 'grace', 'admin'), ('DATA', 'chen', 'member'), ('DATA', 'hugo', 'member'),
      ('DATA', 'ines', 'reviewer'), ('ENG', 'asha', 'member'), ('SEC', 'ben', 'member');
  `)
  const item = (id: string, key: string, teamId: string, assigneeId: string | null) =>
    insertItem(db, {
      id,
      key,
      kind: 'task',
      title: id,
      statusId: 'todo',
      statusCategory: 'todo',
      teamId,
      assigneeId,
      createdBy: null,
      fields: {},
    })
  await item('d12', 'DATA-12', 'DATA', 'hugo')
  await item('d13', 'DATA-13', 'DATA', null)
  await item('s1', 'SEC-1', 'SEC', 'ben')
  app = buildApp({ db, devAuth: true })
})

afterAll(async () => {
  await app.close()
  await db.close()
})

describe('comments, mentions and the inbox', () => {
  it('example 1: a mention reaches the person; the owner hears about the comment', async () => {
    const res = await comment(
      'd12',
      'chen',
      `${mentionToken('Grace Lim', 'grace')} can you check the totals?`,
    )
    expect(res.statusCode).toBe(200)
    expect(res.json().notNotified).toEqual([])
    expect(last(res.json().comments as { authorId: string }[]).authorId).toBe('chen')
    const grace = await inbox('grace')
    expect(grace.entries[0]).toMatchObject({
      kind: 'mentioned',
      itemKey: 'DATA-12',
      actorId: 'chen',
    })
    expect(grace.entries[0].excerpt).toContain('can you check the totals?')
    expect((await inbox('hugo')).entries[0]).toMatchObject({
      kind: 'commented',
      itemKey: 'DATA-12',
    })
  })

  it('rule 4.2: your own actions never reach your inbox', async () => {
    await comment('d12', 'hugo', `${mentionToken('Hugo', 'hugo')} note to self`)
    const kinds = (await inbox('hugo')).entries.map((e: { actorId: string }) => e.actorId)
    expect(kinds).not.toContain('hugo')
  })

  it('example 2: someone outside the team who can see the item is told', async () => {
    await comment('d12', 'chen', `${mentionToken('Asha', 'asha')} FYI`)
    expect((await inbox('asha')).entries[0]).toMatchObject({
      kind: 'mentioned',
      itemKey: 'DATA-12',
    })
  })

  it('example 3 and rule 3.2: people who cannot see the item are not told, and the item is not revealed', async () => {
    const res = await comment('s1', 'ben', `${mentionToken('Chen Wei', 'chen')} look`)
    expect(res.json().notNotified).toEqual([{ id: 'chen', name: 'Chen Wei' }])
    const chen = await inbox('chen')
    expect(chen.entries.map((e: { itemKey: string }) => e.itemKey)).not.toContain('SEC-1')
    expect(
      (await comment('d12', 'chen', `${mentionToken('X', 'nobody')} hi`)).json().notNotified,
    ).toEqual([{ id: 'nobody', name: 'nobody' }])
  })

  it('example 4 and rules 2.1 and 2.2: reviewers may comment; viewers and outsiders only read', async () => {
    expect((await comment('d12', 'ines', 'Units are in thousands')).statusCode).toBe(200)
    expect((await comment('d12', 'vie', 'hello')).statusCode).toBe(403)
    expect((await comment('d12', 'asha', 'hello')).statusCode).toBe(403)
    const asViewer = await comments('d12', 'vie')
    expect(asViewer.canComment).toBe(false)
    expect(asViewer.comments.length).toBeGreaterThan(0)
    expect(
      (await app.inject({ method: 'GET', url: '/items/s1/comments', headers: as('chen') }))
        .statusCode,
    ).toBe(404)
    expect((await comment('s1', 'chen', 'hi')).statusCode).toBe(404)
  })

  it('rule 2.3 and 3.3: edit your own; versions are kept; only newly mentioned people are told', async () => {
    const posted = await comment('d13', 'chen', `${mentionToken('Grace Lim', 'grace')} first draft`)
    const id = last(posted.json().comments as { id: string }[]).id
    const before = (await inbox('grace')).entries.length
    expect(
      (
        await app.inject({
          method: 'PATCH',
          url: `/comments/${id}`,
          headers: as('hugo'),
          payload: { body: 'x' },
        })
      ).statusCode,
    ).toBe(403)
    const edited = await app.inject({
      method: 'PATCH',
      url: `/comments/${id}`,
      headers: as('chen'),
      payload: {
        body: `${mentionToken('Grace Lim', 'grace')} ${mentionToken('Hugo', 'hugo')} second draft`,
      },
    })
    const mine = last(edited.json().comments as { body: string; editedAt: string | null }[])
    expect(mine.body).toContain('second draft')
    expect(mine.editedAt).not.toBe(null)
    expect((await inbox('grace')).entries.length).toBe(before)
    expect((await inbox('hugo')).entries[0]).toMatchObject({
      kind: 'mentioned',
      itemKey: 'DATA-13',
    })
    const versions = await db.query<{ body: string }>(
      'SELECT body FROM comment_versions WHERE comment_id = $1',
      [id],
    )
    expect(versions.map((v) => v.body)).toEqual([
      `${mentionToken('Grace Lim', 'grace')} first draft`,
    ])
  })

  it('example 5 and rule 2.4: delete your own, or anyone’s as team admin (audited)', async () => {
    const posted = await comment('d13', 'hugo', 'A comment to remove')
    const id = last(posted.json().comments as { id: string }[]).id
    expect(
      (await app.inject({ method: 'DELETE', url: `/comments/${id}`, headers: as('chen') }))
        .statusCode,
    ).toBe(403)
    const res = await app.inject({ method: 'DELETE', url: `/comments/${id}`, headers: as('grace') })
    const gone = (
      res.json().comments as { id: string; body: string | null; deletedBy: string }[]
    ).find((c) => c.id === id)
    expect(gone).toMatchObject({ body: null, deletedBy: 'grace' })
    const audited = await db.query<{ actor_id: string }>(
      "SELECT actor_id FROM audit_log WHERE action = 'comment.deleteAny'",
    )
    expect(audited.map((a) => a.actor_id)).toEqual(['grace'])
    const own = await comment('d13', 'chen', 'mine')
    const ownId = last(own.json().comments as { id: string }[]).id
    expect(
      (await app.inject({ method: 'DELETE', url: `/comments/${ownId}`, headers: as('chen') }))
        .statusCode,
    ).toBe(200)
  })

  it('example 6: a new owner is told; assigning yourself adds nothing', async () => {
    const before = (await inbox('chen')).entries.length
    await app.inject({
      method: 'PATCH',
      url: '/items/d13',
      headers: as('chen'),
      payload: { assigneeId: 'chen' },
    })
    expect((await inbox('chen')).entries.length).toBe(before)
    await app.inject({
      method: 'PATCH',
      url: '/items/d13',
      headers: as('chen'),
      payload: { assigneeId: 'hugo' },
    })
    expect((await inbox('hugo')).entries[0]).toMatchObject({
      kind: 'assigned',
      itemKey: 'DATA-13',
      actorId: 'chen',
    })
  })

  it('rules 4.3 to 4.5: hidden items drop out, read state, and only your own entries', async () => {
    // Asha loses sight of DATA when it turns private; her entry about DATA-12 disappears.
    await db.exec("UPDATE teams SET is_private = true WHERE id = 'DATA'")
    expect((await inbox('asha')).entries).toEqual([])
    await db.exec("UPDATE teams SET is_private = false WHERE id = 'DATA'")
    expect((await inbox('asha')).entries).toHaveLength(1)

    const grace = await inbox('grace')
    expect(grace.unread).toBeGreaterThan(0)
    const first = grace.entries[0].id
    // Someone else cannot mark Grace's entries.
    await app.inject({
      method: 'POST',
      url: '/inbox/read',
      headers: as('chen'),
      payload: { ids: [first] },
    })
    expect((await inbox('grace')).entries[0].read).toBe(false)
    await app.inject({
      method: 'POST',
      url: '/inbox/read',
      headers: as('grace'),
      payload: { ids: [first] },
    })
    expect((await inbox('grace')).entries[0].read).toBe(true)
    await app.inject({ method: 'POST', url: '/inbox/read', headers: as('grace'), payload: {} })
    expect((await inbox('grace')).unread).toBe(0)
  })
})
