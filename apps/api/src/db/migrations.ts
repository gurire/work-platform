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
  {
    // Stages (ADR 0007, step 1). An item's status_id is the key of a stage in its team.
    id: '0002_stages',
    sql: `
      ALTER TABLE teams ADD COLUMN hand_off_clears_owner boolean NOT NULL DEFAULT false;
      CREATE TABLE stages (
        team_id   text NOT NULL REFERENCES teams (id),
        key       text NOT NULL,
        name      text NOT NULL,
        category  text NOT NULL CHECK (category IN ('todo', 'in_progress', 'done', 'cancelled')),
        position  integer NOT NULL,
        PRIMARY KEY (team_id, key)
      );
      CREATE TABLE stage_history (
        seq         bigserial PRIMARY KEY,
        item_id     text NOT NULL REFERENCES work_items (id),
        stage_key   text NOT NULL,
        owner_id    text REFERENCES users (id),
        entered_at  timestamptz NOT NULL DEFAULT now(),
        left_at     timestamptz
      );
      CREATE INDEX stage_history_item ON stage_history (item_id, seq);

      -- Every team always has a workflow: a new team starts with the default stages.
      CREATE FUNCTION add_default_stages() RETURNS trigger AS $fn$
      BEGIN
        INSERT INTO stages (team_id, key, name, category, position) VALUES
          (NEW.id, 'backlog', 'Backlog', 'todo', 1),
          (NEW.id, 'todo', 'Todo', 'todo', 2),
          (NEW.id, 'in_progress', 'In Progress', 'in_progress', 3),
          (NEW.id, 'in_review', 'In Review', 'in_progress', 4),
          (NEW.id, 'done', 'Done', 'done', 5),
          (NEW.id, 'cancelled', 'Cancelled', 'cancelled', 6);
        RETURN NEW;
      END;
      $fn$ LANGUAGE plpgsql;
      CREATE TRIGGER teams_default_stages AFTER INSERT ON teams
        FOR EACH ROW EXECUTE FUNCTION add_default_stages();

      -- Existing teams and items.
      INSERT INTO stages (team_id, key, name, category, position)
        SELECT t.id, s.key, s.name, s.category, s.position
        FROM teams t CROSS JOIN (VALUES
          ('backlog', 'Backlog', 'todo', 1), ('todo', 'Todo', 'todo', 2),
          ('in_progress', 'In Progress', 'in_progress', 3),
          ('in_review', 'In Review', 'in_progress', 4),
          ('done', 'Done', 'done', 5), ('cancelled', 'Cancelled', 'cancelled', 6)
        ) AS s (key, name, category, position);
      INSERT INTO stage_history (item_id, stage_key, owner_id, entered_at)
        SELECT id, status_id, assignee_id, updated_at FROM work_items;
      ALTER TABLE work_items ADD CONSTRAINT work_items_stage
        FOREIGN KEY (team_id, status_id) REFERENCES stages (team_id, key);
    `,
  },
  {
    // Stage rules (specs/workflow.md): requirements, listed moves, and who moved an item and why.
    id: '0003_stage_rules',
    sql: `
      ALTER TABLE stage_history ADD COLUMN moved_by text REFERENCES users (id);
      ALTER TABLE stage_history ADD COLUMN kind text NOT NULL DEFAULT 'move'
        CHECK (kind IN ('move', 'forced', 'reopen'));
      ALTER TABLE stage_history ADD COLUMN reason text;
      CREATE TABLE stage_steps (
        id         bigserial PRIMARY KEY,
        team_id    text NOT NULL,
        stage_key  text NOT NULL,
        label      text NOT NULL,
        position   integer NOT NULL,
        FOREIGN KEY (team_id, stage_key) REFERENCES stages (team_id, key)
      );
      CREATE TABLE stage_required_fields (
        team_id    text NOT NULL,
        stage_key  text NOT NULL,
        field_key  text NOT NULL,
        label      text NOT NULL,
        PRIMARY KEY (team_id, stage_key, field_key),
        FOREIGN KEY (team_id, stage_key) REFERENCES stages (team_id, key)
      );
      CREATE TABLE stage_transitions (
        team_id   text NOT NULL,
        from_key  text NOT NULL,
        to_key    text NOT NULL,
        PRIMARY KEY (team_id, from_key, to_key),
        FOREIGN KEY (team_id, from_key) REFERENCES stages (team_id, key),
        FOREIGN KEY (team_id, to_key) REFERENCES stages (team_id, key)
      );
      -- Append-only: the latest event per step and pass is its current state.
      CREATE TABLE step_events (
        seq          bigserial PRIMARY KEY,
        history_seq  bigint NOT NULL REFERENCES stage_history (seq),
        step_id      bigint NOT NULL REFERENCES stage_steps (id),
        ticked       boolean NOT NULL,
        actor_id     text NOT NULL REFERENCES users (id),
        at           timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX step_events_pass ON step_events (history_seq, step_id, seq);
    `,
  },
  {
    // Review rounds (specs/reviews.md). Expand only: wider checks, new nullable column, new tables.
    id: '0004_reviews',
    sql: `
      ALTER TABLE team_members DROP CONSTRAINT team_members_role_check;
      ALTER TABLE team_members ADD CONSTRAINT team_members_role_check
        CHECK (role IN ('admin', 'member', 'reviewer'));
      ALTER TABLE stage_history DROP CONSTRAINT stage_history_kind_check;
      ALTER TABLE stage_history ADD CONSTRAINT stage_history_kind_check
        CHECK (kind IN ('move', 'forced', 'reopen', 'sent_back'));
      -- A stage with a send-back stage is a review stage.
      ALTER TABLE stages ADD COLUMN review_send_back_to text;
      CREATE TABLE review_rounds (
        id            bigserial PRIMARY KEY,
        item_id       text NOT NULL REFERENCES work_items (id),
        number        integer NOT NULL,
        history_seq   bigint NOT NULL REFERENCES stage_history (seq),
        stage_key     text NOT NULL,
        requested_by  text NOT NULL REFERENCES users (id),
        opened_at     timestamptz NOT NULL DEFAULT now(),
        state         text NOT NULL DEFAULT 'open'
          CHECK (state IN ('open', 'approved', 'changes_requested', 'withdrawn')),
        closed_at     timestamptz,
        closed_by     text REFERENCES users (id),
        UNIQUE (item_id, number)
      );
      -- At most one open round per item (rule 2).
      CREATE UNIQUE INDEX review_rounds_one_open ON review_rounds (item_id) WHERE state = 'open';
      CREATE TABLE review_reviewers (
        round_id  bigint NOT NULL REFERENCES review_rounds (id),
        user_id   text NOT NULL REFERENCES users (id),
        PRIMARY KEY (round_id, user_id)
      );
      -- Append-only (rule 10): the latest verdict per reviewer is the one that counts.
      CREATE TABLE review_verdicts (
        seq       bigserial PRIMARY KEY,
        round_id  bigint NOT NULL REFERENCES review_rounds (id),
        user_id   text NOT NULL REFERENCES users (id),
        verdict   text NOT NULL CHECK (verdict IN ('approved', 'changes_requested')),
        comment   text,
        at        timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX review_verdicts_round ON review_verdicts (round_id, seq);
    `,
  },
  {
    // Records (specs/records.md). Expand only: new tables and a nullable link on work items.
    id: '0005_records',
    sql: `
      CREATE TABLE record_types (
        key         text PRIMARY KEY,
        name        text NOT NULL,
        fields      jsonb NOT NULL DEFAULT '[]'::jsonb,
        created_at  timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE records (
        seq          bigserial UNIQUE,
        id           text PRIMARY KEY,
        type_key     text NOT NULL REFERENCES record_types (key),
        team_id      text NOT NULL REFERENCES teams (id),
        title        text NOT NULL,
        values       jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_by   text REFERENCES users (id),
        created_at   timestamptz NOT NULL DEFAULT now(),
        updated_at   timestamptz NOT NULL DEFAULT now(),
        archived_at  timestamptz
      );
      CREATE INDEX records_team ON records (team_id, type_key);
      -- Append-only (rule 3): who changed which fields, from what, to what.
      CREATE TABLE record_events (
        seq        bigserial PRIMARY KEY,
        record_id  text NOT NULL REFERENCES records (id),
        actor_id   text REFERENCES users (id),
        action     text NOT NULL CHECK (action IN ('created', 'edited', 'archived')),
        changes    jsonb NOT NULL DEFAULT '[]'::jsonb,
        at         timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX record_events_record ON record_events (record_id, seq);
      ALTER TABLE work_items ADD COLUMN record_id text REFERENCES records (id);
      CREATE INDEX work_items_record ON work_items (record_id) WHERE record_id IS NOT NULL;
    `,
  },
  {
    // Stage limits and waiting targets (specs/stage-limits.md). Expand only: nullable columns.
    id: '0006_stage_limits',
    sql: `
      ALTER TABLE stages ADD COLUMN item_limit integer CHECK (item_limit BETWEEN 1 AND 999);
      ALTER TABLE stages ADD COLUMN target_hours integer CHECK (target_hours BETWEEN 1 AND 8760);
      CREATE INDEX stage_history_open ON stage_history (item_id) WHERE left_at IS NULL;
    `,
  },
  {
    // Status that follows the code (specs/code-status.md). Expand only.
    id: '0007_code_status',
    sql: `
      ALTER TABLE stage_history DROP CONSTRAINT stage_history_kind_check;
      ALTER TABLE stage_history ADD CONSTRAINT stage_history_kind_check
        CHECK (kind IN ('move', 'forced', 'reopen', 'sent_back', 'automatic'));
      CREATE TABLE code_rules (
        team_id     text NOT NULL,
        event_kind  text NOT NULL
          CHECK (event_kind IN ('pr_opened', 'checks_passed', 'checks_failed', 'pr_merged', 'pr_closed')),
        stage_key   text NOT NULL,
        PRIMARY KEY (team_id, event_kind),
        FOREIGN KEY (team_id, stage_key) REFERENCES stages (team_id, key)
      );
      CREATE TABLE code_links (
        item_id     text NOT NULL REFERENCES work_items (id),
        repo        text NOT NULL,
        pr_number   integer NOT NULL,
        url         text,
        title       text,
        state       text NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'merged', 'closed')),
        checks      text CHECK (checks IN ('passing', 'failing')),
        updated_at  timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (item_id, repo, pr_number)
      );
      CREATE INDEX code_links_pr ON code_links (repo, pr_number);
      -- Append-only: every event that reached an item, and what it did.
      CREATE TABLE code_events (
        seq         bigserial PRIMARY KEY,
        item_id     text NOT NULL REFERENCES work_items (id),
        repo        text NOT NULL,
        pr_number   integer NOT NULL,
        kind        text NOT NULL,
        outcome     text NOT NULL CHECK (outcome IN ('moved', 'not_moved', 'no_rule')),
        detail      text,
        at          timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX code_events_item ON code_events (item_id, seq);
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
