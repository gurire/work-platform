<h1 align="center">Lessons From Our Jira Usage</h1>
<p align="center">What four years of real Jira configuration and data mean for the Work Platform design</p>

<table>
  <tr><td valign="middle"><b>Date</b></td><td valign="middle">16 Nov 2026</td></tr>
  <tr><td valign="middle"><b>Reference</b></td><td valign="middle">RESEARCH-JIRA-001</td></tr>
  <tr><td valign="middle"><b>Subject</b></td><td valign="middle">Design inputs drawn from the owner's Jira configuration report (30 Oct 2026 backup)</td></tr>
</table>

Status: research input, not a decision. Source: a configuration report the owner supplied,
built from a full Jira Cloud backup. The report itself is **not** stored in this repository,
and this summary leaves out project, client and people names on purpose.

Coverage: Claude read the report's summary parts and the appendices on issue types, statuses
and workflows. The appendices listing every custom field, issue layout and board were not read
in detail; consult them when designing fields and boards.

## 1. Scale (for sizing)

| Measure                            |     Value      |
| ---------------------------------- | :------------: |
| Projects                           |       17       |
| Issues, over about 4.5 years       |     24,380     |
| Field changes in history           |    612,628     |
| Comments                           |     53,357     |
| Attachments                        | 12,187 (13 GB) |
| Custom fields defined / with data  |   178 / ~95    |
| Statuses stored / distinct names   |   139 / ~60    |
| Accounts / active                  |   230 / 102    |
| Watch records (about 2.5 an issue) |     60,298     |

The 100,000-item performance target is about four times this history. History rows, not
items, are the large table: about 25 field changes per item.

## 2. What the work actually was

- About 73% of all items belonged to a **staged data pipeline** (one parent item per dataset,
  moving through analysis, sourcing, enrichment, processing, validation, then client review).
- About 13% belonged to conventional **software development** projects with sprints.
- The rest was feedback intake, documentation and small experiments.
- Sprints were used seriously in one project. Story points, epics (66 in total), versions and
  components were barely used or not at all. Priority was left at the default on 94% of items.

**Design question this raises:** "engineering first" was chosen with sprints, backlog and
Git/CI in mind. Historically most work was a stage pipeline with review loops. The first
workspace should serve stage queues ("my items in stage X") at least as well as sprints.

## 3. Problems to design out

| Problem seen                                                                                                          | Design response                                                                                           |
| --------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Each project cloned its own types, statuses and fields; the same field existed up to three times with different types | One shared catalogue; teams opt in and override labels or required flags, never clone (matches ADR 0003)  |
| Status categories set wrong (review stages marked done, work stages marked to do), breaking boards and reports        | Category is a validated attribute; warn when a "done" status has rework transitions                       |
| "Resolved" set three different ways, and never in the largest project                                                 | Derive resolved from the status category; no separate field to forget                                     |
| Fixed-list data kept as free text                                                                                     | Typed fields with option lists, including dependent lists                                                 |
| One assignee was not enough: five "stage owner" fields and per-stage sub-tasks worked around it                       | Stage-based or multi-role ownership as a first-class idea                                                 |
| Review verdicts lived in text fields edited thousands of times                                                        | A review primitive: reviewer, verdict, comment per round, automatic routing on "changes requested"        |
| Most workflows allowed any status to move to any other; process lived in habits                                       | Workflow guards (role, assignee, previous status, required fields) and "any to any" as an explicit choice |
| About 40 dataset fields on every ticket                                                                               | Domain records beside work items: the item is work on a record, not the record                            |
| External feedback carried in a description header, matched back by text                                               | Structured intake: reporter identity, source id, page, screenshots, status sync                           |
| Unused workflows, fields, types and app leftovers piled up                                                            | Usage counts on every configuration object; safe archiving                                                |
| High notification volume from automatic watching                                                                      | Watcher defaults, digests and per-event preferences                                                       |

## 4. Things that worked and should be kept

- **Saved filters as personal work queues**, usually "stage + assigned to me", often narrowed
  by a numeric record id. Search by a custom number field must be fast.
- **Board columns mirroring statuses**, so the whole pipeline is visible.
- **Clearing the assignee on hand-off**, so the next stage picks the item up.
- **Required fields checked at a specific transition** (metadata complete before sourcing starts).
- **Labels added automatically** when a review sends an item back.
- **Parent and child items**: 96% of all links were parent to sub-item.

## 5. Effects on decisions already made

| Area              | Effect                                                                                                                                                                              |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Work item model   | Has one `assigneeId`. Stage ownership needs a decision before the model hardens                                                                                                     |
| Permission matrix | Jira had a client-reviewer role that could read, create, edit and comment but **not** move or assign items. The matrix has no equivalent yet; needed when client roles are designed |
| Permission matrix | "Own" rules assume one creator. Stage owners may need to count as owners                                                                                                            |
| Statuses          | Currently a fixed sample list. The workflow spec should cover guards, required fields per transition and hand-off actions                                                           |
| Importer          | Must keep old keys working: three projects were renamed and 1,439 items changed key when moved                                                                                      |
| Internal notes    | No comment was ever restricted in Jira, so internal notes are lower priority than the matrix suggests                                                                               |
| Features to defer | Story points, versions, components and epics-first planning saw little or no use                                                                                                    |

## 6. Open questions for the owner

1. Is this platform for the same organisation and kinds of work as that Jira site?
2. If so, should the first workspace be the stage pipeline, software development, or both?
3. Are datasets (or similar records) something the platform should store, or do they live elsewhere?
