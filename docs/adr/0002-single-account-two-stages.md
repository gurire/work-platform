# 0002: Dev and prod as two stages in one AWS account

Status: accepted (2026-11-02)

## Decision

One personal AWS account. The CDK app deploys the same `AppStage` twice, as `Dev` and `Prod`.
Each stage has its own resources, a `wm-<env>-` name prefix and an `env` tag.

## Guardrails that make up for the shared account

- Claude Code and the AWS MCP use `wm-claude-dev-view`: view-only, plus reading `/wm/dev/*` logs.
- Deploys run only in GitHub Actions through OIDC (`wm-github-deploy`), with no stored keys.
  Prod needs a manual run through the `production` GitHub environment.
- `.claude/settings.json` blocks `cdk deploy` and `cdk destroy` in Claude sessions.
- Prod buckets and databases are retained if a stack is deleted. Dev data is disposable.
- Budget alarms per `env` tag (set up in the AWS console; see the first-deploy guide).

## Consequences

IAM is account-wide, so the separation is a strong fence, not a hard wall. Before real company
or client data goes in, move Prod to its own account (one-line change to the Prod stage `env`)
or into a company-owned AWS Organization.
