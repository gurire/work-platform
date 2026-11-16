<h1 align="center">Workflow and Stage Rules</h1>
<p align="center">How items move between a team's stages, and what can stop a move</p>

<table>
  <tr><td valign="middle"><b>Date</b></td><td valign="middle">16 Nov 2026</td></tr>
  <tr><td valign="middle"><b>Reference</b></td><td valign="middle">SPEC-FLOW-001</td></tr>
  <tr><td valign="middle"><b>Subject</b></td><td valign="middle">Stage requirements, allowed moves, forced moves, reopening and re-entry, with the owner's decisions</td></tr>
</table>

**Status: DRAFT with the owner's decisions of 16 Nov 2026 recorded. It becomes binding when the
owner merges it.** After that this file is human-owned and drives protected tests. It builds on
`docs/adr/0007-stages-reviews-records.md` and `specs/permission-matrix.md`.

---

## 1. Terms

- **Stage:** one step in a team's workflow. Each stage has a category: to do, in progress,
  done or cancelled. Done and cancelled stages are **end stages**.
- **Move:** changing an item's stage.
- **Requirement:** something a stage needs before an item may leave it **forwards**.
- **Pass:** one stay of an item in a stage. An item that returns to a stage starts a new pass.

## 2. Rules

1. **Requirements are checklist steps and required fields.** A stage may have any number of
   each, or none.
2. **Requirements apply when leaving a stage for a later stage.** Moving back to an earlier
   stage, or to a cancelled stage, never needs them. Moving to a done stage does.
3. **Any team member may tick a checklist step.** Each tick records who ticked it and when.
   Unticking is allowed and is also recorded.
4. **Allowed moves.** A team may list, for each stage, the stages an item can move to from it.
   When a team has not listed any for a stage, the default is: the next stage, the previous
   stage, and any end stage.
5. **A refused move changes nothing** and tells the person exactly which requirements are
   missing, or that the destination is not allowed.
6. **Forced moves.** A team admin of the item's team (or an org admin) may force a move whose
   requirements are not met. A written reason is required, and the move is written to the
   audit log and shown on the item. A forced move must still go to an allowed destination.
7. **Re-entry starts fresh.** When an item returns to a stage, that stage's checklist is
   unticked for the new pass. Earlier passes, with their ticks, stay in the history.
   Field values are not cleared.
8. **Reopening.** Any team member may move an item out of an end stage. A short reason is
   required and shown on the item. The item goes to an allowed destination of that end stage;
   by default that is the stage before it.
9. **Agents and API keys follow the same rules** and can never force a move, whoever owns them.
10. **Owner on hand-over** is unchanged from ADR 0007: a team may choose to clear the owner
    whenever an item changes stage.

## 3. Worked examples

A team has stages, in order: Analysis, Sourcing, Validation, Client review, Published (done),
Dropped (cancelled). Validation requires two steps ("Totals checked", "Units confirmed") and
the field "Coverage". No allowed moves have been listed, so the default applies.

|  #  | Situation                                                                                  | Result                                                                                                |
| :-: | ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
|  1  | Item in Validation, one step unticked. Member moves it to Client review                    | Refused. Message names the unticked step                                                              |
|  2  | Same item, both steps ticked, "Coverage" empty. Member moves it forward                    | Refused. Message names the empty field                                                                |
|  3  | Everything met. Member moves it to Client review                                           | Allowed                                                                                               |
|  4  | Item in Validation, nothing ticked. Member moves it back to Sourcing                       | Allowed. Requirements do not apply backwards                                                          |
|  5  | Item in Validation, nothing ticked. Member moves it to Dropped                             | Allowed. Requirements do not apply to cancelled stages                                                |
|  6  | Item in Analysis. Member moves it straight to Validation                                   | Refused. Not an allowed destination (not next or previous)                                            |
|  7  | Item in Validation, one step unticked. Team admin forces it to Client review with a reason | Allowed, audited, reason shown on the item                                                            |
|  8  | Same as 7, but no reason given                                                             | Refused                                                                                               |
|  9  | Same as 7, but by a member who is not an admin                                             | Refused                                                                                               |
| 10  | Same as 7, but by an agent owned by the team admin                                         | Refused                                                                                               |
| 11  | Team admin forces an item from Analysis to Client review                                   | Refused. Forcing skips requirements, not allowed destinations                                         |
| 12  | Item returns from Client review to Validation                                              | New pass: both steps unticked; "Coverage" keeps its value                                             |
| 13  | Item in Published. Member reopens it with a reason                                         | Allowed. It moves to Client review; the reason is shown                                               |
| 14  | Item in Published. Member reopens it with no reason                                        | Refused                                                                                               |
| 15  | Item in Dropped. Member reopens it with a reason                                           | Allowed. It moves to Client review, the stage before Dropped in order, unless the team listed another |
| 16  | A viewer ticks a step                                                                      | Refused. Viewers cannot change items                                                                  |

## 4. Additions to the permission matrix

Approving this spec also approves adding these rows to `specs/permission-matrix.md`, section 5.

| Object: action                         | Org admin | Team admin | Member | Viewer | Agent / API key |
| -------------------------------------- | :-------: | :--------: | :----: | :----: | :-------------: |
| Work item: tick or untick a stage step |     Y     |    Team    |  Team  |   N    |    By scope     |
| Work item: force a move (audited)      |     Y     |    Team    |   N    |   N    |        N        |
| Work item: reopen from an end stage    |     Y     |    Team    |  Team  |   N    |    By scope     |
| Team configuration: edit stage rules   |     Y     |    Team    |   N    |   N    |     Granted     |

Also recorded, with no change to the matrix: for deleting and restoring, "Own" means the
person who created the item. The current stage owner does not count (owner's decision,
16 Nov 2026).

## 5. Not covered yet

Review rounds and their automatic moves, stage limits and time targets, code-driven moves,
conditions based on a person's role or a field's value, and moves made by automation rules.
Each needs its own section before it is built.
