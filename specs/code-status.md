<h1 align="center">Status That Follows the Code</h1>
<p align="center">Pull requests, checks and merges move work items, and say why</p>

<table>
  <tr><td valign="middle"><b>Date</b></td><td valign="middle">17 Nov 2026</td></tr>
  <tr><td valign="middle"><b>Reference</b></td><td valign="middle">SPEC-CODE-001</td></tr>
  <tr><td valign="middle"><b>Subject</b></td><td valign="middle">Code events, how items are found, team rules, automatic moves, overrides and auditing</td></tr>
</table>

**Status: DRAFT. Written without the owner's answer to ADR 0007 question 4; the safer choice is
used and marked "Default".** It spells out ADR 0007 decision 6 and builds on
`specs/workflow.md`. It becomes binding when the owner merges it.

---

## 1. Terms

- **Code event:** one of _pull request opened_, _checks passed_, _checks failed_, _pull request
  merged_, _pull request closed without merging_.
- **Code rule:** a team's setting that says which stage an event moves its items to, for example
  "pull request merged → Done". A team with no rules is never moved by code.
- **Automatic move:** a stage change made by a code event rather than a person.

## 2. Rules

1. **Events arrive signed.** The code host signs each event with a shared secret. An event with
   a missing or wrong signature is refused and changes nothing. Without a configured secret the
   endpoint is off.
2. **Items are found by key.** An event applies to every item whose key (such as ENG-142)
   appears in the branch name or the pull request title, in any letter case, up to 10 items.
3. **Every pull request is remembered on its items:** its number, link, title, state (open,
   merged, closed) and latest checks (passing, failing or not yet known), whether or not the
   item moves.
4. **Only teams with a rule for that event are moved.** The move goes to the stage the rule
   names.
5. **Automatic moves follow the same rules as a person** (`specs/workflow.md`): the destination
   must be allowed and the current stage's requirements must be met. They are never forced. A
   move that is refused does not happen; the item records that the event arrived and why it did
   not move.
6. **Every automatic move shows its reason** on the item, such as "Pull request #12 merged".
7. **A person can always override** by moving the item as usual.
8. **Default (ADR 0007, question 4): overrides are audited.** When a person moves an item out of
   a stage it entered by an automatic move, the move is written to the audit log with both
   stages. Every automatic move is written to the audit log too.
9. **The code host is not a person.** It holds no role and can do nothing but deliver events;
   what an event may do is fixed by the team's rules and rules 4 and 5. Setting rules is team
   configuration (`team.config.edit`).

## 3. Worked examples

1. ENG's rules: opened → In Review, checks failed → In Progress, merged → Done. A pull request
   "Fix login timeout" on branch `eng-142-login-timeout` is opened. ENG-142 moves from In
   Progress to In Review, showing "Pull request #31 opened".
2. Checks fail on #31. ENG-142 moves back to In Progress, showing "Checks failed on #31".
3. The developer fixes it and the checks pass. ENG has no rule for checks passed, so the item
   stays; the pull request on the item now shows checks passing.
4. #31 is merged. ENG-142 moves to Done.
5. A lead reopens ENG-142 (back to In Review) because the fix is incomplete. The move is allowed
   and audited as an override of an automatic move.
6. A pull request names DATA-7 in its title. DATA has no code rules: the pull request is
   remembered on DATA-7, and nothing moves.
7. An event with a wrong signature arrives. It is refused and nothing is recorded.

## 4. Not covered yet

- Connecting a real code host (an app, its permissions and its secret). This needs the owner.
- Commits and deployments as events.
- A screen for team admins to edit code rules (the API exists).
