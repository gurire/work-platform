<h1 align="center">Dashboards</h1>
<p align="center">Flow charts for one team, and a health view across teams</p>

<table>
  <tr><td valign="middle"><b>Date</b></td><td valign="middle">17 Nov 2026</td></tr>
  <tr><td valign="middle"><b>Reference</b></td><td valign="middle">SPEC-DASH-001</td></tr>
  <tr><td valign="middle"><b>Subject</b></td><td valign="middle">What each dashboard number means, who can see it, and how it is worked out</td></tr>
</table>

**Status: DRAFT.** Written by Claude from the options the owner approved on 17 Nov 2026. Every
default below is marked _(default)_ and can be changed. It becomes binding when the owner
merges it. It adds no permission: dashboards use `item.view` from `specs/permission-matrix.md`.

---

## 1. Words used

| Word                | Meaning                                                                                                         |
| ------------------- | --------------------------------------------------------------------------------------------------------------- |
| **Started**         | The first time the item entered a stage in the `in_progress` category.                                          |
| **Finished**        | The last time the item entered a stage in the `done` category. Cancelled items are never finished.              |
| **Cycle time**      | Finished minus started, in days with one decimal.                                                               |
| **Lead time**       | Finished minus created, in days with one decimal.                                                               |
| **Item age**        | For an open item that has started: now minus started.                                                           |
| **Waiting time**    | Now minus when the item last entered its current stage (as in `stage-limits.md`).                               |
| **Past target**     | An open item whose waiting time is over its stage's waiting target.                                             |
| **Throughput**      | Items finished in a week. Weeks run Monday to Sunday in the organisation's time zone _(default: Asia/Kolkata)_. |
| **85th percentile** | The nearest-rank value: sort the cycle times, take the one at position ceil(0.85 × count).                      |
| **Stage kind**      | One of `waiting`, `working`, `review`, `release`, set per working stage (section 4).                            |

An item that is reopened after finishing is open again; its started time does not change. If it
finishes again, the new finish counts and the old one no longer does.

## 2. Who can see what

1. **A team's dashboard** is shown only to principals allowed `item.view` on that team.
   Anyone else gets "not found", as for any hidden object.
2. **The cross-team view** lists only teams the principal may `item.view`. Totals never include a
   team the principal cannot see, so nothing about a hidden team can be worked out.
3. Every number is computed through the same permission layer as lists; there is no separate
   reporting database.
4. **People charts show load, never speed.** The workload chart counts open items per person.
   No chart ranks people by cycle time or throughput _(default)_.

## 3. The team dashboard

Time window: the last 8 weeks, plus the current week _(default)_.

| Chart                       | What it shows                                                                                                                                                               |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Headline numbers**        | Open items, items finished this week, 85th percentile cycle time (last 8 weeks), items past target.                                                                         |
| **Cumulative flow**         | For each day, how many items are in or past each stage, stacked in workflow order. Cancelled items are left out.                                                            |
| **Time in stage vs target** | One dot per started open item, by current stage, at its waiting time, with the stage target as a dashed line. Dots past target are marked. The tooltip also gives item age. |
| **Cycle time spread**       | One dot per item finished in the window, by finish date, with the 85th percentile as a line.                                                                                |
| **Throughput**              | Items finished per week.                                                                                                                                                    |
| **Forecast**                | "When will N items be done?" and "How many by a date?" (section 5).                                                                                                         |
| **Workload**                | Open items per person in each working stage, plus an "Unassigned" row.                                                                                                      |

## 4. Stage kinds

1. Each working stage has a kind, so teams with different stage names can be compared.
2. **Starting kinds:** `todo` stages are `waiting`; `in_progress` stages are `working`. A stage
   whose name contains "review" starts as `review`; one containing "release" or "publish"
   starts as `release` _(default)_.
3. Done and cancelled stages have no kind.
4. Team admins (and org admins) can change a kind: it is team configuration (`team.config.edit`).

## 5. Forecast

1. It uses weekly throughput from the last 12 **complete** weeks _(default)_.
2. It runs 10,000 simulations. Each simulated week takes the throughput of a randomly chosen
   past week.
3. **When will N be done:** for each run, count weeks until N items are finished. Show the
   weeks by which 50%, 85% and 95% of runs had finished.
4. **How many by a date:** for each run, add up the weeks until the date. Show the number
   reached by at least 95%, 85% and 50% of runs.
5. The random numbers come from a fixed seed (the team and the date), so the same question
   gives the same answer all day.
6. With fewer than 4 complete weeks of history, or no finished items in them, the forecast says
   "Not enough history yet" and shows nothing else.

## 6. The cross-team view

One row per visible team.

| Column               | Rule                                                                                                                                                                                  |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Cycle time (85%)** | Over the last 6 weeks, with an arrow against the 6 weeks before (same within 10% shows as level).                                                                                     |
| **Done per week**    | Average over the last 4 complete weeks, with an arrow against the 4 before.                                                                                                           |
| **Past target**      | Open items past their stage target.                                                                                                                                                   |
| **Review rounds**    | Average review rounds per item finished in the last 6 weeks (from `reviews.md`).                                                                                                      |
| **Status**           | _At risk_ if 20% or more of started open items are past target, or cycle time rose more than 25%. _Watch_ if 10% or more, or it rose more than 10%. Otherwise _On track_ _(default)_. |

**Where work is stuck:** for each team and stage kind, the median of (waiting time ÷ stage
target) over open items in stages of that kind that have a target, shown as a percentage. A cell
with no targeted stages is empty. Status is always shown with an icon and a word, never colour
alone.

## 7. Freshness

Numbers are computed when the dashboard is opened. The page says when they were computed and
has a refresh button _(default)_. No numbers are stored separately.

## 8. Worked examples

1. DATA-5 enters Analysis (todo) on 1 Oct, Processing (in_progress) on 3 Oct, Validation on
   6 Oct and Published (done) on 10 Oct. Started 3 Oct, finished 10 Oct: cycle time 7.0 days,
   lead time 9.0 days (created 1 Oct).
2. It is reopened on 12 Oct and published again on 15 Oct. Cycle time is now 12.0 days, counted
   in the week of 15 Oct, not 10 Oct.
3. Nine items finished in the window with cycle times 1, 2, 2, 3, 4, 5, 6, 9, 14 days.
   ceil(0.85 × 9) = 8, so the 85th percentile is 9 days.
4. Validation has a 48-hour target. An item entered Validation 3 days ago: 72 ÷ 48 = 150%,
   past target.
5. Chen is a member of DATA and a reviewer on ENG. The cross-team view shows both teams.
   Dara, who is only on DATA, sees one row, and its totals are the same as Chen's DATA row.
6. A team has finished items in only 3 complete weeks. The forecast says "Not enough history
   yet".
