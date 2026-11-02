# Set up your PC

Do these once on the computer you build from. Claude Code in the cloud can't do them for you,
because they need your own sign-ins.

## 1. Install the tools

| Tool                               | Why                                      | Check              |
| ---------------------------------- | ---------------------------------------- | ------------------ |
| Node.js 22 (via nvm or nodejs.org) | Runs everything                          | `node -v`          |
| pnpm, via `corepack enable`        | Package manager pinned in `package.json` | `pnpm -v`          |
| Git                                | Source control                           | `git --version`    |
| Claude Code (CLI or desktop app)   | Same account as claude.ai                | `claude --version` |
| AWS CLI v2                         | Sign in to AWS, run CDK                  | `aws --version`    |
| uv                                 | Runs Python-based MCP servers (`uvx`)    | `uvx --version`    |
| Docker Desktop                     | Local Postgres/OpenSearch, later         | `docker -v`        |

## 2. Get the code running

```bash
git clone https://github.com/gurire/work-platform.git
cd work-platform
pnpm install
pnpm check
```

## 3. Check your Claude settings

- "Help improve Claude" is off in claude.ai privacy settings.
- `/feedback`, `/bug` and `/share` are disabled for this repo by `.claude/settings.json`.
- Run `/status` in Claude Code and confirm it uses your subscription, not an API key.
  Never leave `ANTHROPIC_API_KEY` exported in your shell profile.

## 4. Connect the AWS MCP servers

**AWS Knowledge (docs, no AWS access)** is already configured in `.mcp.json` and works in
cloud and local sessions. Approve it the first time Claude Code asks. In cloud sessions, the
environment's network access must allow `knowledge-mcp.global.api.aws`.

**AWS account access (your PC only, after the first deploy)** uses the view-only role
`wm-claude-dev-view`, never your admin profile. Add it at _local_ scope so it is not committed
and never reaches cloud sessions:

```bash
claude mcp add aws --scope local \
  -e AWS_PROFILE=wm-claude-view -e AWS_REGION=<your-region> \
  -- uvx mcp-proxy-for-aws@latest https://aws-mcp.us-east-1.api.aws/mcp
```

Check the exact command against AWS's current AWS MCP Server documentation before running it;
the package name and arguments may have changed. The role it uses can only view resource
settings and read `/wm/dev/*` logs, so a wrong command can't change or read data.
