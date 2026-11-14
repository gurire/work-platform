# Work Platform: project context and handoff

Last updated: 14 Nov 2026. Use this document as the starting context for any new Claude
project or session about this work. It summarises the research, decisions, risks and current
state so far.

---

## 1. What we're building

A custom, in-house work management and tracking platform to replace Jira, with its own
UI/UX and strong performance, built around how the company works.

- **Users:** a company of a few hundred people, in three groups:
  - **Software engineering:** sprints, backlog, bugs, releases, Git/CI links.
  - **Client / service delivery:** time tracking, budgets and billing, client access,
    resource planning.
  - **IT service desk:** tickets, queues, SLAs, customer portal, assets.
- **Platforms:** desktop web (keyboard-first, dense, fast) and mobile (a separate product
  for triage, approvals, quick capture, timers and offline use; not a shrunken desktop).
- **Hosting:** self-hosted on AWS.
- **Builder:** one person (the owner) building mainly with Claude Code, in claude.ai/code
  cloud sessions and in Claude Code on their own PC. GitHub is the source of truth.

## 2. Decisions made

| Topic               | Decision                                                                                                                                                                                                                                                |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Accounts            | **Solo/personal accounts only**, no company accounts: personal Claude plan, personal GitHub, personal AWS account.                                                                                                                                      |
| Claude data setting | "Help improve Claude" is **off** (confirmed by the owner). `/feedback`, `/bug`, `/share` are disabled in the repo.                                                                                                                                      |
| Language / stack    | **TypeScript** throughout: React + Vite (web), Node + Fastify (API), React Native + Expo (mobile, later). pnpm monorepo.                                                                                                                                |
| Infrastructure      | **AWS CDK** (TypeScript).                                                                                                                                                                                                                               |
| AWS layout          | **One AWS account**, with **Dev and Prod as two separate copies** (CDK stages) inside it, separated by name prefix (`wm-dev-` / `wm-prod-`), `env` tag, own VPC/data stores (when added), IAM limits and CI-only prod deploys.                          |
| Existing Jira       | **Jira Cloud.** Only matters for the importer (later) and for keeping the data model Jira-compatible.                                                                                                                                                   |
| AWS MCP             | Yes, used while building: the **AWS Knowledge MCP** (docs, no credentials) everywhere; the **AWS MCP with account access** only on the owner's PC, through a **view-only** role on the dev setup. Never for prod changes. Prod changes only through CI. |
| Data model          | One work item model for all three audiences (kinds: initiative, epic, story, task, bug, request, incident, change, deliverable), with team-specific views.                                                                                              |
| Money / time        | Money as integer minor units with half-even rounding; time as integer minutes.                                                                                                                                                                          |
| Licences            | Permissive dependencies only; GPL/AGPL code (e.g. Plane, OpenProject) used as design reference only, never copied.                                                                                                                                      |

**Still open:** which AWS region (depends on where the owner and users are; matters for
client data residency), and whether the owner's PC is Windows or Mac (for install steps).

## 3. Research summary (October 2026)

Full interactive research page (private to the owner):
https://claude.ai/artifact/SocojHPmfxQQjwrcMUJ3xu

- **Platforms studied in depth (14):** Jira + JSM, Linear, Azure DevOps, GitHub Projects,
  YouTrack, Plane, OpenProject, Asana, monday.com, ClickUp, Notion, Trello, Smartsheet, Wrike.
  Plus lessons from ServiceNow, Freshservice, Zendesk, Teamwork, Productive, Kantata,
  Float/Resource Guru, Redmine, Taiga, Huly.
- **Key findings:**
  1. No single tool serves engineering + delivery + service desk well. Teams stitch together
     Jira + JSM + Tempo + Float. One shared model is the biggest opening.
  2. Speed is the clearest way to stand out. Jira, monday, ClickUp, Notion and Smartsheet
     slow down at scale. Linear's local-first sync engine is the only architecture reviewers
     consistently praise.
  3. Flexibility causes sprawl (Jira, ADO) and simplicity hits a ceiling (Linear, GitHub).
     Nobody combines Linear speed with Jira configurability behind guardrails.
  4. Mobile apps are weak everywhere. Linear's inbox-first app is the exception.
  5. AI is moving to agents as assignees (Jira, Linear, GitHub, Asana), but permissions,
     budgets and audit trails for agents are immature.
  6. Costs creep through tier gating, add-ons, seat minimums and metered AI credits.
  7. **Timing:** Atlassian stopped selling new self-hosted Jira (Data Center) licences in
     March 2026; Data Center becomes read-only on 28 Mar 2029. Linear has no self-hosting.
- **Market-wide weaknesses to beat:** slowness at scale; config sprawl; separate tools
  per team; status-update busywork; notification overload; weak reporting; mobile as a
  shrunken desktop; unpredictable cost.
- **New directions prioritised for this company:**
  - Zero-touch status (items move from Git/CI/deploy events; stale work flagged).
  - Support-hour economics (retainers drawn down by service desk tickets and billable time).
  - AI-drafted, human-approved standups and client reports.
  - Agents as accountable assignees (scopes, budgets, audit trail).
  - Built-in MCP server and work-graph API.
  - Also: customer-signal intake, history-based forecasting, user-controlled notification
    budgets, flow/DORA metrics, guardrailed configuration, focus/WIP signals.
- **Performance architecture direction:** RDS Postgres as source of truth; partial,
  query-driven sync (Zero or ElectricSQL style, not whole-workspace sync); optimistic writes
  with rollback; Yjs CRDTs only for rich text; OpenSearch for search; S3 for attachments.
  Targets: input acknowledged under 100 ms, views under 400 ms, tested at 100k items.

### Feature master list (35 capabilities) and suggested phases

- **MVP:**
  - Typed hierarchy, item types, org-level custom fields, workflows with impact preview,
    query language + saved views, Kanban, sprints/cycles, dashboards.
  - Git/PR/CI integration, queues and request types, SLA engine, time tracking/timesheets,
    guest/client access, approvals, forms/intake, no-code automation.
  - SSO/audit/roles, self-hosting, mobile app, speed at scale.
- **Phase 2:**
  - Timeline/Gantt, portfolio, workload/capacity, flow metrics, releases.
  - Customer portal + KB, ITIL incident/change, budgets/rates/profitability.
  - Docs/wiki, AI assistant, MCP server, offline.
- **Phase 3:** assets/CMDB, proofing, AI agents as assignees.

## 4. Risk review: building mainly with Claude Code

Full verified register (42 risks), private to the owner:
https://claude.ai/artifact/L6bVNogJas8Cp6wJqPtz28

**Main finding:** usage limits are a minor risk. The severe risks all come from one person
plus an AI building business-critical software:

1. Sync-engine bugs that the AI's own tests don't catch.
2. Data leaking between clients, roles or teams (missed permission checks on some path:
   sync, search, export, AI/MCP).
3. Changes too large for one person to review properly.
4. Bus factor of one: one person, one personal account.
5. Fast prototype, slow production hardening.

**Guardrails agreed (adapted for solo accounts):**

1. Personal Claude plan with training off; only made-up sample data in sessions, no real
   client data, IT tickets or Jira exports; spending cap on any extra usage; never leave an
   API key exported.
2. Humans write the critical rules first (permission matrix, sync protocol, SLA calendars,
   money/time, Jira mapping) in `specs/`, turned into protected tests Claude can't edit.
3. No AWS credentials in AI sessions; deploys only through GitHub Actions (OIDC); Claude
   and the AWS MCP use a view-only role.
4. Narrow the first release to one audience; do a full Jira migration dry run early.
5. Small changes, pushed after every passing test; expand/contract database migrations.
6. Architecture rules enforced by CI, short CLAUDE.md, ADRs.
7. Production readiness from week one: performance tests, observability, backups,
   versioned sync protocol for released mobile apps.
8. Before colleagues put real company/client data in, move prod AWS, the repo and app-store
   listings to company ownership (the build is designed so this is a transfer, not a rebuild).

## 5. Current state of the repository

Repo: **https://github.com/gurire/work-platform** (private), branch `main`.
First commit: "Scaffold TypeScript monorepo with CDK infrastructure and guardrails".
GitHub Actions CI passed (lint, format, typecheck, 12 tests, build, CDK synth, licence check,
secret scan). The deploy workflow is dormant until AWS is set up. **Nothing is deployed and
there are no AWS costs yet.**

```
apps/api          Fastify API (/health, /meta/work-item-kinds) + tests
apps/web          React + Vite placeholder app
apps/mobile       README only (not started)
packages/shared   Work item types, money helpers (integer minor units, half-even) + tests
infra             CDK: AccessStack (GitHub OIDC deploy role wm-github-deploy, view-only
                  role wm-claude-dev-view), AppStage x Dev/Prod (attachments S3 bucket)
specs/            Human-owned specs (index only so far)
docs/adr/         0001 stack, 0002 single account two stages, 0003 one work item model,
                  0004 money and time, 0005 licences
docs/setup/       pc-setup.md, aws-first-deploy.md
.claude/          settings.json: deny secrets/.env/~/.aws reads, cdk deploy/destroy,
                  force-push; ask before editing specs/, protected tests, workflows,
                  access stack; SessionEnd hook saves uncommitted work to a wip/ branch
.mcp.json         AWS Knowledge MCP (https://knowledge-mcp.global.api.aws)
```

Key commands: `pnpm install`, `pnpm check` (everything CI runs),
`pnpm --filter @wm/api dev`, `pnpm --filter @wm/web dev`.
Supply-chain guardrail: pnpm refuses package versions younger than 7 days.

**Known follow-ups:**

- Update GitHub Actions versions (checkout, setup-node, pnpm, gitleaks) that target the
  retiring Node 20 runtime.
- Not yet verified: whether the SessionEnd save hook runs when a cloud machine is reclaimed;
  the exact command for the account-access AWS MCP (`docs/setup/pc-setup.md` says to check
  AWS's docs).

## 6. Next steps (in order)

1. **Owner answers:** AWS region; Windows or Mac.
2. **PC setup** (`docs/setup/pc-setup.md`): Node 22 + pnpm, Git, Claude Code, AWS CLI v2,
   uv, Docker (later); clone; run `pnpm check`.
3. **First AWS setup** (`docs/setup/aws-first-deploy.md`, owner runs it, not Claude):
   root MFA, budget alarms, IAM Identity Center admin login (`wm-admin` profile),
   `cdk bootstrap`, `cdk deploy Access`, add `wm-claude-view` profile.
4. **Connect GitHub to AWS:** create `development` and `production` environments; set repo
   variables `AWS_DEPLOY_ROLE_ARN` and `AWS_REGION`.
5. **Write the permission-matrix spec** (who can see/do what, per role, object, action and
   surface) with Claude drafting an outline for the owner to decide. Then sync protocol,
   SLA calendars, money/time, Jira mapping.
6. Choose the first audience for the MVP, then build feature by feature in small slices.

## 7. How to work with the owner

- Ask clarifying questions before giving detailed answers.
- Explain things in plain, non-technical language when guiding setup steps; give exact
  click-by-click or command-by-command instructions.
- The owner is mindful of Claude usage limits: avoid large multi-agent runs unless asked;
  prefer focused sessions.
- Respect the solo-accounts decision; don't push company accounts again, but flag the
  "move to company ownership before real data" step when it becomes relevant.
- Never handle real company/client data, AWS credentials or secrets in sessions.
