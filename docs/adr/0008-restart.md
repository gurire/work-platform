# 0008: Restart on the same base, with a simpler model and the Midnight look

Status: proposed (2026-11-23). Merging this file to `main` accepts it.

## Context

On 22 Nov 2026 the owner paused feature work and re-thought the product from the ground up
through 19 rounds of questions. The result is the concept brief WP-BRIEF-002
(https://claude.ai/artifact/1jdNEPT78kMP1qLLArHV3n), the approved wireframes and the Midnight
visual direction (https://claude.ai/artifact/RoXokgBuwJ5YSfAVHghgXr), and the draft spec
`specs/design-system.md`. On 23 Nov 2026 the owner chose to keep the existing repository as the
base and rebuild the features on it.

## Decision

1. **Keep the base.** The pnpm workspace, the checks (`pnpm check`), the ship script, the CDK
   app with its Cognito sign-in stack, the Fastify API and the React + Vite web app stay. The
   old item model and screens are replaced branch by branch, with expand-then-contract
   migrations.
2. **Audience.** One organisation, about 40 people in 2–3 teams at first, four kinds of work:
   staged data pipelines, software, operations and events, internal requests. This replaces the
   three audiences of ADR 0003 (engineering, service desk, client delivery); one item model for
   everything still holds.
3. **Model.** Project → item → sub-item, with milestones inside projects. Every item belongs to
   exactly one team and moves through that team's stages. Every stage has one of four **stage
   types**: Waiting, Doing, Review, Done. These replace the status categories of ADR 0007
   (`todo`, `in_progress`, `done`, `cancelled`). Details: `specs/data-model.md`.
4. **Recurring items run again instead of being copied.** One item keeps numbered runs, each
   with its own dates, stage owners, comments and field values.
5. **Dropped or moved later from ADR 0007:** records beside items and status that follows the
   code are out of the first version. Stage owners, allowed moves, reviews, and stage limits
   stay.
6. **Out of scope for now:** money, rates, retainers and SLA calendars (ADR 0004 and the planned
   `money-and-time.md` and `sla-calendars.md`), clients outside the company, and several
   organisations.
7. **Stack additions** from the brief: Kysely with real PostgreSQL (Amazon RDS, ap-south-1);
   live updates over WebSockets from the API, so the API runs on ECS Fargate behind a load
   balancer; pg-boss for scheduled runs and reminders; S3 for attachments.
8. **Look.** Midnight: cool zinc neutrals, electric indigo accent, dark by default with a light
   mode, fixed status colours. Details: `specs/design-system.md`.
9. **Go-live** for the first team in weeks 9–10. Release 2 (weeks 10–16): full Jira import,
   timeline view, private teams and projects, desktop app.

## Consequences

- New specs before code: `data-model.md` (this change), then updates the owner makes to
  `workflow.md`, `reviews.md` and `permission-matrix.md` so they use stage types and the new
  roles.
- `records.md` and `code-status.md` are parked; their code is not built in the first version.
- The old in-memory database layer is replaced by Kysely and migrations; tests keep running
  against an embedded PostgreSQL so they need no server.
- The web app is rebuilt on the Midnight tokens and component kit; the old screens are
  removed once the new ones cover them.

## Changes the existing specs will need (owner to decide; specs are not edited here)

1. `workflow.md`: replace categories with the four stage types; keep requirements, allowed
   moves and forced moves.
2. `reviews.md`: approvals needed per Review stage ("any one reviewer" or "all reviewers"), and
   which stage "send back" returns to.
3. `permission-matrix.md`: everyone reads everything in the first version; members edit their
   own team's items; team admins configure their team; the owner is admin everywhere.
