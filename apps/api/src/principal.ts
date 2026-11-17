import type { FastifyRequest } from 'fastify'
import type { OrgRole, TeamRole, UserPrincipal } from '@wm/shared'
import type { Db } from './db/db.js'
import './auth.js'

export async function loadUserPrincipal(db: Db, userId: string): Promise<UserPrincipal | null> {
  const users = await db.query<{ id: string; org_role: OrgRole }>(
    'SELECT id, org_role FROM users WHERE id = $1',
    [userId],
  )
  const user = users[0]
  if (!user) return null
  const memberships = await db.query<{ team_id: string; role: TeamRole }>(
    'SELECT team_id, role FROM team_members WHERE user_id = $1',
    [userId],
  )
  return {
    kind: 'user',
    id: user.id,
    orgRole: user.org_role,
    teams: Object.fromEntries(memberships.map((m) => [m.team_id, m.role])),
  }
}

/**
 * Who is calling. A Cognito ID token (checked in auth.ts before routes run) wins.
 *
 * DEVELOPMENT-ONLY fallback: the caller names a user in the `x-dev-user` header. It is off
 * unless `devAuth` is set, which `server.ts` only does when no Cognito settings are given and
 * never in production (specs/sign-in.md, section 4).
 */
export async function resolvePrincipal(
  db: Db,
  request: FastifyRequest,
  devAuth: boolean,
): Promise<UserPrincipal | null> {
  if (request.authUserId) return loadUserPrincipal(db, request.authUserId)
  if (!devAuth) return null
  const header = request.headers['x-dev-user']
  if (typeof header !== 'string' || header.length === 0) return null
  return loadUserPrincipal(db, header)
}
