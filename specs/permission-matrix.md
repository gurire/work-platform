<h1 align="center">Permission Matrix</h1>
<p align="center">Who can see and do what, on every surface of the Work Platform</p>

<table>
  <tr><td valign="middle"><b>Date</b></td><td valign="middle">16 Nov 2026</td></tr>
  <tr><td valign="middle"><b>Reference</b></td><td valign="middle">SPEC-PERM-001</td></tr>
  <tr><td valign="middle"><b>Subject</b></td><td valign="middle">Draft outline of roles, objects, actions and surfaces, for the owner to decide</td></tr>
</table>

**Status: DRAFT OUTLINE, not approved.** Claude drafted this for the owner to correct. Nothing
here is a rule until the owner approves it. Every "Proposed" value is a starting suggestion.
Once approved, this file is human-owned and generates the protected permission tests.

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

| Role             | Who                                               | Scope of access (proposed)                    |
| ---------------- | ------------------------------------------------- | --------------------------------------------- |
| Org admin        | Runs the platform                                 | Everything, including configuration and audit |
| Team admin       | Leads a team                                      | Their teams' items and team configuration     |
| Member           | Internal employee on one or more teams            | Their teams' items; see section 6, decision 1 |
| Viewer           | Internal, read-only (for example a stakeholder)   | Same visibility as a member, no changes       |
| Client guest     | External person from one client                   | Only items shared with that client            |
| Portal requester | Anyone who raises a service desk request (later)  | Only their own requests                       |
| Agent / API key  | AI agent, automation or integration with an owner | Listed scopes, capped at the owner's access   |

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

## 5. Draft matrix: engineering MVP

Y = allowed. N = not allowed. Own = only on objects they created or are assigned. Team = only
within teams they belong to. All values are proposed.

| Object: action               | Org admin | Team admin | Member | Viewer |   Agent / API key   |
| ---------------------------- | :-------: | :--------: | :----: | :----: | :-----------------: |
| Work item: view              |     Y     |    Team    |  Team  |  Team  |      By scope       |
| Work item: create            |     Y     |    Team    |  Team  |   N    |      By scope       |
| Work item: edit fields       |     Y     |    Team    |  Team  |   N    |      By scope       |
| Work item: change status     |     Y     |    Team    |  Team  |   N    |      By scope       |
| Work item: assign            |     Y     |    Team    |  Team  |   N    |      By scope       |
| Work item: delete            |     Y     |    Team    |  Own   |   N    |          N          |
| Comment: add                 |     Y     |    Team    |  Team  |   N    |      By scope       |
| Comment: edit or delete own  |     Y     |     Y      |   Y    |   N    |      By scope       |
| Comment: delete any          |     Y     |    Team    |   N    |   N    |          N          |
| Attachment: add              |     Y     |    Team    |  Team  |   N    |      By scope       |
| Attachment: delete           |     Y     |    Team    |  Own   |   N    |          N          |
| Saved view: create and share |     Y     |    Team    |  Team  |  Own   |          N          |
| Team configuration: edit     |     Y     |    Team    |   N    |   N    |          N          |
| Org configuration: edit      |     Y     |     N      |   N    |   N    |          N          |
| Audit log: view              |     Y     |     N      |   N    |   N    |          N          |
| Export items                 |     Y     |    Team    |  Team  |   N    | By scope, see dec 5 |

## 6. Decisions the owner needs to make

| #   | Question                                                                                             | Proposed default                                                             |
| --- | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| 1   | Can internal members see items of teams they are not on?                                             | Yes for engineering teams (open by default), with private teams as an option |
| 2   | Is there a "private team" or "restricted item" concept in the MVP (for example security or HR work)? | Private teams yes; per-item restriction later                                |
| 3   | Can members delete items, or only cancel or archive them?                                            | Soft delete only, restorable for 30 days; hard delete by org admin           |
| 4   | Who can move an item to another team?                                                                | Members of both teams, or a team admin of the source team                    |
| 5   | Who may export data, and is every export logged?                                                     | Members for their teams; every export audited                                |
| 6   | Can agents and API keys ever delete, or change configuration?                                        | No                                                                           |
| 7   | Is "viewer" needed at launch, or are all internal users members?                                     | Keep viewer; it costs little and suits stakeholders                          |
| 8   | When someone leaves a team, do they keep access to items they created or are assigned?               | No; access follows current membership                                        |
| 9   | Do org admins see everything, including private teams?                                               | Yes, and each such view of a private team is audited                         |
| 10  | For clients later: do guests see internal notes, time entries, rates or other guests?                | No to all four                                                               |

Decision 1 conflicts with the "Team" values in section 5: if the answer is "yes, open by
default", the view row becomes Y for members and viewers on all non-private teams.

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
