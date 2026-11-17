<h1 align="center">Comments, Mentions and the Inbox</h1>
<p align="center">Talking about work on the item itself, and seeing what needs you</p>

<table>
  <tr><td valign="middle"><b>Date</b></td><td valign="middle">17 Nov 2026</td></tr>
  <tr><td valign="middle"><b>Reference</b></td><td valign="middle">SPEC-COMMENT-001</td></tr>
  <tr><td valign="middle"><b>Subject</b></td><td valign="middle">Comments and internal notes, editing and deleting, mentions, and inbox entries</td></tr>
</table>

**Status: DRAFT. Who may add, edit and delete comments is already settled in
`specs/permission-matrix.md` (decision 12); everything else here is a default chosen for the
owner to confirm.** It becomes binding when the owner merges it.

---

## 1. Terms

- **Comment:** text on a work item, by one person. Up to 10,000 characters.
- **Internal note:** a comment marked internal. Internal people see it like any comment; client
  guests and portal requesters never do.
- **Mention:** naming a person in a comment with @, picked from a list.
- **Inbox:** each person's list of things that need them, newest first.

## 2. Comments

1. **Seeing comments is seeing the item.** Whoever may view the item may read its comments.
2. **Adding** follows the matrix: org admins anywhere, team admins, members and reviewers in their
   own teams. Viewers never.
3. **Editing.** A person may edit their own comments at any time. The comment shows that it was
   edited, and every earlier version is kept.
4. **Deleting.** A person may delete their own comments; a team admin may delete anyone's in
   their team, and that is audited. A deleted comment leaves a "comment deleted" marker in its
   place; its text is kept for the audit trail but no longer shown.
5. **Comments are plain text.** No formatting is run, so nothing in a comment can change the
   page. Line breaks are kept and mentions are shown as names.

## 3. Mentions

1. **A mention names one person** by their id, chosen from a list, so a name shared by two
   people is never ambiguous.
2. **Only people who can see the item are told.** Mentioning someone who cannot see the item
   does not tell them anything, and does not reveal the item to them. The author is told who
   was not notified.
3. **Editing a comment tells only newly mentioned people.**

## 4. Inbox

1. **What arrives:** someone mentions you; you become an item's owner; you are asked to review;
   a round you opened is approved or has changes requested; someone comments on an item you
   own.
2. **Never about yourself.** Your own actions never put anything in your inbox.
3. **Only what you can still see.** An entry about an item you can no longer see is hidden,
   and comes back if you regain access.
4. **Read and unread.** Opening an entry marks it read; "Mark all as read" marks them all.
5. **The inbox is personal.** Nobody else, admins included, can read your inbox through the
   app.

## 5. Worked examples

1. Chen comments on DATA-12 "@Grace Lim can you check the totals?". Grace sees it in her inbox.
2. Chen mentions Asha, who is not on DATA. DATA is open, so Asha can see DATA-12 and is told.
3. On SEC-1 (in the private SEC team), Ben mentions Chen, who is not on SEC. Chen is told
   nothing and cannot see SEC-1; Ben sees "not notified: Chen Wei cannot see this item".
4. Ines (a DATA reviewer) comments on an item. Allowed. A viewer cannot comment.
5. Grace deletes Hugo's comment. It is replaced by "comment deleted", and the deletion is
   audited. Chen cannot delete Hugo's comment.
6. Chen assigns DATA-12 to Hugo. Hugo's inbox shows "Chen made you the owner of DATA-12". Chen
   assigning it to himself adds nothing.

## 6. Not covered yet

- Email or phone notifications, and choosing which kinds you receive.
- Following an item you do not own.
- Reactions, threads and attachments on comments.
- Live updates; the inbox refreshes every 30 seconds.
