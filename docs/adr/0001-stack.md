# 0001: TypeScript across web, API and mobile

Status: accepted (2026-11-02)

## Decision

- One language end to end: TypeScript.
- Web: React + Vite. API: Node + Fastify. Mobile (later): React Native with Expo.
- pnpm workspaces monorepo; shared domain code in `packages/shared`.
- Infrastructure: AWS CDK in TypeScript.

## Why

Shared types between client and server catch contract breaks at compile time, which matters
for a sync engine and for mobile clients that stay installed across API versions. One language
also keeps a small team (and Claude sessions) consistent.

## Consequences

- The performance target (Linear-style, local-first) is reached through architecture
  (local replica, partial sync, optimistic writes), not language choice.
- iOS builds need macOS or a hosted build service; Linux cloud sessions cannot do them.
