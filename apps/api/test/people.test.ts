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
      ('ana', 'Ana', 'member'), ('ben', 'Ben', 'member'), ('boss', 'Boss', 'org_admin');
    INSERT INTO teams (id, key, name, is_private) VALUES
      ('OPEN', 'OPEN', 'Open', false), ('PRIV', 'PRIV', 'Private', true);
    INSERT INTO team_members (team_id, user_id, role) VALUES
      ('OPEN', 'ana', 'admin'), ('OPEN', 'ben', 'member'), ('PRIV', 'ben', 'member');
  `)
  app = buildApp({ db, devAuth: true })
  await app.ready()
})

afterAll(async () => {
  await app.close()
})

const people = async (user: string) =>
  (await app.inject({ method: 'GET', url: '/people', headers: { 'x-dev-user': user } })).json()
    .people as { id: string; teams: { teamId: string; role: string }[] }[]

describe('people', () => {
  it('lists everyone with the teams the caller can see', async () => {
    const forBen = await people('ben')
    expect(forBen.find((p) => p.id === 'ben')?.teams).toEqual([
      { teamId: 'OPEN', role: 'member' },
      { teamId: 'PRIV', role: 'member' },
    ])
  })

  it('never shows a private team the caller cannot see', async () => {
    const forAna = await people('ana')
    expect(forAna.find((p) => p.id === 'ben')?.teams).toEqual([{ teamId: 'OPEN', role: 'member' }])
    expect(JSON.stringify(forAna)).not.toContain('PRIV')
  })

  it('needs a signed-in caller', async () => {
    expect((await app.inject({ method: 'GET', url: '/people' })).statusCode).toBe(401)
  })
})
