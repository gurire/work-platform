# 0004: Money as integer minor units, time as integer minutes

Status: accepted (2026-11-02)

## Decision

- Money is `{ amountMinor: integer, currency: ISO 4217 }`. No floats anywhere in money paths.
- Logged time is integer minutes.
- Rounding happens once per calculated amount, half-even, via `@wm/shared` helpers.
- ESLint blocks `parseFloat`; money code goes through `money.ts`.

## Why

Billing and budget errors from float rounding are subtle and damage client trust. Fixing the
rules in one tested module stops each session from making its own rounding choices.
