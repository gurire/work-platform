/**
 * One object model for all three audiences (engineering, delivery, service desk).
 * Each team sees its own lens over the same items. See docs/adr/0003-one-work-item-model.md.
 * This is a starting skeleton: the full model is designed in specs/ before it is built.
 */
export const WORK_ITEM_KINDS = [
  'initiative',
  'epic',
  'story',
  'task',
  'bug',
  'request',
  'incident',
  'change',
  'deliverable',
] as const

export type WorkItemKind = (typeof WORK_ITEM_KINDS)[number]

export type StatusCategory = 'todo' | 'in_progress' | 'done' | 'cancelled'

export interface WorkItemRef {
  readonly id: string
  /** Human-readable key, e.g. ENG-142 or IT-88. */
  readonly key: string
}

export interface WorkItem extends WorkItemRef {
  readonly kind: WorkItemKind
  readonly title: string
  readonly statusId: string
  readonly statusCategory: StatusCategory
  readonly parentId: string | null
  readonly teamId: string
  /** Set for client-delivery and service-desk work; drives portal visibility. */
  readonly clientId: string | null
  readonly assigneeId: string | null
  readonly createdAt: string
  readonly updatedAt: string
  /** Values for org-level custom fields, keyed by field id. */
  readonly fields: Readonly<Record<string, unknown>>
}

export function isWorkItemKind(value: string): value is WorkItemKind {
  return (WORK_ITEM_KINDS as readonly string[]).includes(value)
}
