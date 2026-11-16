<h1 align="center">Stage Limits and Waiting Targets</h1>
<p align="center">Warning when a stage holds too much work, or an item has waited too long</p>

<table>
  <tr><td valign="middle"><b>Date</b></td><td valign="middle">17 Nov 2026</td></tr>
  <tr><td valign="middle"><b>Reference</b></td><td valign="middle">SPEC-LIMIT-001</td></tr>
  <tr><td valign="middle"><b>Subject</b></td><td valign="middle">Item limits and waiting-time targets per stage, and how boards and lists show them</td></tr>
</table>

**Status: DRAFT.** It spells out ADR 0007 decision 5 ("limits warn; they do not block"). No new
permission is needed: setting limits is team configuration (`team.config.edit`). It becomes
binding when the owner merges it.

---

## 1. Rules

1. **A stage may have an item limit** (a whole number from 1 to 999) and **a waiting target**
   (a number of hours from 1 to 8760). Either or both may be left unset.
2. **Only working stages take them.** Done and cancelled stages cannot have a limit or a target.
3. **The count is every item in the stage** that is not deleted, whoever can see it. A stage is
   _at its limit_ when the count equals the limit, and _over its limit_ when the count is
   higher.
4. **Waiting time is measured from when the item last entered its current stage.** An item is
   _overdue_ when it has waited longer than the stage's target.
5. **Limits and targets never block anything.** A move into a full stage goes ahead; boards and
   lists show the warning instead.
6. **Who sets them:** team admins of the team, and org admins.

## 2. How they show

- The board column heading shows "count / limit", amber at the limit and red over it.
- An overdue item's card shows how long it has waited, in red.

## 3. Worked examples

1. Validation has a limit of 5 and holds 5 items: at its limit. A sixth item moves in; the move
   goes ahead, and the column now shows 6 / 5 in red.
2. Processing has a target of 48 hours. An item that entered Processing 3 days ago is overdue.
   It is sent back by a review and enters Processing again: its waiting time starts again.
3. A team admin tries to give Published (a done stage) a limit. Refused.
4. A member tries to set a limit. Refused.
