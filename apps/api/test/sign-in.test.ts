import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../src/app.js'
import { createPgliteDb, type Db } from '../src/db/db.js'
import { migrate } from '../src/db/migrations.js'
import type { IdClaims } from '../src/auth.js'

// Stand-in for Cognito: each "token" names the claims it carries. The real check (signature,
// issuer, audience, expiry) is aws-jwt-verify's; here we test what the API does with it.
const TOKENS: Record<string, IdClaims> = {
  priya: { sub: 'sub-priya', email: 'Priya@Example.org', emailVerified: true },
  'priya-renamed': { sub: 'sub-priya', email: 'p.k@example.org', emailVerified: true },
  stranger: { sub: 'sub-x', email: 'nobody@example.org', emailVerified: true },
  unverified: { sub: 'sub-u', email: 'ben@example.org', emailVerified: false },
}

let db: Db
let app: FastifyInstance
const me = (headers: Record<string, string>) => app.inject({ method: 'GET', url: '/me', headers })

beforeAll(async () => {
  db = await createPgliteDb()
  await migrate(db)
  await db.exec(`
    INSERT INTO users (id, name, org_role, email) VALUES
      ('priya', 'Priya K', 'member', 'priya@example.org'),
      ('ben', 'Ben O', 'member', 'ben@example.org');
  `)
  app = buildApp({
    db,
    devAuth: false,
    verifyIdToken: async (token) => {
      const claims = TOKENS[token]
      if (!claims) throw new Error('invalid token')
      return claims
    },
  })
  await app.ready()
})

afterAll(async () => {
  await app.close()
})

describe('sign-in (specs/sign-in.md)', () => {
  it('example 1: the first sign-in links the account by verified email, any case', async () => {
    const res = await me({ authorization: 'Bearer priya' })
    expect(res.statusCode).toBe(200)
    expect(res.json().id).toBe('priya')
    const row = await db.query<{ auth_subject: string }>(
      "SELECT auth_subject FROM users WHERE id = 'priya'",
    )
    expect(row[0]?.auth_subject).toBe('sub-priya')
  })

  it('example 3: later sign-ins follow the sub, even after an email change', async () => {
    const res = await me({ authorization: 'Bearer priya-renamed' })
    expect(res.json().id).toBe('priya')
  })

  it('example 2: no invited user, or an unverified email, is refused with 403', async () => {
    expect((await me({ authorization: 'Bearer stranger' })).statusCode).toBe(403)
    expect((await me({ authorization: 'Bearer unverified' })).statusCode).toBe(403)
    const ben = await db.query<{ auth_subject: string | null }>(
      "SELECT auth_subject FROM users WHERE id = 'ben'",
    )
    expect(ben[0]?.auth_subject).toBeNull()
  })

  it('example 4: a bad or malformed token is 401', async () => {
    expect((await me({ authorization: 'Bearer forged' })).statusCode).toBe(401)
    expect((await me({ authorization: 'Basic abc' })).statusCode).toBe(401)
  })

  it('development sign-in is off when Cognito is on', async () => {
    expect((await me({ 'x-dev-user': 'ben' })).statusCode).toBe(401)
  })
})
