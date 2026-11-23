import { Kysely, type Generated } from 'kysely'
import type { Db } from './db.js'

/**
 * Table shapes for typed queries. Add a table here when code starts querying it with Kysely;
 * the migrations in migrations.ts stay the source of truth for the schema.
 */
export interface UsersTable {
  id: string
  name: string
  org_role: 'org_admin' | 'member' | 'viewer'
}

export interface TeamsTable {
  id: string
  key: string
  name: string
  is_private: Generated<boolean>
}

export interface TeamMembersTable {
  team_id: string
  user_id: string
  role: 'admin' | 'member'
}

export interface Database {
  users: UsersTable
  teams: TeamsTable
  team_members: TeamMembersTable
}

export type Sql = Kysely<Database>

/** A typed query builder over the same connection as `db`. */
export function createKysely(db: Db): Sql {
  return new Kysely<Database>({ dialect: db.dialect() })
}
