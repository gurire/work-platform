/**
 * List view logic (redesign step 3): filter chips, grouping and columns. Pure functions, so
 * they are tested without a browser.
 */
import { SAMPLE_PRIORITIES, type Stage, type WorkItem } from '@wm/shared'

/** Chip filters. An empty or missing list means "any". `null` in owners means unassigned. */
export interface Facets {
  readonly owners?: readonly (string | null)[]
  readonly priorities?: readonly number[]
  readonly kinds?: readonly string[]
  /** Stage keys; only meaningful inside one team. */
  readonly stages?: readonly string[]
}

export const NO_FACETS: Facets = {}

export function facetCount(facets: Facets): number {
  return (
    (facets.owners?.length ? 1 : 0) +
    (facets.priorities?.length ? 1 : 0) +
    (facets.kinds?.length ? 1 : 0) +
    (facets.stages?.length ? 1 : 0)
  )
}

export function matchesFacets(item: WorkItem, facets: Facets): boolean {
  if (facets.owners?.length && !facets.owners.includes(item.assigneeId)) return false
  if (facets.priorities?.length && !facets.priorities.includes(Number(item.fields.priority ?? 0)))
    return false
  if (facets.kinds?.length && !facets.kinds.includes(item.kind)) return false
  if (facets.stages?.length && !facets.stages.includes(item.statusId)) return false
  return true
}

/** Add or remove one value from a chip's list. */
export function toggle<T>(list: readonly T[] | undefined, value: T): readonly T[] {
  const current = list ?? []
  return current.includes(value) ? current.filter((v) => v !== value) : [...current, value]
}

export type GroupBy = 'none' | 'stage' | 'owner' | 'priority' | 'kind' | 'team'

export const GROUP_LABELS: Record<GroupBy, string> = {
  none: 'No grouping',
  stage: 'Stage',
  owner: 'Owner',
  priority: 'Priority',
  kind: 'Kind',
  team: 'Team',
}

export interface GroupContext {
  readonly stages: ReadonlyMap<string, Stage>
  readonly userNames: ReadonlyMap<string, string>
  readonly teamNames: ReadonlyMap<string, string>
}

interface GroupKey {
  readonly key: string
  readonly label: string
  /** Sort order: lower comes first. */
  readonly rank: number | string
}

function groupOf(item: WorkItem, by: GroupBy, ctx: GroupContext): GroupKey {
  switch (by) {
    case 'stage': {
      const stage = ctx.stages.get(`${item.teamId}:${item.statusId}`)
      const order = { todo: 0, in_progress: 1, done: 2, cancelled: 3 }[item.statusCategory]
      // Same-named stages in different teams share a group; workflow order first.
      return {
        key: stage?.name ?? item.statusId,
        label: stage?.name ?? item.statusId,
        rank: order * 1000 + (stage?.position ?? 999),
      }
    }
    case 'owner': {
      if (!item.assigneeId) return { key: '~none', label: 'Unassigned', rank: '\uffff' }
      const name = ctx.userNames.get(item.assigneeId) ?? item.assigneeId
      return { key: item.assigneeId, label: name, rank: name.toLowerCase() }
    }
    case 'priority': {
      const level = Number(item.fields.priority ?? 0)
      return { key: String(level), label: SAMPLE_PRIORITIES[level] ?? 'None', rank: -level }
    }
    case 'kind':
      return {
        key: item.kind,
        label: item.kind[0]?.toUpperCase() + item.kind.slice(1),
        rank: item.kind,
      }
    case 'team': {
      const name = ctx.teamNames.get(item.teamId) ?? item.teamId
      return { key: item.teamId, label: name, rank: name.toLowerCase() }
    }
    default:
      return { key: '', label: '', rank: 0 }
  }
}

export interface Group {
  readonly key: string
  readonly label: string
  readonly ids: readonly string[]
}

/** Split ids into groups, keeping the list's own order inside each group. */
export function groupIds(
  ids: readonly string[],
  getItem: (id: string) => WorkItem | undefined,
  by: GroupBy,
  ctx: GroupContext,
): Group[] {
  if (by === 'none') return [{ key: '', label: '', ids }]
  const groups = new Map<string, { label: string; rank: number | string; ids: string[] }>()
  for (const id of ids) {
    const item = getItem(id)
    if (!item) continue
    const g = groupOf(item, by, ctx)
    const entry = groups.get(g.key) ?? { label: g.label, rank: g.rank, ids: [] }
    entry.ids.push(id)
    groups.set(g.key, entry)
  }
  return [...groups.entries()]
    .sort(([, a], [, b]) =>
      typeof a.rank === 'number' && typeof b.rank === 'number'
        ? a.rank - b.rank
        : String(a.rank).localeCompare(String(b.rank)),
    )
    .map(([key, g]) => ({ key, label: g.label, ids: g.ids }))
}

/** One line of the list: a group heading or an item. `index` is the item's place in the order. */
export type ListRow =
  | {
      readonly type: 'group'
      readonly key: string
      readonly label: string
      readonly count: number
      readonly collapsed: boolean
    }
  | { readonly type: 'item'; readonly id: string; readonly index: number }

/** Lines to draw, and the item order the keyboard moves through (collapsed groups skipped). */
export function buildRows(
  groups: readonly Group[],
  collapsed: ReadonlySet<string>,
): { rows: ListRow[]; order: string[] } {
  const rows: ListRow[] = []
  const order: string[] = []
  const grouped = !(groups.length === 1 && groups[0]?.key === '')
  for (const group of groups) {
    const isCollapsed = grouped && collapsed.has(group.key)
    if (grouped)
      rows.push({
        type: 'group',
        key: group.key,
        label: group.label,
        count: group.ids.length,
        collapsed: isCollapsed,
      })
    if (isCollapsed) continue
    for (const id of group.ids) {
      rows.push({ type: 'item', id, index: order.length })
      order.push(id)
    }
  }
  return { rows, order }
}

export type ColumnId = 'stage' | 'priority' | 'owner' | 'team' | 'created' | 'updated'

export const COLUMNS: readonly { id: ColumnId; label: string; width: string }[] = [
  { id: 'stage', label: 'Stage', width: '150px' },
  { id: 'priority', label: 'Priority', width: '110px' },
  { id: 'owner', label: 'Owner', width: '170px' },
  { id: 'team', label: 'Team', width: '130px' },
  { id: 'created', label: 'Created', width: '96px' },
  { id: 'updated', label: 'Updated', width: '96px' },
]

export const DEFAULT_COLUMNS: readonly ColumnId[] = ['stage', 'priority', 'owner']

/** The grid columns: checkbox, key, title, then the chosen columns in their fixed order. */
export function gridTemplate(columns: readonly ColumnId[]): string {
  const chosen = COLUMNS.filter((c) => columns.includes(c.id)).map((c) => c.width)
  return ['28px', '112px', 'minmax(200px, 1fr)', ...chosen].join(' ')
}

/** Read a saved column choice, ignoring anything unknown. */
export function parseColumns(saved: string | null): ColumnId[] {
  if (!saved) return [...DEFAULT_COLUMNS]
  const known = new Set(COLUMNS.map((c) => c.id))
  const ids = saved.split(',').filter((id): id is ColumnId => known.has(id as ColumnId))
  return ids.length ? ids : [...DEFAULT_COLUMNS]
}
