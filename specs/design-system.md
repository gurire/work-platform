<h1 align="center">Design System — Midnight</h1>
<p align="center">How the app looks: colours, type, spacing and every component, in dark and light</p>

<table>
  <tr><td valign="middle"><b>Date</b></td><td valign="middle">23 Nov 2026</td></tr>
  <tr><td valign="middle"><b>Reference</b></td><td valign="middle">SPEC-DESIGN-001</td></tr>
  <tr><td valign="middle"><b>Subject</b></td><td valign="middle">The approved Midnight look written down as rules the web, desktop and phone apps must follow</td></tr>
</table>

**Status: DRAFT.** Written from the approved wireframes and the Midnight direction chosen on 23 Nov 2026. It becomes
binding when the owner merges it. The live reference is the design canvas
(https://claude.ai/artifact/RoXokgBuwJ5YSfAVHghgXr): page "Final — Midnight" for screens and the "Component sheet"
for every element and state. Where this spec and the canvas disagree, this spec wins.

---

## 1. Rules

1. **Tokens only.** Components use the named colour tokens in section 2, never colour values written directly.
   Dark and light mode are two sets of values for the same tokens.
2. **Dark is the default.** Each person can switch to light; the choice is saved with their profile and follows them
   across devices. A "match my system" option is allowed.
3. **Neutrals do about 90% of the work.** Cool zinc greys for backgrounds, surfaces, borders and text.
4. **The accent is rare.** Electric indigo (#5E6AD2) only marks primary buttons, the active or selected thing, links and
   the focus ring. It is never used for status.
5. **Status colours are fixed** (section 3) and mean the same thing everywhere: lists, boards, calendar, dashboard.
6. **Never colour alone.** Every status, priority, warning or error also shows a word or a symbol.
7. **Readable in both modes.** Text meets 4.5 to 1 contrast (3 to 1 for text 24 px and larger). White text on the
   accent is allowed because #5E6AD2 meets 4.5 to 1.
8. **Glow is for dark mode only** and only on: primary buttons, the selected card, switched-on toggles, the unread
   dot, and status or priority tags. Light mode uses plain soft shadows instead.

## 2. Colour tokens

<table>
  <tr><th valign="middle">Token</th><th valign="middle">Dark (default)</th><th valign="middle">Light</th><th valign="middle">Used for</th></tr>
  <tr><td valign="middle">--bg</td><td valign="middle">#09090B + two soft glows (indigo top right, violet bottom left)</td><td valign="middle">#FAFAFA</td><td valign="middle">Page background</td></tr>
  <tr><td valign="middle">--surface</td><td valign="middle">#111113</td><td valign="middle">#FFFFFF</td><td valign="middle">Cards, panels, list rows</td></tr>
  <tr><td valign="middle">--surface-2</td><td valign="middle">#18181B</td><td valign="middle">#F4F4F5</td><td valign="middle">Raised or hovered things: menus, palette, inner boxes, row hover</td></tr>
  <tr><td valign="middle">--col</td><td valign="middle">#141417</td><td valign="middle">#F4F4F5</td><td valign="middle">Board columns</td></tr>
  <tr><td valign="middle">--side-bg</td><td valign="middle">#0C0C0E at 88%</td><td valign="middle">#F4F4F5</td><td valign="middle">Sidebar</td></tr>
  <tr><td valign="middle">--border</td><td valign="middle">#27272A</td><td valign="middle">#E4E4E7</td><td valign="middle">Card and panel edges</td></tr>
  <tr><td valign="middle">--divider</td><td valign="middle">#1F1F23</td><td valign="middle">#EDEDEF</td><td valign="middle">Lines between rows</td></tr>
  <tr><td valign="middle">--border-strong</td><td valign="middle">#3F3F46</td><td valign="middle">#D4D4D8</td><td valign="middle">Input edges, dashed quick-add boxes</td></tr>
  <tr><td valign="middle">--text</td><td valign="middle">#FAFAFA</td><td valign="middle">#09090B</td><td valign="middle">Main text</td></tr>
  <tr><td valign="middle">--text-2</td><td valign="middle">#D4D4D8</td><td valign="middle">#3F3F46</td><td valign="middle">Secondary text in nav and tables</td></tr>
  <tr><td valign="middle">--muted</td><td valign="middle">#A1A1AA</td><td valign="middle">#52525B</td><td valign="middle">Meta lines, hints, labels</td></tr>
  <tr><td valign="middle">--muted-2</td><td valign="middle">#8B8B93</td><td valign="middle">#63636B</td><td valign="middle">Disabled text, placeholders</td></tr>
  <tr><td valign="middle">--accent</td><td valign="middle">#5E6AD2</td><td valign="middle">#5E6AD2</td><td valign="middle">Primary buttons, selected card ring, logo, today in calendar</td></tr>
  <tr><td valign="middle">--accent-text</td><td valign="middle">#A5ACF5</td><td valign="middle">#4F5BC4</td><td valign="middle">Accent used as text: links, active tab, active nav item</td></tr>
  <tr><td valign="middle">--accent-soft</td><td valign="middle">#5E6AD2 at 16%</td><td valign="middle">#EEF0FC</td><td valign="middle">Background of active nav item, mention, run tag</td></tr>
  <tr><td valign="middle">--focus-ring</td><td valign="middle">#5E6AD2</td><td valign="middle">#5E6AD2</td><td valign="middle">Keyboard focus outline, 2 px with a 2 px gap</td></tr>
  <tr><td valign="middle">--danger</td><td valign="middle">#F87171</td><td valign="middle">#DC2626</td><td valign="middle">Overdue, urgent, errors, destructive actions</td></tr>
  <tr><td valign="middle">--btn-glow</td><td valign="middle">inner highlight + indigo edge + 22 px indigo glow</td><td valign="middle">small shadow + 14 px indigo glow</td><td valign="middle">Primary buttons only</td></tr>
</table>

## 3. Status and priority colours

Each stage belongs to one of four stage types (see `workflow.md`). The tag shows the team's own stage name, coloured by
its type.

<table>
  <tr><th valign="middle">Stage type</th><th valign="middle">Base colour</th><th valign="middle">Dark tag (background / text)</th><th valign="middle">Light tag (background / text)</th><th valign="middle">Example stages</th></tr>
  <tr><td valign="middle">Waiting</td><td valign="middle">#64748B slate</td><td valign="middle">#64748B at 18% / #CBD5E1</td><td valign="middle">#F1F5F9 / #475569</td><td valign="middle">Backlog, To do, Triage</td></tr>
  <tr><td valign="middle">Doing</td><td valign="middle">#0EA5E9 sky</td><td valign="middle">#0EA5E9 at 14% / #7DD3FC</td><td valign="middle">#F0F9FF / #0369A1</td><td valign="middle">Ingest, In progress</td></tr>
  <tr><td valign="middle">Review</td><td valign="middle">#F59E0B amber</td><td valign="middle">#F59E0B at 14% / #FCD34D</td><td valign="middle">#FFFBEB / #B45309</td><td valign="middle">QA review, Code review</td></tr>
  <tr><td valign="middle">Done</td><td valign="middle">#10B981 emerald</td><td valign="middle">#10B981 at 14% / #6EE7B7</td><td valign="middle">#ECFDF5 / #047857</td><td valign="middle">Published, Released</td></tr>
  <tr><td valign="middle">Urgent / overdue</td><td valign="middle">#EF4444 red</td><td valign="middle">#EF4444 at 15% / #FCA5A5</td><td valign="middle">#FEF2F2 / #B91C1C</td><td valign="middle">Priority Urgent, overdue dates</td></tr>
</table>

Priority tags use a small round icon in the base colour with a white symbol, then the word:

<table>
  <tr><th valign="middle">Priority</th><th valign="middle" align="center">Symbol</th><th valign="middle">Base colour</th></tr>
  <tr><td valign="middle">Urgent</td><td valign="middle" align="center">!</td><td valign="middle">#EF4444</td></tr>
  <tr><td valign="middle">High</td><td valign="middle" align="center">↑</td><td valign="middle">#F97316</td></tr>
  <tr><td valign="middle">Medium</td><td valign="middle" align="center">–</td><td valign="middle">#F59E0B</td></tr>
  <tr><td valign="middle">Low</td><td valign="middle" align="center">↓</td><td valign="middle">#64748B</td></tr>
</table>

Board split bars and charts use the four base colours in the order Waiting, Doing, Review, Done, with a 2 px gap between
segments.

## 4. Type

One font family: **Inter** (open licence), with the system sans-serif as fallback. Numbers in tables use tabular figures.

<table>
  <tr><th valign="middle">Use</th><th valign="middle" align="center">Size (px)</th><th valign="middle" align="center">Weight</th><th valign="middle">Letter spacing</th></tr>
  <tr><td valign="middle">Page title</td><td valign="middle" align="center">32</td><td valign="middle" align="center">600</td><td valign="middle">−0.02em</td></tr>
  <tr><td valign="middle">Section title</td><td valign="middle" align="center">18</td><td valign="middle" align="center">600</td><td valign="middle">0</td></tr>
  <tr><td valign="middle">Card title</td><td valign="middle" align="center">16</td><td valign="middle" align="center">600</td><td valign="middle">0</td></tr>
  <tr><td valign="middle">Body</td><td valign="middle" align="center">14</td><td valign="middle" align="center">400</td><td valign="middle">0</td></tr>
  <tr><td valign="middle">Row title</td><td valign="middle" align="center">15</td><td valign="middle" align="center">500</td><td valign="middle">0</td></tr>
  <tr><td valign="middle">Meta, labels</td><td valign="middle" align="center">12–13</td><td valign="middle" align="center">400–600</td><td valign="middle">0 (labels: upper case, +0.06em)</td></tr>
</table>

## 5. Spacing, corners and sizes

<table>
  <tr><th valign="middle">Thing</th><th valign="middle" align="center">Value (px)</th></tr>
  <tr><td valign="middle">Corner radius, cards and panels</td><td valign="middle" align="center">12</td></tr>
  <tr><td valign="middle">Corner radius, buttons, inputs, menus</td><td valign="middle" align="center">8</td></tr>
  <tr><td valign="middle">Corner radius, tags and avatars</td><td valign="middle" align="center">999 (fully round)</td></tr>
  <tr><td valign="middle">Sidebar width</td><td valign="middle" align="center">248</td></tr>
  <tr><td valign="middle">Content max width</td><td valign="middle" align="center">1200</td></tr>
  <tr><td valign="middle">Side panel width</td><td valign="middle" align="center">460</td></tr>
  <tr><td valign="middle">Page padding (desktop)</td><td valign="middle" align="center">40</td></tr>
  <tr><td valign="middle">Gap between cards</td><td valign="middle" align="center">20–24</td></tr>
  <tr><td valign="middle">Smallest click target</td><td valign="middle" align="center">40 (44 on phones)</td></tr>
</table>

Shadows: cards have none in dark (the border does the work) and a 1 px soft shadow in light. Menus, the command palette,
dialogs and pop-ups float with a larger soft shadow in both modes.

## 6. Components

Every component below must exist with the listed states before a page uses it. The Component sheet on the canvas
shows each one.

<table>
  <tr><th valign="middle">Component</th><th valign="middle">Kinds</th><th valign="middle">States</th><th valign="middle">Rules</th></tr>
  <tr><td valign="middle">Buttons</td><td valign="middle">Primary, Secondary, Ghost, Danger, Link</td><td valign="middle">Default, hover, focus, disabled, loading</td><td valign="middle">Sizes 32 / 40 / 48. Only one Primary per area. Loading keeps the width and shows a spinner. Icon-only buttons need a spoken name.</td></tr>
  <tr><td valign="middle">Inputs</td><td valign="middle">Text, search with icon, select, date, text area, quick add</td><td valign="middle">Default, focus, error, disabled</td><td valign="middle">Focus: accent edge plus a soft accent halo. Error: red edge plus a message under the box, never colour alone.</td></tr>
  <tr><td valign="middle">Toggles, checkboxes, radios</td><td valign="middle">On/off switch; checkbox; radio</td><td valign="middle">On, off, disabled</td><td valign="middle">Switch on = accent fill (glow in dark). Use real form controls so keyboards and screen readers work.</td></tr>
  <tr><td valign="middle">Status tags</td><td valign="middle">Waiting, Doing, Review, Done</td><td valign="middle">—</td><td valign="middle">Tint background, light edge, coloured dot, the stage name in words. Glow allowed in dark only.</td></tr>
  <tr><td valign="middle">Priority tags</td><td valign="middle">Urgent, High, Medium, Low</td><td valign="middle">—</td><td valign="middle">Small round icon with a symbol (! ↑ – ↓) plus the word.</td></tr>
  <tr><td valign="middle">Labels and counters</td><td valign="middle">Label, run tag (↻ Run 14), overdue tag, counter, unread dot</td><td valign="middle">—</td><td valign="middle">Labels stay neutral grey; only the run tag uses accent-soft.</td></tr>
  <tr><td valign="middle">Avatars</td><td valign="middle">24 / 32 / 40, stacked with +N, online dot, unassigned (?)</td><td valign="middle">—</td><td valign="middle">Initials on a tinted circle; stacked avatars overlap by 8 px with a ring in the surface colour.</td></tr>
  <tr><td valign="middle">Tabs</td><td valign="middle">Underline (page sections), pill (views), segmented (periods)</td><td valign="middle">Active, inactive, focus</td><td valign="middle">Active underline uses accent; active text uses accent-text.</td></tr>
  <tr><td valign="middle">Command palette</td><td valign="middle">Ctrl K search box with results and shortcuts</td><td valign="middle">Empty, typing, no match</td><td valign="middle">Top result highlighted with accent-soft and a 2 px accent bar on the left.</td></tr>
  <tr><td valign="middle">Menus</td><td valign="middle">Move menu, more-actions menu</td><td valign="middle">Item hover, disabled with reason, danger item</td><td valign="middle">Disabled moves stay visible with the reason (for example "needs 2 approvals").</td></tr>
  <tr><td valign="middle">Cards and rows</td><td valign="middle">Board card, selected card, list row, review card</td><td valign="middle">Default, hover, selected</td><td valign="middle">Selected card: accent edge, soft accent halo, 24 px glow in dark.</td></tr>
  <tr><td valign="middle">Stage path</td><td valign="middle">Past, current, next stages</td><td valign="middle">—</td><td valign="middle">Current stage uses its type colour and an accent ring; future stages are dashed.</td></tr>
  <tr><td valign="middle">Progress</td><td valign="middle">Bar, bar split by stage type, workload bar</td><td valign="middle">Normal, over capacity</td><td valign="middle">Split bars have 2 px gaps and a legend. Over capacity: red bar and the words "over by N h".</td></tr>
  <tr><td valign="middle">Feedback</td><td valign="middle">Pop-up messages (success, info, error), warning strip, tooltip</td><td valign="middle">Shown, dismissed</td><td valign="middle">Pop-ups stack bottom right, can be dismissed, and disappear after 6 s except errors.</td></tr>
  <tr><td valign="middle">Empty and loading</td><td valign="middle">Empty message with one action; grey loading bars</td><td valign="middle">—</td><td valign="middle">Every list has an empty message. Loading bars pulse gently and stop when motion is reduced.</td></tr>
  <tr><td valign="middle">Comment</td><td valign="middle">Comment with mention; comment box</td><td valign="middle">Default, focus</td><td valign="middle">Mentions use accent-soft background and accent-text.</td></tr>
  <tr><td valign="middle">Dialog</td><td valign="middle">Confirm or reason dialog</td><td valign="middle">Open, closing</td><td valign="middle">Used only for moves that need a note or confirm (send back, archive). Esc and Cancel close it.</td></tr>
</table>

## 7. Layout

1. **Desktop:** sidebar on the left (projects first, then teams), content in the middle up to 1200 px wide, item side
   panel on the right (460 px) that can expand to a full page.
2. **Narrow screens and phones:** the sidebar becomes a menu button, the side panel opens full screen, toolbars wrap,
   and wide tables scroll sideways inside their box.
3. **Board columns** are at least 240 px wide and scroll sideways when they do not fit.

## 8. Motion

1. Hover and state changes take 150 ms; panels and dialogs open in 200 ms.
2. Nothing moves on its own except spinners and loading bars.
3. When the person's system asks for reduced motion, transitions are instant and nothing pulses.

## 9. Tests that prove it

<table>
  <tr><th valign="middle" align="center">#</th><th valign="middle">Check</th></tr>
  <tr><td valign="middle" align="center">1</td><td valign="middle">No colour values written directly in component code: a check fails the build if a hex, rgb or hsl value appears outside the token file.</td></tr>
  <tr><td valign="middle" align="center">2</td><td valign="middle">Every text and background pair in both modes meets 4.5 to 1 (3 to 1 for text 24 px and larger); a test computes this from the token file.</td></tr>
  <tr><td valign="middle" align="center">3</td><td valign="middle">Every status and priority tag contains a word, not only a colour (click-through test checks the text).</td></tr>
  <tr><td valign="middle" align="center">4</td><td valign="middle">Keyboard: every control can be reached with Tab and shows the focus ring (click-through test).</td></tr>
  <tr><td valign="middle" align="center">5</td><td valign="middle">Switching light and dark changes only token values; the page does not reload and the choice is remembered per person.</td></tr>
  <tr><td valign="middle" align="center">6</td><td valign="middle">With reduced motion turned on, no glow pulses, spinners slow to a static icon, and loading bars stop pulsing.</td></tr>
</table>

## 10. Open questions for the owner

1. Should "match my system" be the default instead of dark?
2. Do teams get to pick a colour for their own projects (the small square next to each project in the sidebar), or
   do we assign one from a fixed set?
