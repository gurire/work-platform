# 0005: Dependency and open-source licence policy

Status: accepted (2026-11-02)

## Decision

- Allowed: permissive licences (MIT, Apache-2.0, BSD, ISC and similar).
- Blocked by `pnpm check:licenses` in CI: GPL, LGPL, AGPL, SSPL, BUSL, EUPL, OSL, Commons Clause,
  and unknown licences. Exceptions are added to `scripts/check-licenses.mjs` only after review.
- Copyleft projects such as Plane (AGPL) and OpenProject (GPL) are design references only.
  Do not copy their code.
- New package versions must be at least 7 days old (`minimumReleaseAge` in `pnpm-workspace.yaml`).

## Why

The client portal will expose the system to external users, which would trigger AGPL source
obligations. Recently published versions are where most malicious packages are caught.
