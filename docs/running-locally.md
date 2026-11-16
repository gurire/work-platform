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

`J`/`K` or arrows move; `Enter` open; `B` board; `S` stage, `A` owner, `P` priority; `Ctrl K` every command, or an
item key such as `ENG-42`; `/` filter; `D` density; `T` theme; `Ctrl Z` undo.

Edits show immediately. If the server refuses one (for example, changing an item in a team you
are not on), it is reverted and a message explains why.

The bar at the bottom shows load time and, per action, the time from key press to the next
paint. The target is under 100 ms.

## The item page

Press `Enter` on a row, or type an item key in `Ctrl K`, to open its page. The address bar
changes to `#/item/KEY`, so the link can be shared and the browser's Back button works.

The page shows:

- the stage strip: every stage of the team, which are done, where the item is now, and who
  owned each stage (a "pass 2" note means the item came back to this stage);
- what the current stage still needs: tick the checklist steps and fill in required fields
  such as **Coverage** in DATA Validation;
- the moves allowed from here. A forward move stays greyed out until the requirements are met.
  Team admins see **Force to …** instead and must give a reason, which is recorded. Finished
  items show **Reopen to …**, which also needs a reason;
- the stage history, newest first, and the owner and other details on the right.

On the item page: `J`/`K` next and previous item in the current list, `S`/`A`/`P` as on the
list, `Esc` back to the list.

To try the rules, open a DATA item in Validation as Chen Wei (the default sign-in, a DATA
member): the forward move is held back until the steps are ticked and Coverage is filled in.
Then act as Grace Lim (DATA team admin) to see **Force to …**.

## Reviews

DATA's Validation stage is also a review stage. Before an item can move on, it needs an
approved review round as well as the ticked steps and Coverage.

1. As Chen Wei, open a DATA item in Validation and press **Ask for review**. Pick Ines Costa
   (a DATA reviewer) and anyone else; everyone picked must approve. You cannot pick yourself or
   the item's owner.
2. Act as Ines Costa and open the same item. **Approve**, or write a comment and press
   **Request changes**. Asking for changes ends the round and sends the item back to
   Processing, with the comment shown in the stage history.
3. Once every reviewer approves, "Review approved" is ticked off; someone still moves the item
   on. If it comes back to Validation later, it needs a new round.

## Records

Each DATA item is about a dataset, and the dataset's facts (source, frequency, rows, last
refreshed, link) live once on a **record** instead of being copied onto every item.

- On an item page, the dataset card on the right shows the record. **Change** or **Unlink**
  switches the item to another record.
- Click the record's title to open it. DATA members can edit the facts there, and the change
  shows on every item about that dataset. The history lists every change with old and new
  values. Other teams can see the record but not change it.
- A DATA team admin (Grace Lim) can archive a record. It stays on its items but can no longer
  be changed or chosen for new items.

If you ran the app before records were added, delete `apps/api/.data` once to get them.

## Board, limits and waiting targets

Press `B` (or the **Board** button) to see the selected item's team as columns, one per stage.
Drag a card to move it; the same stage rules apply as on the item page, so a refused move
springs back with the reason. Click a card to open the item. `Esc` returns to the list.

- A column heading shows how many items the stage holds, and its limit if it has one: amber at
  the limit, red over it. Limits warn; they never stop a move.
- A card shows how long the item has been in its stage. It turns red when that is longer than
  the stage's target.
- Team admins see **Limits** under each working stage to set or clear them. In the sample data,
  DATA's Validation has a limit of 30 and a 72-hour target, Processing a limit of 40, and
  Sourcing a 120-hour target.
