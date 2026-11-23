/**
 * The restart's core model (specs/data-model.md): stage types, projects, milestones, sub-items,
 * priorities and team fields. Pure functions shared by the API and the web app.
 */
import type { StatusCategory } from './work-item.js'

/** Every stage has one of four types (data model rule 9). */
export const STAGE_TYPES = ['waiting', 'doing', 'review', 'done'] as const
export type StageType = (typeof STAGE_TYPES)[number]
export type DoneOutcome = 'completed' | 'cancelled'

export function isStageType(value: unknown): value is StageType {
  return typeof value === 'string' && (STAGE_TYPES as readonly string[]).includes(value)
}

/** The type a stage had before types existed, worked out from its category and name. */
export function deriveStageType(stage: {
  category: StatusCategory
  name: string
  kind?: string | null
}): StageType {
  if (stage.category === 'todo') return 'waiting'
  if (stage.category === 'done' || stage.category === 'cancelled') return 'done'
  if (stage.kind === 'review' || /review|approval|qa\b/i.test(stage.name)) return 'review'
  if (stage.kind === 'waiting') return 'waiting'
  return 'doing'
}

/** The category the older workflow code expects for a stage of this type. */
export function categoryFor(type: StageType, outcome: DoneOutcome | null = null): StatusCategory {
  if (type === 'waiting') return 'todo'
  if (type === 'done') return outcome === 'cancelled' ? 'cancelled' : 'done'
  return 'in_progress'
}

/** Rule 10: at least one Waiting, Doing and Done stage; Review is optional. */
export function missingStageTypes(types: readonly StageType[]): StageType[] {
  return (['waiting', 'doing', 'done'] as const).filter((t) => !types.includes(t))
}

/* Projects */

export const PROJECT_COLOURS = [1, 2, 3, 4, 5, 6, 7, 8] as const
export type ProjectColour = (typeof PROJECT_COLOURS)[number]

export function isProjectColour(value: unknown): value is ProjectColour {
  return typeof value === 'number' && (PROJECT_COLOURS as readonly number[]).includes(value)
}

/* Priorities: stored as 0–4 in item fields (0 none, 1 low, 2 medium, 3 high, 4 urgent). */

export const PRIORITIES = ['none', 'low', 'medium', 'high', 'urgent'] as const
export type PriorityName = (typeof PRIORITIES)[number]

export function priorityName(value: unknown): PriorityName {
  return typeof value === 'number' ? (PRIORITIES[value] ?? 'none') : 'none'
}

/* Sub-items and milestones */

export interface ItemPlace {
  id: string
  teamId: string
  projectId: string | null
  parentId: string | null
}

export type PlaceError =
  'parent_is_sub_item' | 'parent_other_team' | 'parent_other_project' | 'parent_is_self'

/** Rule 7: sub-items are one level deep, in the same team and project as their parent. */
export function checkSubItem(
  child: Omit<ItemPlace, 'parentId'>,
  parent: ItemPlace,
): PlaceError | null {
  if (parent.id === child.id) return 'parent_is_self'
  if (parent.parentId !== null) return 'parent_is_sub_item'
  if (parent.teamId !== child.teamId) return 'parent_other_team'
  if (parent.projectId !== child.projectId) return 'parent_other_project'
  return null
}

/** Rule 8: an item's milestone must be in the item's project. */
export function milestoneFits(
  projectId: string | null,
  milestoneProjectId: string | null,
): boolean {
  return milestoneProjectId === null || (projectId !== null && milestoneProjectId === projectId)
}

/* Progress */

export type TypeCounts = Record<StageType, number>

export function emptyCounts(): TypeCounts {
  return { waiting: 0, doing: 0, review: 0, done: 0 }
}

/** Project progress: cancelled items are left out entirely (data model, open question 2). */
export function progressOf(items: readonly { type: StageType; outcome: DoneOutcome | null }[]): {
  counts: TypeCounts
  done: number
  total: number
  percent: number
} {
  const counts = emptyCounts()
  for (const item of items) {
    if (item.type === 'done' && item.outcome === 'cancelled') continue
    counts[item.type] += 1
  }
  const total = counts.waiting + counts.doing + counts.review + counts.done
  return {
    counts,
    done: counts.done,
    total,
    percent: total === 0 ? 0 : Math.round((counts.done / total) * 100),
  }
}

/* Fields */

export const FIELD_TYPES = [
  'short_text',
  'long_text',
  'number',
  'date',
  'pick_one',
  'pick_many',
  'person',
  'link',
] as const
export type FieldType = (typeof FIELD_TYPES)[number]

export const MODEL_LIMITS = {
  stagesPerTeam: 30,
  teamFields: 25,
  fieldOptions: 100,
  titleLength: 200,
  commentLength: 20000,
  attachmentBytes: 25 * 1024 * 1024,
  restoreDays: 30,
} as const

/** Field keys: lower case letters, digits and underscores, starting with a letter. */
export function fieldKeyFrom(label: string): string {
  const key = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/^([0-9])/, 'f_$1')
    .slice(0, 40)
  return key || 'field'
}

/** A value fits the field type (empty is always allowed; required fields are a stage rule). */
export function valueFits(
  type: FieldType,
  value: unknown,
  options: readonly string[] = [],
): boolean {
  if (value === null || value === undefined || value === '') return true
  switch (type) {
    case 'short_text':
      return typeof value === 'string' && value.length <= 200
    case 'long_text':
      return typeof value === 'string' && value.length <= 5000
    case 'number':
      return typeof value === 'number' && Number.isFinite(value)
    case 'date':
      return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    case 'pick_one':
      return typeof value === 'string' && options.includes(value)
    case 'pick_many':
      return (
        Array.isArray(value) && value.every((v) => typeof v === 'string' && options.includes(v))
      )
    case 'person':
      return typeof value === 'string' && value.length <= 64
    case 'link':
      return typeof value === 'string' && /^https?:\/\/\S+$/.test(value)
  }
}
