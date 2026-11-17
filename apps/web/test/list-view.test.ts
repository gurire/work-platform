import { describe, expect, it } from 'vitest'
import type { Stage, WorkItem } from '@wm/shared'
import {
  buildRows,
  facetCount,
  gridTemplate,
  groupIds,
  matchesFacets,
  parseColumns,
  toggle,
} from '../src/items/list-view'

const item = (id: string, over: Partial<WorkItem> = {}): WorkItem => ({
  id,
  key: id.toUpperCase(),
  kind: 'task',
  title: id,
  statusId: 'todo',
  statusCategory: 'todo',
  parentId: null,
  teamId: 'ENG',
  clientId: null,
  assigneeId: null,
  createdAt: '2026-11-01T00:00:00Z',
  updatedAt: '2026-11-01T00:00:00Z',
  fields: {},
  ...over,
})

const items = new Map(
  [
    item('a', {
      assigneeId: 'u1',
      fields: { priority: 4 },
      statusId: 'in_progress',
      statusCategory: 'in_progress',
    }),
    item('b', { assigneeId: null, fields: { priority: 1 }, kind: 'bug' }),
    item('c', {
      assigneeId: 'u2',
      fields: { priority: 4 },
      statusId: 'done',
      statusCategory: 'done',
    }),
    item('d', { assigneeId: 'u1', fields: { priority: 0 } }),
  ].map((i) => [i.id, i]),
)
const ids = [...items.keys()]
const stage = (
  key: string,
  name: string,
  category: Stage['category'],
  position: number,
): Stage => ({ teamId: 'ENG', key, name, category, position })
const ctx = {
  stages: new Map([
    ['ENG:todo', stage('todo', 'Todo', 'todo', 2)],
    ['ENG:in_progress', stage('in_progress', 'In Progress', 'in_progress', 3)],
    ['ENG:done', stage('done', 'Done', 'done', 5)],
  ]),
  userNames: new Map([
    ['u1', 'Zed'],
    ['u2', 'Amy'],
  ]),
  teamNames: new Map([['ENG', 'Engineering']]),
}

describe('filter chips', () => {
  it('match every chip that is set; unassigned is null', () => {
    const f = { owners: [null, 'u2'] }
    expect(ids.filter((id) => matchesFacets(items.get(id)!, f))).toEqual(['b', 'c'])
    const g = { priorities: [4], kinds: ['task'] }
    expect(ids.filter((id) => matchesFacets(items.get(id)!, g))).toEqual(['a', 'c'])
    expect(facetCount(g)).toBe(2)
    expect(facetCount({ owners: [] })).toBe(0)
  })
  it('toggle adds and removes', () => {
    expect(toggle(undefined, 'x')).toEqual(['x'])
    expect(toggle(['x', 'y'], 'x')).toEqual(['y'])
  })
})

describe('grouping', () => {
  it('by stage follows the workflow order', () => {
    const groups = groupIds(ids, (id) => items.get(id), 'stage', ctx)
    expect(groups.map((g) => g.label)).toEqual(['Todo', 'In Progress', 'Done'])
    expect(groups[0]!.ids).toEqual(['b', 'd'])
  })
  it('by owner sorts by name with Unassigned last; by priority urgent first', () => {
    expect(groupIds(ids, (id) => items.get(id), 'owner', ctx).map((g) => g.label)).toEqual([
      'Amy',
      'Zed',
      'Unassigned',
    ])
    expect(groupIds(ids, (id) => items.get(id), 'priority', ctx).map((g) => g.label)).toEqual([
      'Urgent',
      'Low',
      'None',
    ])
  })
  it('rows skip collapsed groups, and the keyboard order matches what is shown', () => {
    const groups = groupIds(ids, (id) => items.get(id), 'stage', ctx)
    const { rows, order } = buildRows(groups, new Set(['In Progress']))
    expect(rows.map((r) => (r.type === 'group' ? `#${r.label}` : r.id))).toEqual([
      '#Todo',
      'b',
      'd',
      '#In Progress',
      '#Done',
      'c',
    ])
    expect(order).toEqual(['b', 'd', 'c'])
    const flat = buildRows(
      groupIds(ids, (id) => items.get(id), 'none', ctx),
      new Set(),
    )
    expect(flat.rows.every((r) => r.type === 'item')).toBe(true)
  })
})

describe('columns', () => {
  it('saved choices ignore unknown names and fall back to the defaults', () => {
    expect(parseColumns('owner,nonsense,team')).toEqual(['owner', 'team'])
    expect(parseColumns('nonsense')).toEqual(['stage', 'priority', 'owner'])
    expect(parseColumns(null)).toEqual(['stage', 'priority', 'owner'])
  })
  it('the grid keeps a fixed column order', () => {
    expect(gridTemplate(['owner', 'stage'])).toBe('28px 112px minmax(200px, 1fr) 150px 170px')
  })
})
