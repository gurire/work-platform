# 0007: Stages, stage owners, reviews, records and code-driven status

Status: proposed (2026-11-16). Merging this file to `main` accepts it.

## Context

The owner's Jira history showed that most work was a staged pipeline with review loops, not
sprint-based software work, and that teams worked around Jira with extra owner fields, review
text fields and 40-field tickets. Research into other tools found ready patterns for these
needs. The owner asked for all six ideas below to be adopted (16 Nov 2026). The designs on the
canvas already show them.

## Decision

1. **Stages with an owner each.** A team's workflow is an ordered set of stages. An item
   records who owned each stage. Handing over clears the current owner so the next stage picks
   the item up. `assigneeId` becomes "current stage owner".
2. **Stage rules.** A stage can require fields or checklist steps before an item leaves it,
   and lists the stages an item may move to from it. The move control stays disabled until the
   requirements are met, and says what is missing. "Any stage to any stage" is possible only
   as an explicit team setting.
3. **Review rounds as a built-in object.** A review has a reviewer, a verdict (approved,
   changes requested) and a comment, grouped into numbered rounds. "Changes requested" moves
   the item back to a configured stage automatically and shows the reason on the item.
4. **Records beside work items.** A record holds the facts about a thing being worked on (for
   example a dataset). Work items link to a record instead of copying its fields. Record types
   and their fields come from the shared catalogue.
5. **Stage limits and waiting-time targets.** A stage can have a limit on items in it and a
   target time. Boards and lists flag items and stages that exceed them. Limits warn; they do
   not block.
6. **Status that follows the code,** for software teams: opening a pull request, passing or
   failing checks, and merging move the item, and every automatic move shows its reason. A
   person can always override.

Status categories stay as they are (`todo`, `in_progress`, `done`, `cancelled`). Each stage
belongs to one category, and "resolved" is derived from the category.

## Consequences

- The work item model in `@wm/shared` and the database need new tables: stages, stage
  history, stage rules, reviews, record types and records. These arrive as expand-only
  migrations, one small slice at a time.
- The fixed sample status list is replaced by team stages. A workflow spec is needed in
  `specs/` before stage rules are built.
- The list, board and item screens are rebuilt around stages, in the order: stages and
  owners, stage rules, reviews, records, limits, code-driven status.

## Changes the permission spec will need (owner to decide; the spec is not edited here)

1. Does a stage owner count as "Own" for delete and restore, or only the creator?
2. A **reviewer** role: may read, comment and give a verdict, but not move, assign or edit
   items. Jira had this for client reviewers. Is it a team role or a client guest role?
3. Who may edit a record: members of any team that works on it, or a record owner?
4. May a person override a code-driven status, and is the override audited?
5. Records may be visible more widely than the items about them. What is the default?

## Not decided here

Hill charts, request forms, the table view and quick capture are designed on the canvas as
proposals only.
