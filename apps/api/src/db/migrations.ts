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
  {
    // Comments, mentions and the inbox (specs/comments.md). Expand only: new tables.
    id: '0008_comments',
    sql: `
      CREATE TABLE comments (
        id          bigserial PRIMARY KEY,
        item_id     text NOT NULL REFERENCES work_items (id),
        author_id   text NOT NULL REFERENCES users (id),
        body        text NOT NULL,
        internal    boolean NOT NULL DEFAULT false,
        created_at  timestamptz NOT NULL DEFAULT now(),
        edited_at   timestamptz,
        deleted_at  timestamptz,
        deleted_by  text REFERENCES users (id)
      );
      CREATE INDEX comments_item ON comments (item_id, id);
      -- Every earlier version of an edited or deleted comment (rules 2.3 and 2.4).
      CREATE TABLE comment_versions (
        seq         bigserial PRIMARY KEY,
        comment_id  bigint NOT NULL REFERENCES comments (id),
        body        text NOT NULL,
        replaced_by text NOT NULL REFERENCES users (id),
        replaced_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE inbox (
        id          bigserial PRIMARY KEY,
        user_id     text NOT NULL REFERENCES users (id),
        kind        text NOT NULL CHECK (kind IN ('mentioned', 'assigned', 'review_requested',
          'review_approved', 'review_changes_requested', 'commented')),
        item_id     text NOT NULL REFERENCES work_items (id),
        actor_id    text REFERENCES users (id),
        comment_id  bigint REFERENCES comments (id),
        created_at  timestamptz NOT NULL DEFAULT now(),
        read_at     timestamptz
      );
      CREATE INDEX inbox_user ON inbox (user_id, id DESC);
    `,
  },
  {
    // Dashboards (specs/dashboards.md, section 4). Expand only: a new nullable column.
    // Null means "use the starting kind", worked out from the stage's category and name.
    id: '0009_stage_kind',
    sql: `
      ALTER TABLE stages ADD COLUMN kind text
        CHECK (kind IN ('waiting', 'working', 'review', 'release'));
    `,
  },
  {
    // Sign-in (specs/sign-in.md, section 2). Expand only: two new nullable columns.
    id: '0010_sign_in',
    sql: `
      ALTER TABLE users ADD COLUMN email text;
      ALTER TABLE users ADD COLUMN auth_subject text;
      CREATE UNIQUE INDEX users_email ON users (lower(email)) WHERE email IS NOT NULL;
      CREATE UNIQUE INDEX users_auth_subject ON users (auth_subject) WHERE auth_subject IS NOT NULL;
    `,
  },
  {
    // Core model of the restart (docs/adr/0008-restart.md, specs/data-model.md). Expand only:
    // new tables and new columns; the old columns keep working until the old screens are gone.
    id: '0011_core_model',
    sql: `
      ALTER TABLE stages ADD COLUMN stage_type text
        CHECK (stage_type IN ('waiting', 'doing', 'review', 'done'));
      ALTER TABLE stages ADD COLUMN done_outcome text
        CHECK (done_outcome IN ('completed', 'cancelled'));
      UPDATE stages SET stage_type = CASE
          WHEN category = 'todo' THEN 'waiting'
          WHEN category IN ('done', 'cancelled') THEN 'done'
          WHEN kind = 'review' OR review_send_back_to IS NOT NULL OR name ~* '(review|approval|qa)' THEN 'review'
          WHEN kind = 'waiting' THEN 'waiting'
          ELSE 'doing' END,
        done_outcome = CASE category WHEN 'done' THEN 'completed' WHEN 'cancelled' THEN 'cancelled' END;

      CREATE OR REPLACE FUNCTION add_default_stages() RETURNS trigger AS $fn$
      BEGIN
        INSERT INTO stages (team_id, key, name, category, position, stage_type, done_outcome) VALUES
          (NEW.id, 'backlog', 'Backlog', 'todo', 1, 'waiting', NULL),
          (NEW.id, 'todo', 'To do', 'todo', 2, 'waiting', NULL),
          (NEW.id, 'in_progress', 'In progress', 'in_progress', 3, 'doing', NULL),
          (NEW.id, 'in_review', 'In review', 'in_progress', 4, 'review', NULL),
          (NEW.id, 'done', 'Done', 'done', 5, 'done', 'completed'),
          (NEW.id, 'cancelled', 'Cancelled', 'cancelled', 6, 'done', 'cancelled');
        RETURN NEW;
      END;
      $fn$ LANGUAGE plpgsql;

      -- Older code paths still add stages without a type; work it out for them.
      CREATE FUNCTION fill_stage_type() RETURNS trigger AS $fn$
      BEGIN
        IF NEW.stage_type IS NULL THEN
          NEW.stage_type := CASE
            WHEN NEW.category = 'todo' THEN 'waiting'
            WHEN NEW.category IN ('done', 'cancelled') THEN 'done'
            WHEN NEW.kind = 'review' OR NEW.review_send_back_to IS NOT NULL OR NEW.name ~* '(review|approval|qa)' THEN 'review'
            ELSE 'doing' END;
        END IF;
        IF NEW.stage_type = 'done' AND NEW.done_outcome IS NULL THEN
          NEW.done_outcome := CASE WHEN NEW.category = 'cancelled' THEN 'cancelled' ELSE 'completed' END;
        END IF;
        RETURN NEW;
      END;
      $fn$ LANGUAGE plpgsql;
      CREATE TRIGGER stages_fill_type BEFORE INSERT ON stages
        FOR EACH ROW EXECUTE FUNCTION fill_stage_type();

      ALTER TABLE teams ADD COLUMN estimate_unit text NOT NULL DEFAULT 'hours'
        CHECK (estimate_unit IN ('hours', 'points'));
      ALTER TABLE teams ADD COLUMN weekly_capacity integer NOT NULL DEFAULT 30
        CHECK (weekly_capacity BETWEEN 1 AND 168);
      -- Item numbers only go up and are never reused (rule 6).
      ALTER TABLE teams ADD COLUMN item_seq integer NOT NULL DEFAULT 0;
      UPDATE teams t SET item_seq = COALESCE((
        SELECT max(substring(w.key FROM '[0-9]+$')::int) FROM work_items w WHERE w.team_id = t.id
      ), 0);

      CREATE TABLE projects (
        id           text PRIMARY KEY,
        name         text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
        colour       integer NOT NULL CHECK (colour BETWEEN 1 AND 8),
        owner_id     text NOT NULL REFERENCES users (id),
        starts_on    date,
        ends_on      date,
        archived_at  timestamptz,
        created_at   timestamptz NOT NULL DEFAULT now(),
        updated_at   timestamptz NOT NULL DEFAULT now(),
        deleted_at   timestamptz
      );
      CREATE TABLE milestones (
        id          text PRIMARY KEY,
        project_id  text NOT NULL REFERENCES projects (id),
        name        text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
        due_on      date,
        position    integer NOT NULL DEFAULT 0,
        done_on     date,
        created_at  timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX milestones_project ON milestones (project_id, position);

      ALTER TABLE work_items ADD COLUMN project_id text REFERENCES projects (id);
      ALTER TABLE work_items ADD COLUMN milestone_id text REFERENCES milestones (id);
      ALTER TABLE work_items ADD COLUMN due_on date;
      ALTER TABLE work_items ADD COLUMN estimate integer CHECK (estimate BETWEEN 0 AND 10000);
      ALTER TABLE work_items ADD COLUMN labels text[] NOT NULL DEFAULT '{}';
      CREATE INDEX work_items_project ON work_items (project_id) WHERE project_id IS NOT NULL;
      CREATE INDEX work_items_parent ON work_items (parent_id) WHERE parent_id IS NOT NULL;

      -- Field library (team_id null) and team fields (rules 15–18). Values live in work_items.fields.
      CREATE TABLE field_defs (
        id          text PRIMARY KEY,
        team_id     text REFERENCES teams (id),
        key         text NOT NULL CHECK (key ~ '^[a-z][a-z0-9_]{0,39}$'),
        label       text NOT NULL CHECK (length(label) BETWEEN 1 AND 60),
        type        text NOT NULL CHECK (type IN ('short_text', 'long_text', 'number', 'date',
                      'pick_one', 'pick_many', 'person', 'link')),
        options     jsonb NOT NULL DEFAULT '[]',
        position    integer NOT NULL DEFAULT 0,
        created_at  timestamptz NOT NULL DEFAULT now()
      );
      CREATE UNIQUE INDEX field_defs_library_key ON field_defs (key) WHERE team_id IS NULL;
      CREATE UNIQUE INDEX field_defs_team_key ON field_defs (team_id, key) WHERE team_id IS NOT NULL;
      CREATE TABLE team_field_settings (
        team_id   text NOT NULL REFERENCES teams (id),
        field_id  text NOT NULL REFERENCES field_defs (id),
        enabled   boolean NOT NULL,
        PRIMARY KEY (team_id, field_id)
      );
      INSERT INTO field_defs (id, team_id, key, label, type, options, position) VALUES
        ('lib-reviewers', NULL, 'reviewers', 'Reviewers', 'person', '[]', 1),
        ('lib-source', NULL, 'source', 'Source', 'short_text', '[]', 2),
        ('lib-frequency', NULL, 'frequency', 'Frequency', 'pick_one', '["Monthly","Quarterly","Yearly"]', 3);
    `,
  },
  {
    // Working together (ADR 0008 phase 3): recurring runs, descriptions, attachments, search,
    // and new inbox kinds. Expand only.
    id: '0012_working_together',
    sql: `
      ALTER TABLE work_items ADD COLUMN description text CHECK (length(description) <= 20000);
      ALTER TABLE work_items ADD COLUMN current_run integer;
      ALTER TABLE stage_history ADD COLUMN run_number integer;
      ALTER TABLE comments ADD COLUMN run_number integer;

      CREATE TABLE item_schedules (
        item_id        text PRIMARY KEY REFERENCES work_items (id),
        rule           jsonb NOT NULL,
        start_stage    text NOT NULL,
        owner_id       text REFERENCES users (id),
        tz             text NOT NULL DEFAULT 'Asia/Kolkata',
        next_at        timestamptz NOT NULL,
        pending_start  boolean NOT NULL DEFAULT false,
        created_by     text NOT NULL REFERENCES users (id),
        created_at     timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX item_schedules_due ON item_schedules (next_at);
      CREATE TABLE item_runs (
        item_id       text NOT NULL REFERENCES work_items (id),
        number        integer NOT NULL,
        started_at    timestamptz NOT NULL DEFAULT now(),
        started_by    text NOT NULL CHECK (started_by IN ('schedule', 'manual')),
        starter_id    text REFERENCES users (id),
        start_stage   text NOT NULL,
        ended_at      timestamptz,
        outcome       text CHECK (outcome IN ('completed', 'cancelled')),
        field_values  jsonb,
        PRIMARY KEY (item_id, number)
      );

      -- Stage passes and comments belong to the item's current run, if it has one.
      CREATE FUNCTION tag_current_run() RETURNS trigger AS $fn$
      BEGIN
        IF NEW.run_number IS NULL THEN
          SELECT current_run INTO NEW.run_number FROM work_items WHERE id = NEW.item_id;
        END IF;
        RETURN NEW;
      END;
      $fn$ LANGUAGE plpgsql;
      CREATE TRIGGER stage_history_run BEFORE INSERT ON stage_history
        FOR EACH ROW EXECUTE FUNCTION tag_current_run();
      CREATE TRIGGER comments_run BEFORE INSERT ON comments
        FOR EACH ROW EXECUTE FUNCTION tag_current_run();

      -- A run ends when its item reaches a Done stage; it keeps the field values of that moment.
      CREATE FUNCTION end_run_on_done() RETURNS trigger AS $fn$
      DECLARE
        stype text;
        outcome_ text;
      BEGIN
        SELECT s.stage_type, s.done_outcome INTO stype, outcome_
          FROM work_items w JOIN stages s ON s.team_id = w.team_id AND s.key = NEW.stage_key
          WHERE w.id = NEW.item_id;
        IF stype = 'done' AND NEW.run_number IS NOT NULL THEN
          UPDATE item_runs r SET ended_at = now(), outcome = COALESCE(outcome_, 'completed'),
            field_values = jsonb_build_object('fields', w.fields, 'dueOn', w.due_on,
              'estimate', w.estimate, 'labels', to_jsonb(w.labels), 'ownerId', w.assignee_id)
          FROM work_items w
          WHERE w.id = NEW.item_id AND r.item_id = NEW.item_id AND r.number = NEW.run_number
            AND r.ended_at IS NULL;
        END IF;
        RETURN NEW;
      END;
      $fn$ LANGUAGE plpgsql;
      CREATE TRIGGER stage_history_end_run AFTER INSERT ON stage_history
        FOR EACH ROW EXECUTE FUNCTION end_run_on_done();

      CREATE TABLE attachments (
        id            text PRIMARY KEY,
        item_id       text NOT NULL REFERENCES work_items (id),
        name          text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
        content_type  text NOT NULL,
        size_bytes    integer NOT NULL CHECK (size_bytes BETWEEN 1 AND 26214400),
        storage_key   text NOT NULL,
        uploaded_by   text NOT NULL REFERENCES users (id),
        created_at    timestamptz NOT NULL DEFAULT now(),
        deleted_at    timestamptz
      );
      CREATE INDEX attachments_item ON attachments (item_id);

      CREATE INDEX work_items_search ON work_items
        USING gin (to_tsvector('simple', title || ' ' || coalesce(description, '')));
      CREATE INDEX comments_search ON comments USING gin (to_tsvector('simple', body));

      ALTER TABLE inbox DROP CONSTRAINT inbox_kind_check;
      ALTER TABLE inbox ADD CONSTRAINT inbox_kind_check CHECK (kind IN ('mentioned', 'assigned',
        'review_requested', 'review_approved', 'review_changes_requested', 'commented',
        'run_started', 'run_blocked', 'request_new', 'request_update'));
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
