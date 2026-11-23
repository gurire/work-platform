<h1 align="center">Data Model</h1>
<p align="center">What the platform stores and the rules that keep it consistent</p>

<table>
  <tr><td valign="middle"><b>Date</b></td><td valign="middle">23 Nov 2026</td></tr>
  <tr><td valign="middle"><b>Reference</b></td><td valign="middle">SPEC-MODEL-001</td></tr>
  <tr><td valign="middle"><b>Subject</b></td><td valign="middle">Projects, items, sub-items, milestones, stages, stage types, fields, recurring runs, reviews, comments, intake and history</td></tr>
</table>

**Status: DRAFT.** Written from the concept brief WP-BRIEF-002 and the approved wireframes, as
decided in `docs/adr/0008-restart.md`. It becomes binding when the owner merges it. Rules about
moves, reviews and permissions stay in `workflow.md`, `reviews.md` and `permission-matrix.md`;
this spec only says what exists and how the pieces relate.

---

## 1. What is stored

<table>
  <tr><th valign="middle">Thing</th><th valign="middle">What it is</th><th valign="middle">Main facts</th></tr>
  <tr><td valign="middle">Person</td><td valign="middle">Someone who can sign in. Invited by an org admin; signs in with Cognito.</td><td valign="middle">name, email, theme (dark, light or system), start page, time zone (default Asia/Kolkata)</td></tr>
  <tr><td valign="middle">Team</td><td valign="middle">A group that owns items and their stages.</td><td valign="middle">name, key prefix (2–6 capital letters, e.g. DATA), estimate unit (hours or points), weekly capacity per person</td></tr>
  <tr><td valign="middle">Team member</td><td valign="middle">A person in a team.</td><td valign="middle">role: member or admin. A person may be in several teams.</td></tr>
  <tr><td valign="middle">Project</td><td valign="middle">Groups items from any teams towards an outcome.</td><td valign="middle">name, colour (from a fixed set of 8), owner, start and end dates (optional), archived</td></tr>
  <tr><td valign="middle">Milestone</td><td valign="middle">A dated checkpoint inside a project.</td><td valign="middle">name, due date, position, done date</td></tr>
  <tr><td valign="middle">Stage</td><td valign="middle">One step in a team’s workflow.</td><td valign="middle">name, stage type, position, item limit, waiting target (hours), for Done stages: completed or cancelled</td></tr>
  <tr><td valign="middle">Allowed move</td><td valign="middle">A move a team permits from one stage to another.</td><td valign="middle">from stage, to stage</td></tr>
  <tr><td valign="middle">Item</td><td valign="middle">A piece of work.</td><td valign="middle">key, title, description, team, project, milestone, parent, stage, owner, priority, due date, estimate, labels, field values</td></tr>
  <tr><td valign="middle">Field</td><td valign="middle">A field definition, from the org library or added by one team.</td><td valign="middle">key, label, type, options, scope (library or team)</td></tr>
  <tr><td valign="middle">Label</td><td valign="middle">A free tag shared across the organisation.</td><td valign="middle">name</td></tr>
  <tr><td valign="middle">Schedule</td><td valign="middle">When a recurring item starts its next run.</td><td valign="middle">rule, start stage, next start time</td></tr>
  <tr><td valign="middle">Run</td><td valign="middle">One go of a recurring item.</td><td valign="middle">number, started at, how started (schedule or by hand), start stage, ended at, outcome</td></tr>
  <tr><td valign="middle">Stage pass</td><td valign="middle">One stay of an item in a stage.</td><td valign="middle">run (if any), stage, owner, entered at, left at, who moved it</td></tr>
  <tr><td valign="middle">Review</td><td valign="middle">A reviewer’s verdict while an item is in a Review stage.</td><td valign="middle">reviewer, verdict (approved or changes requested), note, round</td></tr>
  <tr><td valign="middle">Comment</td><td valign="middle">A message on an item.</td><td valign="middle">author, text, mentions, run number (if any), edited at</td></tr>
  <tr><td valign="middle">Attachment</td><td valign="middle">A file on an item or comment.</td><td valign="middle">name, type, size, storage key, uploaded by</td></tr>
  <tr><td valign="middle">Intake form</td><td valign="middle">A team’s request form.</td><td valign="middle">team, name, questions, stage accepted requests start in</td></tr>
  <tr><td valign="middle">Request</td><td valign="middle">A filled-in intake form.</td><td valign="middle">form, requester, answers, status (new, needs info, accepted, declined), item</td></tr>
  <tr><td valign="middle">Notification</td><td valign="middle">An inbox entry for one person.</td><td valign="middle">kind, item, actor, read at</td></tr>
  <tr><td valign="middle">Item event</td><td valign="middle">The history of an item.</td><td valign="middle">who, what changed, before, after, when</td></tr>
</table>

Every thing has an id (UUID version 7), a created time and an updated time. Items, projects,
comments and attachments are deleted softly (a deleted time) and can be restored for 30 days.

## 2. Rules

### Organisation and teams

1. **One organisation.** There is no organisation id on records; a second organisation is out of
   scope (ADR 0008).
2. **Everyone sees everything** in the first version. Private teams and projects come in release 2.
3. **A team has 1–2 admins** (more are allowed). The owner is an org admin and counts as admin
   of every team.

### Projects, items and sub-items

4. **Every item belongs to exactly one team** and is always in one of that team’s stages.
5. **An item may belong to one project or none.** Any member of any team may create a project and
   add their team’s items to it.
6. **Item keys** are the team’s prefix and a number that only goes up, e.g. `DATA-14`. Keys are
   never reused. Moving an item to another team gives it a new key; the old key keeps working as a
   link.
7. **Sub-items are one level deep.** A sub-item is an item with a parent. It is in the same team
   and the same project as its parent, and cannot have sub-items of its own.
8. **Milestones belong to one project.** An item’s milestone must be in the item’s project; moving
   the item out of the project clears its milestone.

### Stages and stage types

9. **Every stage has one of four stage types:**

<table>
  <tr><th valign="middle">Stage type</th><th valign="middle">Means</th><th valign="middle">Example stage names</th></tr>
  <tr><td valign="middle">Waiting</td><td valign="middle">Not started, or waiting on someone outside the team</td><td valign="middle">Backlog, To do, Triage, Waiting on vendor</td></tr>
  <tr><td valign="middle">Doing</td><td valign="middle">Being worked on</td><td valign="middle">Ingest, Transform, In progress</td></tr>
  <tr><td valign="middle">Review</td><td valign="middle">Waiting for reviewers to approve or send back</td><td valign="middle">QA review, Code review, Design review</td></tr>
  <tr><td valign="middle">Done</td><td valign="middle">Finished: completed or cancelled</td><td valign="middle">Published, Released, Cancelled</td></tr>
</table>

10. **A team has at least one stage of each type**, except Review, which is optional. Stages are
    ordered; the first Waiting stage is where new items start unless a form or schedule says
    otherwise.
11. **Done stages say whether they mean completed or cancelled.** Dashboards count only
    completed as done.
12. **Allowed moves** are listed per team. When a team lists none for a stage, the default is: the
    next stage, the previous stage, and any Done stage. Moving rules (requirements, forced moves)
    are in `workflow.md`.
13. **Changing a stage’s type** is allowed only when it has no items in it.
14. **Deleting a stage** requires choosing where its items go.

### Fields

15. **The org library** holds shared fields, so reports work across teams. The defaults:

<table>
  <tr><th valign="middle">Field</th><th valign="middle">Type</th><th valign="middle">Default for a new team</th></tr>
  <tr><td valign="middle">Priority</td><td valign="middle">Pick one: Urgent, High, Medium, Low</td><td valign="middle">On (always)</td></tr>
  <tr><td valign="middle">Due date</td><td valign="middle">Date</td><td valign="middle">On (optional per item)</td></tr>
  <tr><td valign="middle">Labels</td><td valign="middle">Many labels</td><td valign="middle">On</td></tr>
  <tr><td valign="middle">Estimate</td><td valign="middle">Number, in the team’s unit (hours or points)</td><td valign="middle">On</td></tr>
  <tr><td valign="middle">Reviewers</td><td valign="middle">People</td><td valign="middle">On for teams with a Review stage</td></tr>
  <tr><td valign="middle">Milestone</td><td valign="middle">A milestone of the item’s project</td><td valign="middle">Off</td></tr>
</table>

16. **Teams add their own fields** of these types: short text, long text, number, date, pick one, pick many, person, link. Team fields are visible only on that
    team’s items. A team may have at most 25 fields of its own.
17. **Title, stage, owner, team and project** are built in, not fields.
18. **Turning a field off hides it but keeps its values;** turning it back on shows them again.

### Recurring items and runs

19. **A recurring item has a schedule and numbered runs.** Run 1 starts when the item is made
    recurring or at its first scheduled time.
20. **Starting a run** moves the item to the schedule’s start stage, sets the owner set on the
    schedule (or keeps the current one), and clears checklist ticks. Runs start on the schedule
    or by hand from the item page.
21. **One run at a time.** A run ends when the item reaches a Done stage. If the next scheduled
    time arrives while a run is still open, the new run does not start; the item’s owner and team
    admins get an inbox notice, and the run starts as soon as the open one ends.
22. **Each run keeps its own history:** start and end times, every stage pass with its owner and
    times, the comments written during it, and the item’s field values at the moment it ended.
23. **Schedule rules** supported in the first version: every day; every week on chosen weekdays;
    every month on a day number or on the first or last working day (Monday–Friday); every
    quarter on the first working day. Times are in the team’s time zone (default Asia/Kolkata).

### Reviews

24. **Entering a Review stage asks the item’s reviewers** (the Reviewers field, or the team’s
    default reviewers). Each reviewer approves or asks for changes with a note. When the stage’s
    approval rule is met (any one reviewer, or all reviewers), the item moves to the stage the team
    set as "after approval". "Changes requested" moves it to the stage set as "send back to".
    Details stay in `reviews.md`.
25. **Each visit to a Review stage is a new round;** earlier rounds stay visible.

### Comments, mentions, attachments

26. **Comments are plain text with simple formatting** (bold, italic, lists, links, code).
    Writing `@name` mentions a person and sends them an inbox notice.
27. **Attachments** can be pictures, documents, PDFs and spreadsheets, up to 25 MB each, stored in
    S3. Images show a preview.

### Intake forms and requests

28. **Each team may have several intake forms.** Anyone in the organisation can fill one in.
29. **A request waits in the team’s triage list** until someone in the team accepts it (it becomes
    an item in the form’s start stage, with the requester as watcher), asks for more information,
    or declines it with a reason. The requester is told each time.

### History and notifications

30. **Every change to an item is recorded** as an item event: who, what, before and after, when.
    The item page shows them under Activity.
31. **Notifications** go to the inbox for: being made owner, mentions, reviews asked of you, items
    sent back to you, comments on items you own or watch, and runs that could not start. Browser
    and desktop pop-ups follow each person’s settings.

## 3. Limits

<table>
  <tr><th valign="middle">Limit</th><th valign="middle" align="center">Value</th></tr>
  <tr><td valign="middle">Stages per team</td><td valign="middle" align="center">30</td></tr>
  <tr><td valign="middle">Fields of a team’s own</td><td valign="middle" align="center">25</td></tr>
  <tr><td valign="middle">Options in a pick-one or pick-many field</td><td valign="middle" align="center">100</td></tr>
  <tr><td valign="middle">Title length</td><td valign="middle" align="center">200 characters</td></tr>
  <tr><td valign="middle">Comment length</td><td valign="middle" align="center">20,000 characters</td></tr>
  <tr><td valign="middle">Attachment size</td><td valign="middle" align="center">25 MB</td></tr>
  <tr><td valign="middle">Days a deleted thing can be restored</td><td valign="middle" align="center">30</td></tr>
</table>

## 4. Tests that prove it

1. Creating an item without a team or stage is refused.
2. A sub-item of a sub-item is refused; a sub-item in a different project from its parent is refused.
3. An item key is never reused, even after the item is deleted.
4. A milestone from another project cannot be set on an item.
5. Changing the type of a stage that holds items is refused.
6. A scheduled run does not start while the previous run is open, and a notice is sent.
7. Each run keeps its own stage passes, comments and ending field values.
8. Turning a team field off and on again keeps its values.

## 5. Open questions for the owner

1. May a sub-item be in a different team from its parent (for example a Software task under a
   Data item)? This draft says no.
2. Should cancelled items count towards a project’s progress bar, or be left out entirely? This
   draft leaves them out.
3. Are watchers needed in the first version beyond the requester of a request?
