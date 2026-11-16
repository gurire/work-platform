# UI shell spike

Throwaway prototype to measure how the engineering list feels with local reads and optimistic
writes. It lives in `apps/web/src/spike/` and replaces the placeholder app for now.

**Not production code.** There is no API, no sync engine and no permission layer. Data is
100,000 generated items from `generateSampleWorkItems` in `@wm/shared`.

## Run it

```
pnpm install
pnpm --filter @wm/shared build
pnpm --filter @wm/web dev
```

Open the address Vite prints (usually http://localhost:5173).

## Try

- `J` / `K` or arrows to move, `PageDown`, `Home`, `End`.
- `S` status, `A` assignee, `P` priority; `Ctrl K` for every command, or type a key like `ENG-42`.
- `/` to filter, the tabs to filter by status category.
- `D` density, `T` theme, `Ctrl Z` undo.
- In the palette, turn on "Simulate server rejections" and edit a few items to see the revert toast.

## Read the numbers

The bar at the bottom shows, per action, the time from key press to roughly the next paint
(last, p50, p95). The project target is under 100 ms; anything over turns red. Record the p95
values for move, status change and filter on your machine, in a production build
(`pnpm --filter @wm/web build` then `pnpm --filter @wm/web preview`), not only in dev mode.
