<h1 align="center">Records</h1>
<p align="center">The facts about the things a team works on, kept once and linked from work items</p>

<table>
  <tr><td valign="middle"><b>Date</b></td><td valign="middle">17 Nov 2026</td></tr>
  <tr><td valign="middle"><b>Reference</b></td><td valign="middle">SPEC-RECORD-001</td></tr>
  <tr><td valign="middle"><b>Subject</b></td><td valign="middle">Record types, records, linking work items, editing, history and visibility</td></tr>
</table>

**Status: DRAFT. Written without the owner's answers to ADR 0007 questions 3 and 5; the safer
choice is used for both and marked "Default". It becomes binding when the owner merges it,
after changing anything that is wrong.** It builds on `docs/adr/0007-stages-reviews-records.md`
(decision 4) and `specs/permission-matrix.md`.

---

## 1. Terms

- **Record type:** a kind of thing, such as _Dataset_, with a list of fields. Record types are an
  org-wide catalogue.
- **Field:** one fact on a record. Each field has a key, a label, a kind (text, number, date,
  link or choice), whether it is required, and for a choice its options.
- **Record:** one thing, such as the dataset "Rainfall by district". It has a type, a title, a
  value for each field, and a **home team** that looks after it.
- **Linked item:** a work item that is about a record. An item links to at most one record; a
  record can have any number of items, from any team.

## 2. Rules

1. **Facts live on the record, not the item.** An item shows its record's fields instead of
   copying them, so a change to the record shows on every linked item at once.
2. **Field values must fit the field.** Numbers are numbers, dates are dates (YYYY-MM-DD),
   links start with https:// or http://, a choice is one of its options. Required fields can
   never be left empty. Values for fields the type does not have are refused.
3. **Every change is kept.** Each edit records who, when, and each field's old and new value.
   History is never edited or deleted.
4. **Records are archived, not deleted.** An archived record keeps its history and its links,
   is hidden from pickers and lists, and cannot be edited or newly linked.
5. **Linking an item is editing the item.** It needs permission to edit the item and to view
   the record. Unlinking needs permission to edit the item.
6. **The catalogue is org configuration.** Adding or changing record types is an org admin
   action (`org.config.edit`).

## 3. Defaults used for the open questions (owner to confirm)

1. **Who may edit a record (ADR 0007, question 3).** Admins and members of the record's home
   team. Teams that only link to the record may not edit it. _The wider choice would let
   members of any team with a linked item edit it._
2. **Who may see a record (ADR 0007, question 5).** Exactly who may see items of its home team:
   everyone internal for an open team, only its members for a private team. A record is never
   visible more widely than its home team. _The wider choice would let anyone who can see a
   linked item see the record._
3. **Archiving** is for team admins of the home team.
4. **Agents** may view, create and edit records within their scopes, never archive.

## 4. Additions to the permission matrix

| Object: action                   | Org admin | Team admin | Member | Reviewer | Viewer | Agent / API key |
| -------------------------------- | :-------: | :--------: | :----: | :------: | :----: | :-------------: |
| Record: view                     |     Y     |    Open    |  Open  |   Open   |  Open  |    By scope     |
| Record: create in a home team    |     Y     |    Team    |  Team  |    N     |   N    |    By scope     |
| Record: edit fields              |     Y     |    Team    |  Team  |    N     |   N    |    By scope     |
| Record: archive                  |     Y     |    Team    |   N    |    N     |   N    |        N        |
| Record types: edit the catalogue |     Y     |     N      |   N    |    N     |   N    |     Granted     |

"Team" and "Open" refer to the record's home team. Seeing a record uses the same check as seeing a work item of its
home team, so the two can never differ.

## 5. Worked examples

1. DATA looks after the Dataset record "Rainfall by district" (source: IMD, frequency: monthly).
   Twelve DATA items are linked to it. Grace changes the source to "IMD gridded"; all twelve
   items show the new source, and the record's history shows Grace's change with the old value.
2. Chen sets the frequency to "weekly", which is not one of the options. Refused; nothing
   changes.
3. Chen clears the source, a required field. Refused.
4. An ENG member links an ENG item to the record. Allowed: they can edit their item and see the
   record (DATA is open). They then try to edit the record's frequency. Refused: ENG is not the
   home team.
5. A record whose home team is the private SEC team is invisible to an ENG member, in lists,
   pickers and on any item linked to it.
6. Grace archives a record. Its linked items still show it, marked archived; it can no longer be
   edited or picked for new links.

## 6. Not covered yet

- Changing a record's type or home team.
- Records linked to other records (for example a dataset and its publisher).
- Importing records in bulk.
