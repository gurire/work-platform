# 0006: Front-end architecture for the web app

Status: proposed (2026-11-16). Merging this file to `main` accepts it.

## Context

The UI/UX research (`docs/research/ui-ux-research.md`) and the UI shell spike
(`docs/ui-shell-spike.md`) tested the direction for the first audience, engineering.
The spike rendered 100,000 generated items with local reads and optimistic writes.

Measured on the owner's PC in dev mode, input to next paint (small sample, automated keys):

| Action          | p50 (ms) | p95 (ms) | Samples |
| --------------- | :------: | :------: | :-----: |
| Move selection  |    16    |    38    |   31    |
| Change status   |    63    |    63    |    2    |
| Change assignee |    76    |    76    |    1    |
| Change priority |    38    |    38    |    1    |

About 31 rows were in the DOM at any time. Generating and loading 100,000 items in one pass
blocked the page for about 775 ms. The owner reported that everything felt smooth.

## Decision

1. **Reads come from a local in-memory store.** Components subscribe to the single item or
   view they show (`useSyncExternalStore`), so an edit re-renders one row, not the list.
   No state library is added until a measured need appears.
2. **Writes are optimistic with one rejection path.** A change shows immediately; if the
   server rejects it, the store reverts it and shows a toast naming the item. Screens do not
   write their own error handling for this. Every edit can be undone.
3. **Start with optimistic updates over the normal API; choose a sync engine later.** A sync
   engine is adopted only after a spike proves it enforces the permission matrix on the read
   path, syncs partially at 100,000 items, and works for web and the later mobile app.
4. **Never load a whole workspace in one blocking pass.** Data arrives per view, in chunks.
5. **Every long list is virtualized** with TanStack Virtual, using a fixed row height per
   density setting (compact 28 px, default 34 px, comfortable 42 px).
6. **Keyboard first.** One command palette (Ctrl/Cmd+K) holds every action and shows its
   shortcut. Common actions have single-key shortcuts. Every drag action also has a
   non-drag way to do it.
7. **Design tokens.** Semantic (alias) tokens as CSS custom properties, colours in OKLCH,
   light and dark themes from day one. Status is never shown by colour alone.
8. **Accessibility target is WCAG 2.2 AA:** 24 px minimum targets, visible focus, nothing
   sticky covering the focused element, virtualized grids expose row counts and positions.
9. **Performance budgets:** input acknowledged in under 100 ms, a view from local data in
   under 400 ms, tested at 100,000 generated items. Timing checks for the hottest actions
   join CI before the first real screen ships.

## Provisional, to confirm

- Default density "default", theme following the system setting, teal accent.
- Component layer (shadcn/ui on Base UI versus React Aria) is not decided. The spike used
  hand-written components. Decide when the first complex widget (date picker, combobox) is
  needed, with a keyboard and screen-reader check as the gate.

## Consequences

- The spike code in `apps/web/src/spike/` is throwaway. Production code reuses its patterns,
  not its files, and adds the API, permissions and tests.
- Mutations are written twice (client optimistic, server authoritative); the server wins.
- Fixed row heights rule out variable-height rows in lists; long text is truncated there and
  shown in full in the item view.
- The numbers above are from dev mode with few samples. They are repeated on a production
  build and on a slower machine before the budgets are treated as met.
