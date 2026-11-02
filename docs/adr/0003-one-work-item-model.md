# 0003: One work item model for all three audiences

Status: accepted (2026-11-02)

## Decision

Engineering issues, service desk requests and incidents, and client deliverables are all
`WorkItem`s with a `kind`. Each team gets its own lens (views, fields, workflows) over the same
model rather than separate products.

## Why

The research found no tool that serves engineering, delivery and the service desk together;
teams run three tools and sync between them. One model lets a ticket spawn linked engineering
work, and lets support time draw down a client's retainer, without integrations.

## Consequences

- Field and workflow configuration must be catalogue-based with per-team limits, to avoid
  Jira-style sprawl.
- The model must be able to hold everything Jira Cloud holds (custom fields, workflow history,
  links, comments, attachments) so migration is a mapping exercise. See `specs/jira-mapping.md`.
