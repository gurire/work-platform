# Work Platform

Custom work management for engineering teams, client delivery and the IT service desk:
fast on desktop, purpose-built on mobile, self-hosted on AWS.

## Status

Scaffold only. The API and web app run with placeholder endpoints; infrastructure synthesizes
but has not been deployed.

## Getting started

Requires Node 22 and pnpm 10 (`corepack enable`).

```bash
pnpm install
pnpm check
pnpm --filter @wm/api dev
pnpm --filter @wm/web dev
```

## Docs

- [Set up your PC](docs/setup/pc-setup.md)
- [First AWS deploy](docs/setup/aws-first-deploy.md)
- [Architecture decisions](docs/adr/)
- [Specs](specs/README.md)
