/**
 * People (redesign step 6): who is in which team. Memberships of teams the caller cannot see
 * are left out, so a private team never shows up through its members (permission matrix,
 * principle 5).
 */
import type { FastifyInstance } from 'fastify'
import { decide } from '@wm/shared'
import type { Db } from '../db/db.js'
import { createKysely } from '../db/kysely.js'
import { resolvePrincipal } from '../principal.js'

export function registerPeopleRoutes(
  app: FastifyInstance,
  { db, devAuth }: { db: Db; devAuth: boolean },
): void {
  const sql = createKysely(db)
  app.get('/people', async (request, reply) => {
    const principal = await resolvePrincipal(db, request, devAuth)
    if (!principal) return reply.code(401).send({ error: 'unauthenticated' })
    const teams = await sql.selectFrom('teams').select(['id', 'is_private']).execute()
    const visible = new Set(
      teams
        .filter(
          (team) =>
            decide(principal, 'item.view', { team: { id: team.id, isPrivate: team.is_private } })
              .allowed,
        )
        .map((team) => team.id),
    )
    const users = await sql
      .selectFrom('users')
      .select(['id', 'name', 'org_role'])
      .orderBy('name')
      .execute()
    const members = await sql
      .selectFrom('team_members')
      .select(['user_id', 'team_id', 'role'])
      .orderBy('team_id')
      .execute()
    return {
      people: users.map((user) => ({
        id: user.id,
        name: user.name,
        orgRole: user.org_role,
        teams: members
          .filter((m) => m.user_id === user.id && visible.has(m.team_id))
          .map((m) => ({ teamId: m.team_id, role: m.role })),
      })),
    }
  })
}
