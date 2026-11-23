/**
 * Sign-in with Amazon Cognito (specs/sign-in.md). The API trusts a request when it carries a
 * valid Cognito ID token, and links the token to a Work Platform user (section 2).
 */
import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { Db } from './db/db.js'

/** What the API needs from a checked ID token. */
export interface IdClaims {
  readonly sub: string
  readonly email?: string | undefined
  readonly emailVerified?: boolean | undefined
}

/** Checks signature, issuer, audience, expiry and token use; throws if any fails. */
export type IdTokenVerifier = (token: string) => Promise<IdClaims>

declare module 'fastify' {
  interface FastifyRequest {
    /** Set when a valid Cognito token named an invited user. */
    authUserId?: string
  }
}

/** Find the user for these claims, linking by verified email on first sign-in (section 2). */
export async function userForClaims(db: Db, claims: IdClaims): Promise<string | null> {
  const bySub = await db.query<{ id: string }>('SELECT id FROM users WHERE auth_subject = $1', [
    claims.sub,
  ])
  if (bySub[0]) return bySub[0].id
  if (!claims.email || claims.emailVerified !== true) return null
  const linked = await db.query<{ id: string }>(
    `UPDATE users SET auth_subject = $1
     WHERE lower(email) = lower($2) AND auth_subject IS NULL
     RETURNING id`,
    [claims.sub, claims.email],
  )
  return linked[0]?.id ?? null
}

/** Rejects bad tokens (401) and people who were not invited (403) before any route runs. */
export function registerAuth(app: FastifyInstance, db: Db, verify: IdTokenVerifier): void {
  app.addHook('onRequest', async (request: FastifyRequest, reply) => {
    // Browsers cannot set headers on a WebSocket, so the live channel takes the token in the address.
    const liveToken =
      request.url.startsWith('/live') &&
      typeof (request.query as Record<string, unknown> | undefined)?.['token'] === 'string'
        ? `Bearer ${String((request.query as Record<string, unknown>)['token'])}`
        : undefined
    const header = request.headers.authorization ?? liveToken
    if (!header) return
    const match = /^Bearer (.+)$/.exec(header)
    if (!match?.[1]) return reply.code(401).send({ error: 'unauthenticated' })
    let claims: IdClaims
    try {
      claims = await verify(match[1])
    } catch {
      return reply.code(401).send({ error: 'unauthenticated' })
    }
    const userId = await userForClaims(db, claims)
    if (!userId) return reply.code(403).send({ error: 'not_invited' })
    request.authUserId = userId
  })
}
