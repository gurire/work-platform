/**
 * PROTECTED TEST. Checks that the API enforces specs/records.md: visibility follows the home
 * team, only the home team edits, values must fit, history is kept, archiving, and linking.
 * Human-owned once the spec is merged: do not edit to make code pass.
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
const get = (url: string, user: string) => app.inject({ method: 'GET', url, headers: as(user) })
const send = (method: 'POST' | 'PATCH', url: string, user: string, payload?: object) =>
  app.inject({ method, url, headers: as(user), ...(payload ? { payload } : {}) })

beforeAll(async () => {
  db = await createPgliteDb()
  await migrate(db)
  await db.exec(`
    INSERT INTO users (id, name, org_role) VALUES
      ('grace', 'Grace', 'member'), ('chen', 'Chen', 'member'), ('rev', 'Reviewer', 'member'),
      ('eng', 'Eng member', 'member'), ('sec', 'Sec member', 'member'), ('vie', 'Viewer', 'viewer');
    INSERT INTO teams (id, key, name, is_private) VALUES
      ('DATA', 'DATA', 'Data', false), ('ENG', 'ENG', 'Engineering', false),
      ('SEC', 'SEC', 'Security', true);
    INSERT INTO team_members (team_id, user_id, role) VALUES
      ('DATA', 'grace', 'admin'), ('DATA', 'chen', 'member'), ('DATA', 'rev', 'reviewer'),
      ('ENG', 'eng', 'member'), ('SEC', 'sec', 'member');
    INSERT INTO record_types (key, name, fields) VALUES ('dataset', 'Dataset', '[
      {"key": "source", "label": "Source", "kind": "text", "required": true},
      {"key": "frequency", "label": "Frequency", "kind": "choice", "required": false,
       "options": ["monthly", "quarterly", "yearly"]}
    ]'::jsonb);
    INSERT INTO records (id, type_key, team_id, title, values) VALUES
      ('rain', 'dataset', 'DATA', 'Rainfall by district', '{"source": "IMD", "frequency": "monthly"}'),
      ('keys', 'dataset', 'SEC', 'Access logs', '{"source": "Internal"}');
  `)
  const item = (id: string, teamId: string) =>
    insertItem(db, {
      id,
      key: id.toUpperCase(),
      kind: 'task',
      title: id,
      statusId: 'todo',
      statusCategory: 'todo',
      teamId,
      assigneeId: null,
      createdBy: null,
      fields: {},
    })
  await item('d1', 'DATA')
  await item('d2', 'DATA')
  await item('e1', 'ENG')
  await db.exec("UPDATE work_items SET record_id = 'rain' WHERE id IN ('d1', 'd2')")
  await db.exec("UPDATE work_items SET record_id = 'keys' WHERE id = 'e1'")
  app = buildApp({ db, devAuth: true })
})

afterAll(async () => {
  await app.close()
  await db.close()
})

describe('records on the API surface', () => {
  it('example 1: an edit shows on every linked item and is kept in history', async () => {
    const res = await send('PATCH', '/records/rain', 'grace', { values: { source: 'IMD gridded' } })
    expect(res.statusCode).toBe(200)
    for (const id of ['d1', 'd2']) {
      const body = (await get(`/items/${id}/record`, 'chen')).json()
      expect(body.record.values.source).toBe('IMD gridded')
    }
    const detail = (await get('/records/rain', 'chen')).json()
    expect(detail.items.map((i: { id: string }) => i.id).sort()).toEqual(['d1', 'd2'])
    expect(detail.history[0]).toMatchObject({
      actorId: 'grace',
      action: 'edited',
      changes: [{ field: 'source', from: 'IMD', to: 'IMD gridded' }],
    })
  })

  it('examples 2 and 3: values must fit and required fields stay filled; nothing changes', async () => {
    const weekly = await send('PATCH', '/records/rain', 'chen', { values: { frequency: 'weekly' } })
    expect(weekly.json()).toEqual({ error: 'invalid_value', field: 'frequency' })
    const cleared = await send('PATCH', '/records/rain', 'chen', { values: { source: '' } })
    expect(cleared.json()).toEqual({ error: 'required_missing', field: 'source' })
    const unknown = await send('PATCH', '/records/rain', 'chen', { values: { colour: 'red' } })
    expect(unknown.json()).toEqual({ error: 'unknown_field', field: 'colour' })
    expect((await get('/records/rain', 'chen')).json().record.values).toEqual({
      source: 'IMD gridded',
      frequency: 'monthly',
    })
  })

  it('example 4: another team may link to the record but not edit it', async () => {
    expect((await send('PATCH', '/items/e1', 'eng', { recordId: 'rain' })).statusCode).toBe(200)
    expect((await get('/items/e1/record', 'eng')).json().record.id).toBe('rain')
    const edit = await send('PATCH', '/records/rain', 'eng', { values: { frequency: 'yearly' } })
    expect(edit.statusCode).toBe(403)
    expect((await get('/records/rain', 'eng')).json().canEdit).toBe(false)
    // Reviewers and viewers may see it but not edit it.
    expect((await send('PATCH', '/records/rain', 'rev', { title: 'x' })).statusCode).toBe(403)
    expect((await get('/records/rain', 'vie')).statusCode).toBe(200)
    expect((await send('PATCH', '/records/rain', 'vie', { title: 'x' })).statusCode).toBe(403)
  })

  it('linking needs permission to edit the item', async () => {
    expect((await send('PATCH', '/items/d1', 'eng', { recordId: null })).statusCode).toBe(403)
    expect((await send('PATCH', '/items/d1', 'rev', { recordId: null })).statusCode).toBe(403)
  })

  it('example 5: a record of a private team is invisible to others, everywhere', async () => {
    expect((await get('/records/keys', 'eng')).statusCode).toBe(404)
    expect((await get('/records/keys', 'sec')).statusCode).toBe(200)
    const list = (await get('/records', 'eng')).json().records.map((r: { id: string }) => r.id)
    expect(list).not.toContain('keys')
    expect(
      (await get('/records', 'sec')).json().records.map((r: { id: string }) => r.id),
    ).toContain('keys')
    // Linking to a record you cannot see fails the same way as linking to one that does not exist.
    const hidden = await send('PATCH', '/items/d2', 'chen', { recordId: 'keys' })
    const missing = await send('PATCH', '/items/d2', 'chen', { recordId: 'nope' })
    expect(hidden.statusCode).toBe(400)
    expect(hidden.json()).toEqual(missing.json())
  })

  it('creating needs membership of the home team and valid values', async () => {
    const make = (user: string, teamId: string, values: object) =>
      send('POST', '/records', user, { typeKey: 'dataset', teamId, title: 'Crop yield', values })
    expect((await make('eng', 'DATA', { source: 'Agri' })).statusCode).toBe(403)
    expect((await make('rev', 'DATA', { source: 'Agri' })).statusCode).toBe(403)
    expect((await make('chen', 'DATA', {})).json()).toEqual({
      error: 'required_missing',
      field: 'source',
    })
    const made = await make('chen', 'DATA', { source: 'Agri' })
    expect(made.statusCode).toBe(200)
    expect(made.json().record).toMatchObject({
      teamId: 'DATA',
      title: 'Crop yield',
      archived: false,
    })
    expect(made.json().history[0]).toMatchObject({ actorId: 'chen', action: 'created' })
  })

  it('example 6: archiving is for team admins; archived records cannot be edited or linked', async () => {
    expect((await send('POST', '/records/rain/archive', 'chen')).statusCode).toBe(403)
    const archived = await send('POST', '/records/rain/archive', 'grace')
    expect(archived.json().record.archived).toBe(true)
    expect((await send('POST', '/records/rain/archive', 'grace')).json().error).toBe('archived')
    expect((await send('PATCH', '/records/rain', 'grace', { title: 'x' })).json().error).toBe(
      'archived',
    )
    // Linked items still show it; it is gone from lists and cannot be linked afresh.
    expect((await get('/items/d1/record', 'chen')).json().record.archived).toBe(true)
    expect(
      (await get('/records', 'chen')).json().records.map((r: { id: string }) => r.id),
    ).not.toContain('rain')
    expect((await send('PATCH', '/items/d2', 'chen', { recordId: 'rain' })).statusCode).toBe(200)
    expect((await send('PATCH', '/items/d2', 'chen', { recordId: null })).statusCode).toBe(200)
    expect((await send('PATCH', '/items/d2', 'chen', { recordId: 'rain' })).statusCode).toBe(400)
  })
})
