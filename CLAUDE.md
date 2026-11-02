# Work Platform

In-house work management for engineering, client delivery and the IT service desk.
TypeScript monorepo (pnpm), self-hosted on AWS via CDK. Dev and prod live in one AWS account.

## Layout

- `packages/shared`: domain types and helpers used by every app (work items, money).
- `apps/api`: Fastify API. `apps/web`: React + Vite desktop web app. `apps/mobile`: not started.
- `infra`: CDK app. `AccessStack` (deploy + view roles, deployed once), `AppStage` × Dev/Prod.
- `specs/`: human-owned specs. `docs/adr/`: architecture decisions. `docs/setup/`: setup guides.

## Commands

- `pnpm install`, then `pnpm check` runs everything CI runs (lint, format, typecheck, test, build, synth, licences).
- `pnpm --filter @wm/api dev` / `pnpm --filter @wm/web dev` for local servers.

## Rules

- Money is integer minor units via `@wm/shared` money helpers. Never floats. Durations are integer minutes.
- Every read path (API, sync, search, export, MCP, AI features) must go through the single
  permission layer once it exists. Never query the database or search index around it.
- `specs/` and any `test/protected/` folder are owned by humans. Do not change them to make code pass;
  if a spec looks wrong, say so.
- Keep changes small enough to finish, test and push in one session. Push after every green step.
- Database changes use expand/contract migrations so a half-finished change never blocks a deploy.
- Never deploy from a session. Dev deploys from `main` via GitHub Actions; prod is a manual, approved run.
- No AWS credentials, `.env` files or real client/Jira data in sessions. Use generated sample data.
- New dependencies: prefer well-known packages, check the name carefully, and keep `pnpm check:licenses` green.
- When a change alters a design decision, update or add an ADR in the same PR.
