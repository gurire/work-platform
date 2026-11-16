# Running the app locally

```
pnpm install
pnpm dev
```

`pnpm dev` builds the shared package, then starts the API (http://127.0.0.1:3000) and the web
app (the address Vite prints, usually http://localhost:5173). Leave the window open.

The API uses an embedded Postgres (PGlite) with made-up data stored in `apps/api/.data`.
Delete that folder to start again from fresh sample data. The first start takes a few seconds.

## Sign-in is a development stand-in

There is no real sign-in yet. The "Dev sign-in" box in the toolbar chooses which sample person
you act as. The API refuses to start in production mode while this is the case.

| Person     | Role                          |
| ---------- | ----------------------------- |
| Asha Rao   | Org admin                     |
| Ben Ortiz  | Team admin: Web, Security     |
| Chen Wei   | Team admin: API               |
| Dara Singh | Team admin: Operations        |
| Elif Kaya  | Team admin: Engineering       |
| Liam Shaw  | Viewer (read-only)            |
| Others     | Members of one open team each |

Security is a private team: only Ben Ortiz and the org admin can see `SEC-1`.

Data Pipeline (`DATA-…` items) is a pipeline team with its own stages, from Analysis to
Published. Moving one of its items to another stage clears the owner, so the next stage picks
it up. Grace Lim is its team admin; Chen Wei and Dara Singh are members.

Its Validation stage has rules: two checklist steps and a filled-in Coverage value are needed
before an item can go on to Client review. The list screen does not have a checklist yet, so
moving a `DATA-…` item forward out of Validation is refused with a message saying what is
missing. Moving it back, or to Dropped, works. The item page with the checklist comes next.
`S` only offers the stages an item is allowed to move to.

If you ran the app before stages were added, delete `apps/api/.data` once to get this team.

## Keys

`J`/`K` or arrows move; `S` stage, `A` owner, `P` priority; `Ctrl K` every command, or an
item key such as `ENG-42`; `/` filter; `D` density; `T` theme; `Ctrl Z` undo.

Edits show immediately. If the server refuses one (for example, changing an item in a team you
are not on), it is reverted and a message explains why.

The bar at the bottom shows load time and, per action, the time from key press to the next
paint. The target is under 100 ms.
