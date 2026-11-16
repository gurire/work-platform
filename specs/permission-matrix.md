<h1 align="center">Permission Matrix</h1>
<p align="center">Who can see and do what, on every surface of the Work Platform</p>

<table>
  <tr><td valign="middle"><b>Date</b></td><td valign="middle">16 Nov 2026</td></tr>
  <tr><td valign="middle"><b>Reference</b></td><td valign="middle">SPEC-PERM-001</td></tr>
  <tr><td valign="middle"><b>Subject</b></td><td valign="middle">Roles, objects, actions and surfaces, with the owner's decisions</td></tr>
</table>

**Status: APPROVED by the owner on 16 Nov 2026.** This file is human-owned. Claude reads it but
must not change it without the owner's say-so. It drives the protected permission tests.

---

## 1. Principles (proposed)

1. **Deny by default.** Access exists only where this matrix grants it.
2. **One decision function.** Every surface asks the same permission layer the same question:
   may this principal do this action on this object? No surface has its own rules.
3. **Reads are filtered at the source.** Lists, search results, sync payloads, exports,
   notifications and AI context only ever contain objects the principal may view.
4. **Clients are isolated.** A client guest can never see another client's items, names,
   counts or search hits, including through links, mentions and autocomplete.
5. **Not visible means not there.** A hidden object returns "not found", never "forbidden".
6. **Agents and integrations are principals.** They have a named owner, explicit scopes and
   can never exceed that owner's access.
7. **Everything sensitive is audited:** permission changes, exports, guest access, agent actions.

## 2. Principals

| Role             | Who                                               | Scope of access (proposed)                             |
| ---------------- | ------------------------------------------------- | ------------------------------------------------------ |
| Org admin        | Runs the platform                                 | Everything, including configuration and audit          |
| Team admin       | Leads a team                                      | Their teams' items and team configuration              |
| Member           | Internal employee on one or more teams            | Views all open teams; changes items in their own teams |
| Reviewer         | Team role: checks work but does not do it         | As member to view; comments and verdicts in own teams  |
| Viewer           | Internal, read-only (for example a stakeholder)   | Views what a member can view; no changes               |
| Client guest     | External person from one client                   | Only items shared with that client                     |
| Portal requester | Anyone who raises a service desk request (later)  | Only their own requests                                |
| Agent / API key  | AI agent, automation or integration with an owner | Listed scopes, capped at the owner's access            |

MVP for the engineering audience needs: org admin, team admin, member, viewer, agent / API key.
Client guest and portal requester are defined now so the model does not have to change later.

## 3. Objects and actions

| Object                    | Actions                                                        |
| ------------------------- | -------------------------------------------------------------- |
| Work item                 | view, create, edit fields, change status, assign, delete, link |
| Comment                   | view, add, edit own, delete own, delete any                    |
| Internal note             | As comment, but never visible to guests or requesters          |
| Attachment                | view, add, delete                                              |
| Time entry (later)        | view own, view team, add, edit own, approve                    |
| Rates and budgets (later) | view, edit                                                     |
| Saved view / dashboard    | view, create, share, edit, delete                              |
| Team configuration        | view, edit (workflows, fields, members)                        |
| Org configuration         | view, edit (roles, SSO, integrations, API keys)                |
| Audit log                 | view, export                                                   |

## 4. Surfaces

The same decision applies on each. Each row below becomes a set of protected tests.

| Surface                  | What must hold                                                       |
| ------------------------ | -------------------------------------------------------------------- |
| API (read and write)     | Every endpoint checks the permission layer                           |
| Sync / live updates      | A client only receives changes for objects it may view               |
| Search and autocomplete  | No hits, counts or suggestions for hidden objects                    |
| Export and reports       | Contain only viewable objects and viewable fields                    |
| Notifications and email  | Never sent about objects the recipient cannot view                   |
| Links, mentions, history | A reference to a hidden object shows nothing about it                |
| MCP server and API keys  | Scopes enforced; capped at the owner's access                        |
| AI features              | Context given to a model is filtered as the asking user would see it |
| Webhooks (later)         | Payloads filtered to the subscriber's access                         |

## 5. Matrix: engineering MVP

Y = allowed. N = not allowed. Own = only on objects they created. Team = only within teams
they belong to. Open = every team that is not private, plus private teams they belong to.
Granted = only if an org admin has granted that scope, and never beyond the owner's access.
An agent's delete is always a soft delete, restored only by a person.

| Object: action                                   | Org admin |  Team admin   |        Member        | Viewer | Agent / API key |
| ------------------------------------------------ | :-------: | :-----------: | :------------------: | :----: | :-------------: |
| Work item: view                                  |     Y     |     Open      |         Open         |  Open  |    By scope     |
| Work item: create                                |     Y     |     Team      |         Team         |   N    |    By scope     |
| Work item: edit fields                           |     Y     |     Team      |         Team         |   N    |    By scope     |
| Work item: change status                         |     Y     |     Team      |         Team         |   N    |    By scope     |
| Work item: assign                                |     Y     |     Team      |         Team         |   N    |    By scope     |
| Work item: move to another team                  |     Y     | Team (source) | Member of both teams |   N    |        N        |
| Work item: delete (soft, 30 days)                |     Y     |     Team      |         Own          |   N    |     Granted     |
| Work item: restore within 30 days                |     Y     |     Team      |         Own          |   N    |        N        |
| Work item: tick or untick a stage step           |     Y     |     Team      |         Team         |   N    |    By scope     |
| Work item: force a move (audited)                |     Y     |     Team      |          N           |   N    |        N        |
| Work item: reopen from an end stage              |     Y     |     Team      |         Team         |   N    |    By scope     |
| Review: open a round                             |     Y     |     Team      |         Team         |   N    |    By scope     |
| Review: give or change a verdict                 |     Y     |     Team      |         Team         |   N    |        N        |
| Review: withdraw a round                         |     Y     |     Team      |         Own          |   N    |        N        |
| Record: create in its home team                  |     Y     |     Team      |         Team         |   N    |    By scope     |
| Record: edit fields                              |     Y     |     Team      |         Team         |   N    |    By scope     |
| Record: archive                                  |     Y     |     Team      |          N           |   N    |        N        |
| Work item: delete permanently                    |     Y     |       N       |          N           |   N    |        N        |
| Comment: add                                     |     Y     |     Team      |         Team         |   N    |    By scope     |
| Comment: edit or delete own                      |     Y     |     Team      |         Team         |   N    |    By scope     |
| Comment: delete any                              |     Y     |     Team      |          N           |   N    |        N        |
| Attachment: add                                  |     Y     |     Team      |         Team         |   N    |    By scope     |
| Attachment: delete                               |     Y     |     Team      |         Own          |   N    |        N        |
| Saved view: create and share                     |     Y     |     Team      |         Team         |  Own   |        N        |
| Team configuration: edit workflows and fields    |     Y     |     Team      |          N           |   N    |     Granted     |
| Team configuration: edit stage rules             |     Y     |     Team      |          N           |   N    |     Granted     |
| Team configuration: edit membership and privacy  |     Y     |     Team      |          N           |   N    |        N        |
| Org configuration: edit (non-security)           |     Y     |       N       |          N           |   N    |     Granted     |
| Org security: roles, SSO, API keys, agent scopes |     Y     |       N       |          N           |   N    |        N        |
| Audit log: view                                  |     Y     |       N       |          N           |   N    |        N        |
| Export items (always audited)                    |     Y     |     Open      |         Open         |   N    |    By scope     |

Org admins can view private teams; each such view is written to the audit log.

The stage step, forced move, reopen and stage rule rows were added on 16 Nov 2026, approved
with `specs/workflow.md` (section 4). For deleting and restoring, "Own" means the person who
created the item; the current stage owner does not count.

The review rows and the **Reviewer** team role were added on 17 Nov 2026 from `specs/reviews.md`
(section 4), which has the full table including the Reviewer and Client guest columns. A
reviewer may view, comment and give verdicts in their teams, and nothing else. For withdrawing
a round, "Own" means the person who opened it.

The record rows come from `specs/records.md` (section 4, DRAFT of 17 Nov 2026: the owner has not
yet answered ADR 0007 questions 3 and 5, and the narrower answer is used). "Team" means the
record's home team. Seeing a record is the same check as seeing a work item of its home team.

## 6. Decisions (answered by the owner, 16 Nov 2026)

|  #  | Question                                                                    | Decision                                                                                   |
| :-: | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
|  1  | Can internal members see items of teams they are not on?                    | Yes. Open by default, except teams marked private                                          |
|  2  | Private teams or restricted items in the first release?                     | Private teams only. Per-item restriction later                                             |
|  3  | Can members delete items?                                                   | Soft delete of their own items, restorable for 30 days. Permanent delete by org admin only |
|  4  | Who can move an item to another team?                                       | A member of both teams, or a team admin of the source team                                 |
|  5  | Who may export, and is it logged?                                           | Members, for items they can view. Every export is audited                                  |
|  6  | Can agents and API keys delete or change configuration?                     | Yes to both, only if an org admin grants it, capped at the owner's access                  |
|  7  | Is "viewer" needed at launch?                                               | Yes                                                                                        |
|  8  | Does someone who leaves a team keep access to their old items?              | No. Access follows current membership and team visibility                                  |
|  9  | Do org admins see private teams?                                            | Yes, and each such access is audited                                                       |
| 10  | Do client guests see internal notes, time entries, rates or other guests?   | No to all four                                                                             |
| 11  | May an agent be granted changes to roles, SSO, API keys or its own scopes?  | No. Agents can never change security settings or who has access                            |
| 12  | May members comment on, create or edit items in open teams they are not on? | No. Other open teams are read-only; changes only in teams they belong to                   |
| 13  | Is an agent's delete always a soft delete that a human can restore?         | Yes                                                                                        |
| 14  | Can someone edit their own comment in a team they have left?                | No. Own comments can be edited only in teams they currently belong to                      |

Decision 11 is applied to team membership and team privacy as well, because changing either
changes who has access.

## 7. Field-level rules (proposed)

- Money fields (rates, cost, budget, margin) are visible only to roles granted "view rates and
  budgets". Hidden fields are omitted, not blanked, on every surface.
- Internal notes are never included in anything a client guest or portal requester can reach.
- A guest sees assignee names only for items shared with their client.

## 8. How this becomes tests

1. The approved matrix is written as a data table (role, object, action, expected result).
2. A generated test suite in `test/protected/` checks every row against the permission layer.
3. A second suite checks each surface in section 4 with a two-client, two-team fixture, so a
   leak on any path fails the build.
4. Claude cannot edit this spec or those tests without the owner's approval.

## 9. Not covered yet

Service desk queues and SLAs, customer portal, time and billing detail, SSO group mapping,
data retention and legal hold, and break-glass access. Each needs its own section before the
related feature is built.
