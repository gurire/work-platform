# Specs (human-owned)

These documents define the rules the code must follow. A human writes and approves them;
Claude reads them but must not change them to make code pass. Claude Code asks before
editing anything here (see `.claude/settings.json`).

Planned specs, to be written before the related code:

| Spec                   | Why it comes first                                                                                               |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `permission-matrix.md` | Role × object × action × surface (API, sync, search, export, MCP, AI). Generates the protected permission tests. |
| `sync-protocol.md`     | Versioned client–server sync, conflict rules, and what old mobile clients must keep supporting.                  |
| `sla-calendars.md`     | Business hours, holidays, time zones, pause/resume, and breach rules, with worked examples.                      |
| `money-and-time.md`    | Rates, rounding, budgets and retainers, with worked examples.                                                    |
| `jira-mapping.md`      | How each Jira Cloud field, workflow, link and history entry maps to our model.                                   |
