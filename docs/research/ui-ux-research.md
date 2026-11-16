<h1 align="center">UI/UX Research</h1>
<p align="center">Interface, interaction and front-end performance direction for the Work Platform</p>

<table>
  <tr><td valign="middle"><b>Date</b></td><td valign="middle">15 Nov 2026</td></tr>
  <tr><td valign="middle"><b>Reference</b></td><td valign="middle">UX-RESEARCH-001</td></tr>
  <tr><td valign="middle"><b>Subject</b></td><td valign="middle">What an ideal fast, pleasant and functional UI/UX looks like for this platform, and what to decide before building it</td></tr>
</table>

Status: research input, not a decision. Anything marked **Proposal** needs an ADR before it
becomes a rule. Sources are listed at the end; claims from vendor blogs are flagged.

---

## 1. Summary

1. **Speed is the product.** The one architecture reviewers praise is Linear's: data lives on
   the device, the UI reads from a local store, writes apply instantly and sync in the background.
2. **Calm beats clever.** Linear's 2026 refresh shows the direction: dimmed chrome, fewer borders,
   density kept but visual noise cut. Jira's recurring complaints are the opposite: clutter, too
   many fields, too many clicks, and navigation changes that break muscle memory.
3. **Keyboard first, mouse friendly.** A command palette, consistent single-key triage, visible
   shortcuts. Every action reachable by keyboard, and every drag action also reachable without dragging.
4. **One shell, three workspaces.** Same visual system and data model; different default views per
   audience (engineering board, service-desk queue, delivery timesheet and budget).
5. **Mobile is a different product.** Inbox, triage, approvals, quick capture, timers. Not the desktop shrunk.
6. **Accessibility is a design input, not a late audit.** WCAG 2.2 AA collides with dense UI in
   three places (target size, drag-only boards, sticky bars hiding focus), so decide early.
7. **Biggest risk to flag:** sync-engine choice interacts with the permission layer. Do not pick one
   before checking how it enforces per-user read rules (section 5).

---

## 2. What the market tells us

### 2.1 Jira's UX pain, and the design response

<table>
  <tr>
    <th valign="middle" align="left">Recurring complaint</th>
    <th valign="middle" align="left">Evidence</th>
    <th valign="middle" align="left">Design response</th>
  </tr>
  <tr>
    <td valign="middle">Too many clicks for simple tasks</td>
    <td valign="middle">Atlassian community threads on the 2025 navigation refresh; G2 reviews</td>
    <td valign="middle">Inline editing, command palette, keyboard shortcuts; target of at most 2 steps for common actions</td>
  </tr>
  <tr>
    <td valign="middle">Clutter and too many fields</td>
    <td valign="middle">G2 "dislike" themes: complexity, learning curve</td>
    <td valign="middle">Few core fields up front; org-level custom fields shown only when relevant; progressive disclosure</td>
  </tr>
  <tr>
    <td valign="middle">Slow at scale</td>
    <td valign="middle">G2 reviews cite lag on transitions and slow loading</td>
    <td valign="middle">Local-first reads, optimistic writes, virtualized lists, a 100k-item test</td>
  </tr>
  <tr>
    <td valign="middle">UI changes that break habits</td>
    <td valign="middle">Admins and users describe regressions and extra clicks after redesigns</td>
    <td valign="middle">Ship UI changes behind flags; keep shortcuts and layouts stable; changelog for any move</td>
  </tr>
  <tr>
    <td valign="middle">One UI for every role</td>
    <td valign="middle">Community posts asking for role-tailored experiences</td>
    <td valign="middle">Role-based default workspaces on one shared shell</td>
  </tr>
</table>

G2 shows Jira at 4.3 from about 7,900 reviews, so the product is valued; the lesson is to match its
power with a calmer surface, not to dismiss it.

### 2.2 What Linear does well (design reference only, never copy assets)

- **Principles.** The March 2026 refresh was organised around "Don't compete for attention you
  haven't earned": navigation recedes, task content leads. A second principle holds that dividers
  should guide without adding clutter.
- **Concrete moves.** Dimmed sidebar, compact rounded tabs, fewer and smaller icons, warmer and less
  saturated greys, lower-contrast rounded borders, density preserved.
- **Colour engineering.** Tokens tuned for hue, chroma and lightness and synced to Figma. Earlier
  versions moved theming to LCH so equal lightness looks equal across hues.
- **Process.** Feature flags plus an in-app dev toolbar to flip between old and new in one click;
  an in-app colour tool for fast palette experiments; success measured as users not noticing.
- **Triage.** Inbox with Priority and Other tabs; triage keys follow action order (1 accept,
  2 decline, 3 duplicate); an option to send comments with Enter or with Ctrl/Cmd+Enter.
- **Mobile.** Built for "away from keyboard" work, native Swift and Kotlin, later redesigned because
  the user base widened beyond individual contributors.
- **Watch-out.** A dark, dense, near-black, single-purple-accent look is now the default output of
  AI UI generators (vendor blog claim). Give the platform its own identity: its own accent colour,
  type pairing and illustration language, so it does not read as a Linear clone.

---

## 3. Interaction design

### 3.1 Command palette and keyboard

- **Proposal:** Cmd/Ctrl+K opens one surface for navigation, actions and search.
- Context-aware: on an item, "Assign" and "Change status" act on that item without extra steps.
- Recent-first when empty; useful empty and no-result states; show shortcuts beside every command.
- Include every menu and context-menu action, so the palette doubles as the discovery tool.
- Palette stays open for chained commands in power workflows (Retool's choice for its palette).
- Single-key shortcuts in lists (assign, status, priority, label), `G` then a key to go somewhere
  (a common convention), `Esc` to back out, undo for every destructive action.
- Measure palette adoption and which commands people run.

### 3.2 Views and layout

- Saved views as the core object (list, board, timeline later), with a query language behind them.
- Three-pane master-detail for queues and inboxes (tabs, list, full item), as Productlane rebuilt
  its support inbox; arrow keys and number keys move through the list without the mouse.
- Peek panel for an item from any list without losing list position.
- Density setting (compact / default / comfortable) as a user preference, with fixed row height per
  setting. Fixed row height is what keeps virtualization simple and fast.
- Display options per view: grouping, sub-grouping, visible properties, ordering.

### 3.3 Write feedback

- Every write acknowledged in the next frame (optimistic).
- If the server rejects: revert the field, show a toast naming the item and reason, and offer retry
  or undo. Linear reports needing hand-written error handling in only about 15 places, because the
  sync layer reverts and notifies centrally. Aim for the same: one rejection path, not one per screen.
- Never show a spinner for something already in the local store; use skeletons only for data
  not yet synced (for example a first load or a deep search).

### 3.4 Audience-specific surfaces

<table>
  <tr>
    <th valign="middle" align="left">Audience</th>
    <th valign="middle" align="left">Primary surface</th>
    <th valign="middle" align="left">Key patterns</th>
  </tr>
  <tr>
    <td valign="middle">Engineering</td>
    <td valign="middle">My issues, cycle board, backlog list</td>
    <td valign="middle">Triage inbox, cycle progress, Git/PR/CI status shown on the item, zero-touch status changes with a visible "moved by" reason</td>
  </tr>
  <tr>
    <td valign="middle">Service desk</td>
    <td valign="middle">Queue list with SLA column, three-pane agent workspace</td>
    <td valign="middle">SLA timer with colour states (on track, at risk, breached) plus text and icon so colour is never the only signal; an "SLA at risk" queue; keyboard triage; single customer-context panel</td>
  </tr>
  <tr>
    <td valign="middle">Client delivery</td>
    <td valign="middle">Timesheet, project budget burn, client view</td>
    <td valign="middle">Three time-entry modes (timer, weekly grid, entry list); retainer or budget remaining always visible; approval flow; guest/client view that shows only what they may see</td>
  </tr>
  <tr>
    <td valign="middle">Managers</td>
    <td valign="middle">Dashboards and reports</td>
    <td valign="middle">Few, readable charts; flow metrics; AI-drafted reports shown as drafts needing human approval</td>
  </tr>
</table>

Time-tracking note: sources describe three entry modes (live timer, spreadsheet-style weekly grid,
detailed entry list), and vendors argue weekly entry works well because people remember in weeks.
That second point is a vendor claim; validate it with your own users.

---

## 4. Visual design system

- **Tokens first.** Three tiers: global, alias (semantic, such as surface, text, border), component.
  Themes swap alias values. Export tokens from one source to CSS and later to mobile.
- **Colour in OKLCH** (or LCH): perceptually even lightness, so hover and status colours do not look
  dirty or uneven. Tailwind v4 and shadcn themes already use it.
- **Surfaces:** stepped neutral surfaces rather than pure black or white; low-contrast borders;
  structure from spacing and subtle surface changes more than lines.
- **One accent colour** for interactive elements; status colours reserved for status, priority and SLA.
- **Type:** one variable sans family (Inter is the common choice) with a display cut for headings
  only; tabular numerals for times, money and IDs.
- **Motion:** short, purposeful, animating only transform and opacity; honour reduced-motion.
- **Light and dark** both first-class from day one, plus a high-contrast option.
- **Icons:** fewer, smaller, no decorative coloured tiles.
- **Identity:** pick a distinct accent and tone (see the watch-out in 2.2).

### Component layer (decision needed)

- Base UI became shadcn/ui's default primitive layer in July 2026; Radix is still maintained;
  React Aria is a supported third base and has the longest accessibility record (these two facts
  come from a design-system vendor's blog, so confirm on shadcn's own docs).
- **Proposal:** shadcn/ui on Base UI for build speed with Claude Code, with a gate: every complex
  widget (combobox, date and time pickers, menus, grid) must pass keyboard and screen-reader checks.
  If gaps appear, switch that layer to React Aria. Record as an ADR.

---

## 5. Performance architecture (front end)

### 5.1 Budgets

<table>
  <tr>
    <th valign="middle" align="left">Metric</th>
    <th valign="middle" align="center">Target</th>
    <th valign="middle" align="left">Basis</th>
  </tr>
  <tr>
    <td valign="middle">Input acknowledged</td>
    <td valign="middle" align="center">&lt; 100 ms</td>
    <td valign="middle">Project target (project-context.md)</td>
  </tr>
  <tr>
    <td valign="middle">View render from local data</td>
    <td valign="middle" align="center">&lt; 400 ms</td>
    <td valign="middle">Project target</td>
  </tr>
  <tr>
    <td valign="middle">Interaction to Next Paint, p75</td>
    <td valign="middle" align="center">&le; 200 ms</td>
    <td valign="middle">Google's "good" threshold; poor is above 500 ms</td>
  </tr>
  <tr>
    <td valign="middle">Dataset for performance tests</td>
    <td valign="middle" align="center">100,000 items</td>
    <td valign="middle">Project target; generated sample data only</td>
  </tr>
  <tr>
    <td valign="middle">Sync client size (gzipped)</td>
    <td valign="middle" align="center">232 KB</td>
    <td valign="middle">Reported for Zero 1.0; set a total bundle budget before choosing</td>
  </tr>
</table>

**Proposal:** hold ourselves to a stricter internal INP than Google's threshold on the hot paths
(status change, assign, open item). INP is measured only in Chromium-based browsers per web.dev, so
use your own timing marks to cover Firefox and Safari.

### 5.2 Local-first data layer

- Pattern used by Linear: IndexedDB cache loaded into an in-memory observable store at start;
  UI reads the store; mutations change the store first, then queue a transaction; a server
  rejection reverts. Local and remote changes should run through the same code path.
- Quick win before any sync engine: optimistic updates on the actions people repeat all day.
- **Sync engine options as of Nov 2026:**
  - **Zero 1.0 (Rocicorp, June 2026):** query-driven partial sync, Postgres only. Reported limits:
    Postgres views not synced, some column types (arrays) unsupported, the client API cannot react
    to rejected updates, no server-side rendering yet. Reviewers praise developer experience and
    are more cautious on production readiness. The InfoQ report does not cover permissions,
    self-hosting or scale.
  - **ElectricSQL (with TanStack DB)** and **PowerSync:** both sync Postgres to a local store;
    PowerSync lists production users and uses SQLite on devices, which suits the later mobile app.
- **Decision gate:** before choosing, run a spike that proves the engine can enforce the permission
  matrix on the _read path_ (CLAUDE.md: every read goes through the single permission layer), supports
  partial sync for 100k items, and works for both web and the later React Native app. Whole-workspace
  sync is ruled out by the context doc. If no engine passes, fall back to optimistic UI over a normal
  API first (Section 5.2 quick win) and revisit.

### 5.3 Rendering

- **Virtualize every long list.** TanStack Table for rows, columns, sorting and filtering; TanStack
  Virtual for rendering only visible rows. Its May 2026 release reports 100k-item cold mount around
  4.5 ms in real React.
- TanStack's docs warn that native table layout does not mix well with dynamic-height virtual rows, so
  use fixed row heights per density setting.
- Virtualized lists drop off-screen rows from the DOM, so give screen readers row counts and positions
  (ARIA grid/table attributes) and keep focus when rows unmount.
- Fine-grained subscriptions: components subscribe to the field they show, not the whole item. State
  library is secondary to this; the sync engine's store may already provide it. Benchmark posts on
  Zustand, Jotai, MobX and signals are low-quality sources, so decide by a spike on a 100k list, not
  by article.
- React Compiler is supported on Vite and reduces hand memoization; adopt it and measure.
- Code-split by route and by audience workspace; keep the first load small, and prefetch likely next
  views on hover or focus.
- Render from local data first and verify the session in the background, as Linear does.

### 5.4 Measuring

- A seeded 100k-item generator in `packages/shared` (fake data only).
- Automated interaction timing in CI for the five hottest actions; fail the build on regression.
- Real-user monitoring of INP and custom marks once deployed.

---

## 6. Accessibility (WCAG 2.2 AA)

- **Target size:** minimum 24 by 24 CSS pixels including spacing. Dense rows and icon buttons are
  the usual failure. Pad hit areas even when the visible icon is small.
- **Dragging:** every drag action (board moves, reorder, file drop) needs a non-drag alternative:
  a "Move to…" menu, keyboard shortcut, or buttons.
- **Focus not obscured:** sticky headers, toolbars and docked panels must never hide the focused element.
- **Focus appearance:** visible, high-contrast focus ring on every control.
- **Contrast:** token pairs checked in both themes; status never conveyed by colour alone (SLA states
  use icon and text too).
- **Keyboard:** full operation without a mouse; focus returns correctly after dialogs and palette.
- **Testing:** automated scan plus manual keyboard and screen-reader passes; add to the definition of done.
- WCAG 2.2 AA is a superset of 2.1 AA, which is what most current laws reference.

---

## 7. Mobile

- Scope as in the context doc: triage, approvals, quick capture, timers, offline. Inbox-first.
- Linear's mobile app is fully native and was later reworked for broader roles; ADR 0001 chooses
  React Native with Expo. **Open risk:** set a mobile performance budget early (cold start, list
  scroll, timer reliability in the background) and test on a mid-range Android phone, because INP
  thresholds are calibrated around mid-tier phones.
- Offline: local SQLite store with background sync; timers must survive app kill and time-zone changes.
- Same design tokens as web, mobile-native navigation (bottom tabs, sheets), touch targets of at
  least 44 points.
- Quick capture in two taps; swipe actions on inbox rows, always with a non-swipe alternative.

---

## 8. Process for a solo builder with Claude Code

- Write a short `DESIGN.md` (tokens, spacing, type, component rules, do and don't) that Claude reads
  each session, so generated UI stays consistent.
- Build the **UI shell spike** first (see section 9) before feature screens.
- Ship visual changes behind flags with a one-click compare toggle.
- Protected tests for the hot-path timings and for keyboard flows, alongside the human-owned specs.
- Use generated sample data only (CLAUDE.md rule).
- Dependencies: permissive licences only (ADR 0005); Linear, Plane and similar are references, not code.

---

## 9. Recommended next steps

1. Owner answers the open questions below.
2. ADR 0006: front-end architecture (state and data layer, component layer, token system, budgets).
3. **UI shell spike** (about one focused week): 100k generated items, virtualized list, command
   palette, optimistic status and assignee edits, density toggle, light and dark, keyboard triage.
   Measure against section 5.1.
4. **Sync engine spike** against the permission model, in parallel with the permission-matrix spec.
5. Write `DESIGN.md` and token file; pick accent colour and name.
6. First audience is **engineering** (decided 15 Nov 2026). Design its three key screens (my issues with triage inbox, cycle board, backlog list) at low fidelity before coding.

### Open questions for the owner

<table>
  <tr>
    <th valign="middle" align="left">#</th>
    <th valign="middle" align="left">Question</th>
    <th valign="middle" align="left">Why it matters</th>
  </tr>
  <tr><td valign="middle" align="center">1</td><td valign="middle">Which audience ships first? <b>Answered 15 Nov 2026: engineering.</b></td><td valign="middle">Decides the first workspace and default views</td></tr>
  <tr><td valign="middle" align="center">2</td><td valign="middle">Dark, light or system default? Brand colour and name?</td><td valign="middle">Token set and identity</td></tr>
  <tr><td valign="middle" align="center">3</td><td valign="middle">Which browsers and devices must be supported (including company laptops)?</td><td valign="middle">Performance budgets and storage limits</td></tr>
  <tr><td valign="middle" align="center">4</td><td valign="middle">Is a desktop app wrapper wanted, or browser only?</td><td valign="middle">Notifications, offline, shortcut conflicts</td></tr>
  <tr><td valign="middle" align="center">5</td><td valign="middle">Any contractual accessibility requirement from clients?</td><td valign="middle">Sets AA as a gate or a goal</td></tr>
  <tr><td valign="middle" align="center">6</td><td valign="middle">How many guests or clients, and should they see a branded portal?</td><td valign="middle">Portal design and permission surface</td></tr>
  <tr><td valign="middle" align="center">7</td><td valign="middle">Can any real users test early prototypes with fake data?</td><td valign="middle">Validates keyboard and density choices</td></tr>
</table>

---

## 10. Confidence and gaps

- **Strong:** Jira complaint themes; Linear's refresh principles (first-party); INP thresholds
  (web.dev); WCAG 2.2 criteria; TanStack Virtual and Table guidance (first-party docs).
- **Medium:** Linear's sync architecture (conference talk summaries and third-party write-ups, one
  endorsed by Linear's CTO per a secondary source); Zero 1.0 limitations (one news report).
- **Weak, verify before relying:** state-library benchmark posts; the "default AI look" claim;
  shadcn and Base UI timelines (vendor blogs); weekly time-entry advantages (vendor claims).
- **Not researched:** native desktop wrappers, notification design, report and chart design,
  customer portal visual design, localisation and right-to-left layouts.

---

## Sources

- Linear, "Behind the latest design refresh": https://linear.app/now/behind-the-latest-design-refresh
- Linear, "How we redesigned the Linear UI": https://linear.app/now/how-we-redesigned-the-linear-ui
- Linear changelog, UI refresh (12 Mar 2026): https://linear.app/changelog/2026-03-12-ui-refresh
- Linear changelog, Priority inbox (3 Sep 2026): https://linear.app/changelog/2026-09-03-priority-inbox
- Linear changelog, coding sessions on mobile (30 Jul 2026): https://linear.app/changelog/2026-07-30-coding-sessions-on-mobile
- Linear Mobile: https://linear.app/mobile and https://linear.app/now/linear-liquid-glass
- Tuomas Artman talk notes, local-first benefits: https://second-brain-nuxt.vercel.app/unexpected-benefits-of-going-local-first
- Object sync engine overview: https://second-brain-nuxt.vercel.app/object-sync-engine
- InfoQ, Zero reaches 1.0: https://infoq.com/news/2026/06/zero-version-1
- InfoQ, ElectricSQL talk on sync engines: https://infoq.com/presentations/local-first-sync-engine
- Atlassian Community, Jira UX feedback: https://community.atlassian.com/forums/Navigation-Refresh-discussions/Feedback-about-degraded-user-experience-and-usability-of-Jira/td-p/3194776
- G2 Jira reviews: https://g2.com/products/jira/reviews?page=8
- web.dev, Interaction to Next Paint: https://web.dev/articles/inp
- TanStack Table virtualization guide: https://tanstack.com/table/latest/docs/framework/react/guide/virtualization
- TanStack Virtual performance release (May 2026): https://tanstack.com/blog/tanstack-virtual-perf-and-ios
- Productlane support inbox: https://productlane.com/changelog/2026-02-17-support-inbox
- Retool, designing the command palette: https://tryretool.com/blog/designing-the-command-palette
- Command palette patterns: https://www.saasui.design/blog/saas-search-command-palette-ux-patterns
- Base UI vs React Aria (vendor): https://www.untitledui.com/blog/base-ui-vs-react-aria
- WCAG 2.2 AA checklist: https://webability.io/blog/wcag-2-2-aa-checklist
- WCAG 2.2 product-team guide: https://testparty.ai/blog/wcag-2-2-product-team-guide
- Linear aesthetic, tokens and density (vendor blog): https://www.buildmvpfast.com/blog/linear-aesthetic-tokens-density-keyboard-first-ux-2026
- Jira Service Management queues and SLA colours: https://redmoonsoftware.pages.dev/glossary/jsm-queue/
