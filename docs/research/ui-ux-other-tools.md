<h1 align="center">UI/UX Patterns From Other Work Tools</h1>
<p align="center">What to borrow, and what to avoid, from tools other than Jira and Linear</p>

<table>
  <tr><td valign="middle"><b>Date</b></td><td valign="middle">16 Nov 2026</td></tr>
  <tr><td valign="middle"><b>Reference</b></td><td valign="middle">UX-RESEARCH-002</td></tr>
  <tr><td valign="middle"><b>Subject</b></td><td valign="middle">Interface patterns from Asana, Notion, Airtable, GitHub Projects, monday.com, ClickUp, Trello, Basecamp, Pipefy, Wrike, Smartsheet and others, and how the designs use them</td></tr>
</table>

Status: research input, not a decision. It extends `ui-ux-research.md`, which covered Linear
and Jira. Design canvas (private to the owner): https://claude.ai/artifact/MTFx7PBgDRvRwsMPiWsL9i

Source quality: vendor help pages and changelogs are reliable for what a feature does. Likes
and dislikes come from user forums and review sites, so they show that a reaction exists, not
how common it is. No tool was tested hands-on.

## 1. Patterns adopted in the designs

| Pattern                                                                              | Seen in                                     | Where it is used in our designs                                      |
| ------------------------------------------------------------------------------------ | ------------------------------------------- | -------------------------------------------------------------------- |
| Three panes: navigation, list, detail panel beside the list                          | Asana, Notion                               | My work: selected item opens in a side panel; the list stays usable  |
| Choose how an item opens: side panel, centre, or full page, per view                 | Notion                                      | "Open as" control in the view header                                 |
| Up to four key properties pinned under the title; the rest grouped                   | Notion, Asana                               | Item detail and side panel show Stage, Stage owner, In stage, Record |
| Slice panel: a field's values listed beside the view; click to filter                | GitHub Projects                             | My work: Team slice with counts                                      |
| View settings shown in the header, not hidden in a menu                              | GitHub Projects                             | Group, Slice, Fields and Open as buttons in the header               |
| Counts or sums in group headers and column tops                                      | GitHub Projects                             | Group headers and board columns                                      |
| Personal sections for your own work, moved with number keys                          | Asana (My Tasks)                            | "New for you" group; keys 1 to 4 for Today, Next, Later, New         |
| Review layout: queue on the left, one record on the right, one-click verdict buttons | Airtable (record review), Wrike (approvals) | New Reviews screen for reviewers                                     |
| Stage forms: fields a stage requires, blocking the move until filled                 | Pipefy                                      | "Before this can move on" checklist; the move button stays disabled  |
| Allowed destinations defined per stage                                               | Pipefy                                      | Only the permitted moves are offered from a stage                    |
| A few status colours tied to meaning, not a free palette                             | monday.com (lesson)                         | Status pills use five fixed colours, always with a text label        |
| Collapsible sidebar that the user controls with a click or key                       | Asana                                       | "Collapse sidebar" control                                           |
| Status updated from code activity                                                    | Shortcut, Linear                            | Software cycle screen                                                |

## 2. Lessons on what to avoid

| Lesson                                                                                                  | Source                           | Rule for us                                                              |
| ------------------------------------------------------------------------------------------------------- | -------------------------------- | ------------------------------------------------------------------------ |
| Reorganising navigation repeatedly drives users away                                                    | ClickUp feedback board           | Navigation layout is stable; changes ship behind a flag with notice      |
| Hiding one-click actions behind an extra click, and removing a pinned list of boards, caused a backlash | Trello 2025 redesign threads     | Keep stage actions visible on the item; keep teams pinned in the sidebar |
| Free colour choice for statuses produces a "rainbow" that is hard to read                               | monday.com community             | Fixed, small status palette                                              |
| A detail panel that squeezes list columns until they are unreadable                                     | Asana forum                      | The side panel has a fixed width and the list keeps its key columns      |
| Spreadsheet-first tools feel crammed and dated, and handle sub-items poorly                             | Smartsheet reviews               | Offer a table view for bulk edits, but not as the default surface        |
| Interfaces that expose everything overwhelm newcomers                                                   | Azure Boards and ClickUp reviews | Show few controls by default; put the rest in the command palette        |

## 3. Ideas noted but not adopted yet

- **Hill charts (Basecamp):** show whether work is still being figured out or is being
  executed, with history snapshots. Possible later for software cycles.
- **Request forms that route work automatically (Wrike, Pipefy start forms):** needed for
  intake; belongs with the forms and intake feature, not these screens.
- **Table view with fill-down and inline cell editing (Smartsheet, Notion, Asana):** useful
  for bulk metadata edits on records.
- **Hierarchy shown inside the table, expandable (GitHub Projects):** for parent items with
  per-stage sub-items.
- **Quick capture into an inbox from email or chat (Trello):** fits the mobile product.

## 4. Not researched

Service desk agent tools (Zendesk, Freshservice) beyond the earlier research, resource
planning tools, and mobile apps of the tools above.

## Sources

- Asana, collapsible left pane: https://asana.com/inside-asana/leftpane
- Asana, task pane redesign: https://asana.com/inside-asana/task-pane-redesign
- Asana forum, columns hidden by the detail panel: https://forum.asana.com/t/see-project-and-due-date-columns-when-clicking-on-a-specific-task-to-see-details-in-the-right-side-panel-in-my-tasks-regardless-of-the-screen-size/103657
- Asana My Tasks sections and shortcuts (consultant write-up): https://medium.com/asana-consulting-trilogi-solutions/your-simple-or-advanced-strategy-for-asanas-updated-my-tasks-8e45e304fc3a
- Notion, views and "open pages as": https://notion.com/help/views-filters-and-sorts
- Notion page layouts (third-party guide): https://simonesmerilli.com/writing/notion-layouts
- Airtable, choosing an interface layout: https://support.airtable.com/docs/choosing-a-layout-for-your-interface
- GitHub Projects, slice by: https://github.blog/changelog/2023-08-10-github-issues-projects-august-10th-update/
- GitHub Projects, board layout and field sums: https://docs.github.com/en/issues/planning-and-tracking-with-projects/customizing-views-in-your-project/customizing-the-board-layout
- GitHub Projects, hierarchy view: https://github.blog/changelog/2026-01-15-hierarchy-view-now-available-in-github-projects/
- monday.com community, status colours: https://community.monday.com/t/customizable-and-reusable-color-options-for-status-columns/100049
- ClickUp feedback, UX changes: https://feedback.clickup.com/feature-requests/p/stop-changing-the-ux-so-frequently
- Trello redesign discussion: https://community.atlassian.com/forums/Trello-articles/The-new-Trello-is-coming-soon-to-everyone/ba-p/3015921
- Pipefy, moving cards and required fields: https://help.pipefy.com/en/articles/614653-moving-cards-through-the-pipe
- Pipefy community, phase movement control: https://community.pipefy.com/permissions-and-users-149/phase-movement-control-flow-design-not-just-permissions-5259
- Wrike approvals: https://wrike.com/features/approvals
- Basecamp hill charts: https://basecamp.com/hill-charts
- Smartsheet review: https://www.expertreviews.co.uk/technology/software-services/smartsheet-review
- Azure Boards reviews: https://www.g2.com/products/azure-boards/reviews
