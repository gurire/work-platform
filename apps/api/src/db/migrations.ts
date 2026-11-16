import type { Db } from './db.js'

/**
 * Forward-only migrations, applied in order. Never edit a migration that has shipped; add a
 * new one. Schema changes follow expand/contract so a half-finished change cannot block a deploy.
 */
const MIGRATIONS: readonly { id: string; sql: string }[] = [
  {
    id: '0001_core',
    sql: `
      CREATE TABLE users (
        id        text PRIMARY KEY,
        name      text NOT NULL,
        org_role  text NOT NULL CHECK (org_role IN ('org_admin', 'member', 'viewer'))
      );
      CREATE TABLE teams (
        id          text PRIMARY KEY,
        key         text NOT NULL UNIQUE,
        name        text NOT NULL,
        is_private  boolean NOT NULL DEFAULT false
      );
      CREATE TABLE team_members (
        team_id  text NOT NULL REFERENCES teams (id),
        user_id  text NOT NULL REFERENCES users (id),
        role     text NOT NULL CHECK (role IN ('admin', 'member')),
        PRIMARY KEY (team_id, user_id)
      );
      CREATE TABLE work_items (
        seq              bigserial PRIMARY KEY,
        id               text NOT NULL UNIQUE,
        key              text NOT NULL UNIQUE,
        kind             text NOT NULL,
        title            text NOT NULL,
        status_id        text NOT NULL,
        status_category  text NOT NULL,
        team_id          text NOT NULL REFERENCES teams (id),
        parent_id        text,
        client_id        text,
        assignee_id      text REFERENCES users (id),
        created_by       text REFERENCES users (id),
        created_at       timestamptz NOT NULL DEFAULT now(),
        updated_at       timestamptz NOT NULL DEFAULT now(),
        deleted_at       timestamptz,
        fields           jsonb NOT NULL DEFAULT '{}'
      );
      CREATE INDEX work_items_team_seq ON work_items (team_id, seq);
      CREATE INDEX work_items_assignee ON work_items (assignee_id);
      CREATE TABLE audit_log (
        seq         bigserial PRIMARY KEY,
        at          timestamptz NOT NULL DEFAULT now(),
        actor_id    text NOT NULL,
        action      text NOT NULL,
        team_id     text,
        object_id   text,
        detail      jsonb NOT NULL DEFAULT '{}'
      );
    `,
  },
]

export async function migrate(db: Db): Promise<string[]> {
  await db.exec(
    'CREATE TABLE IF NOT EXISTS schema_migrations (id text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())',
  )
  const done = new Set(
    (await db.query<{ id: string }>('SELECT id FROM schema_migrations')).map((row) => row.id),
  )
  const applied: string[] = []
  for (const migration of MIGRATIONS) {
    if (done.has(migration.id)) continue
    await db.exec(`BEGIN; ${migration.sql}; COMMIT;`)
    await db.query('INSERT INTO schema_migrations (id) VALUES ($1)', [migration.id])
    applied.push(migration.id)
  }
  return applied
}
