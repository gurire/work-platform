/**
 * People (redesign step 6): who is in which team. Memberships of teams the caller cannot see
 * are left out, so a private team never shows up through its members (permission matrix,
 * principle 5).
 */
import type { FastifyInstance } from 'fastify'
import { decide } from '@wm/shared'
import type { Db } from '../db/db.js'
import { resolvePrincipal } from '../principal.js'

export function registerPeopleRoutes(
  app: FastifyInstance,
  { db, devAuth }: { db: Db; devAuth: boolean },
): void {
  app.get('/people', async (request, reply) => {
    const principal = await resolvePrincipal(db, request, devAuth)
    if (!principal) return reply.code(401).send({ error: 'unauthenticated' })
    const teams = await db.query<{ id: string; is_private: boolean }>(
      'SELECT id, is_private FROM teams',
    )
    const visible = new Set(
      teams
        .filter(
          (team) =>
            decide(principal, 'item.view', { team: { id: team.id, isPrivate: team.is_private } })
              .allowed,
        )
        .map((team) => team.id),
    )
    const users = await db.query<{ id: string; name: string; org_role: string }>(
      'SELECT id, name, org_role FROM users ORDER BY name',
    )
    const members = await db.query<{ user_id: string; team_id: string; role: string }>(
      'SELECT user_id, team_id, role FROM team_members ORDER BY team_id',
    )
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
