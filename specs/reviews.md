<h1 align="center">Review Rounds</h1>
<p align="center">How an item is reviewed inside a stage, and what a verdict does</p>

<table>
  <tr><td valign="middle"><b>Date</b></td><td valign="middle">17 Nov 2026</td></tr>
  <tr><td valign="middle"><b>Reference</b></td><td valign="middle">SPEC-REVIEW-001</td></tr>
  <tr><td valign="middle"><b>Subject</b></td><td valign="middle">Review stages, rounds, reviewers, verdicts and send-back, with the owner's decisions</td></tr>
</table>

**Status: DRAFT with the owner's decisions of 17 Nov 2026 recorded. It becomes binding when the
owner merges it.** After that this file is human-owned and drives protected tests. It builds on
`docs/adr/0007-stages-reviews-records.md` (decision 3), `specs/workflow.md` and
`specs/permission-matrix.md`.

---

## 1. Terms

- **Review stage:** a stage that a team has set up to need a review. It names a **send-back
  stage**.
- **Round:** one request for review of an item. Rounds are numbered per item: round 1, 2, 3…
- **Reviewer:** a person asked to give a verdict in a round.
- **Verdict:** _approved_ or _changes requested_, always with an optional comment, and a
  required comment for changes requested.
- **Requester:** the person who opened the round.

## 2. Rules

1. **A review stage has one extra requirement, "Review approved".** It sits beside the stage's
   checklist steps and required fields and follows the same rules in `specs/workflow.md`: it
   applies only when leaving the stage forwards, and a team admin may force past it with a
   reason.
2. **Opening a round.** A team member or team admin picks one or more reviewers and opens a
   round. Only one round per item may be open at a time.
3. **Who can be a reviewer.** Anyone who may give a verdict on that item (section 4): team
   admins, members and reviewers of the item's team, and client guests of a client the item is
   shared with.
4. **All reviewers must approve.** The round is approved when every reviewer has approved.
5. **Any "changes requested" ends the round at once.** The item moves straight to the stage's
   send-back stage. The reviewer's comment is shown on the item as the reason, and the move
   appears in the stage history as "sent back by review".
6. **Approval does not move the item.** It meets the "Review approved" requirement; a person
   still moves the item forward.
7. **Approvals belong to one pass.** When an item comes back to the review stage, it needs a new
   approved round, the same way its checklist starts fresh (`specs/workflow.md`, rule 7).
8. **Leaving the stage closes an open round.** If an item leaves the review stage another way
   (a forced move, moving back, cancelling), the open round is closed as _withdrawn_.
9. **Withdrawing.** The requester or a team admin may withdraw an open round.
10. **Everything is kept.** Rounds, reviewers and verdicts are never edited or deleted. Each
    verdict records who, when and the comment.

## 3. Defaults assumed (say if any is wrong)

These were not asked; they are the safe choice and can be changed before merging.

1. **No reviewing your own work.** The requester and the item's current stage owner cannot be
   reviewers in that round.
2. **A reviewer may change their verdict while the round is open.** Once a round closes
   (approved, changes requested or withdrawn), verdicts are final.
3. **Agents and API keys never give verdicts**, whoever owns them. They may open a round if
   their scopes allow it.
4. **Client guest verdicts are audited,** like all guest access.
5. **The send-back move skips the allowed-moves list.** It goes to the configured stage even if
   the team's allowed moves would not list it. When setting up a review stage, the send-back
   stage must be an earlier stage that is not an end stage.
6. **Client guests may comment** on items shared with their client, so they can explain a
   verdict. They never see internal notes (`specs/permission-matrix.md`, decision 10).

## 4. Additions to the permission matrix

A new team role, **Reviewer**, for people who check work but do not do it (for example a
quality lead). A reviewer of a team views what a member views, may comment on that team's
items and give verdicts on them, and may do nothing else: no editing, moving, assigning or
ticking steps.

| Object: action                    | Org admin | Team admin | Member | Reviewer | Viewer |   Client guest   | Agent / API key |
| --------------------------------- | :-------: | :--------: | :----: | :------: | :----: | :--------------: | :-------------: |
| Review: open a round              |     Y     |    Team    |  Team  |    N     |   N    |        N         |    By scope     |
| Review: give or change a verdict  |     Y     |    Team    |  Team  |   Team   |   N    | Shared (audited) |        N        |
| Review: withdraw a round          |     Y     |    Team    |  Own   |    N     |   N    |        N         |        N        |
| Comment: add                      |     Y     |    Team    |  Team  |   Team   |   N    |      Shared      |    By scope     |
| Team configuration: review stages |     Y     |    Team    |   N    |    N     |   N    |        N         |     Granted     |

"Shared" means items shared with the guest's client. Sharing items with clients is not built
yet; until it is, client guests can review nothing. "Own" for withdrawing means the requester.

## 5. Worked examples

1. DATA's Validation is a review stage with send-back stage Processing. Chen opens round 1 on
   DATA-12 with Grace and Hugo as reviewers. Grace approves. The item cannot move on yet:
   "Review approved" is still missing.
2. Hugo approves. Round 1 is approved and the requirement is met. Chen still moves the item to
   the next stage himself.
3. On DATA-15, round 1 has Grace and Hugo. Grace approves; Hugo requests changes with "Row
   counts do not match the source". The round ends, DATA-15 moves to Processing, and the item
   shows Hugo's comment as the reason. Grace's approval no longer counts.
4. DATA-15 comes back to Validation. It needs a new round (round 2); round 1 counts for nothing.
5. Chen tries to add himself as a reviewer on a round he is opening. Refused: no reviewing your
   own work.
6. Grace, a team admin, forces DATA-20 out of Validation while round 3 is open, with a reason.
   The move is audited and round 3 is closed as withdrawn.
7. An agent tries to approve a round. Refused, even if its owner could approve.

## 6. Not covered yet

- Notifications to reviewers (who is told, and how).
- Sharing items with a client, which client-guest reviewing depends on.
- Review checklists or scoring beyond approved / changes requested.
- Limits on how many rounds an item may need before someone is alerted.
