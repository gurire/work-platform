import { describe, expect, it } from 'vitest'
import {
  categoryFor,
  checkSubItem,
  deriveStageType,
  fieldKeyFrom,
  milestoneFits,
  missingStageTypes,
  priorityName,
  progressOf,
  valueFits,
} from '../src/core.js'

describe('stage types', () => {
  it('derives a type from the older category and name', () => {
    expect(deriveStageType({ category: 'todo', name: 'Backlog' })).toBe('waiting')
    expect(deriveStageType({ category: 'in_progress', name: 'QA review' })).toBe('review')
    expect(deriveStageType({ category: 'in_progress', name: 'Ingest' })).toBe('doing')
    expect(deriveStageType({ category: 'cancelled', name: 'Dropped' })).toBe('done')
  })
  it('maps types back to the categories older code uses', () => {
    expect(categoryFor('review')).toBe('in_progress')
    expect(categoryFor('done', 'cancelled')).toBe('cancelled')
    expect(categoryFor('done')).toBe('done')
  })
  it('needs Waiting, Doing and Done; Review is optional', () => {
    expect(missingStageTypes(['waiting', 'doing', 'done'])).toEqual([])
    expect(missingStageTypes(['waiting', 'review'])).toEqual(['doing', 'done'])
  })
})

describe('sub-items and milestones (data model rules 7 and 8)', () => {
  const parent = { id: 'p', teamId: 'DATA', projectId: 'x', parentId: null }
  it('allows a sub-item in the same team and project', () => {
    expect(checkSubItem({ id: 'c', teamId: 'DATA', projectId: 'x' }, parent)).toBeNull()
  })
  it('refuses a sub-item of a sub-item', () => {
    expect(
      checkSubItem({ id: 'c', teamId: 'DATA', projectId: 'x' }, { ...parent, parentId: 'q' }),
    ).toBe('parent_is_sub_item')
  })
  it('refuses another team or another project', () => {
    expect(checkSubItem({ id: 'c', teamId: 'ENG', projectId: 'x' }, parent)).toBe(
      'parent_other_team',
    )
    expect(checkSubItem({ id: 'c', teamId: 'DATA', projectId: 'y' }, parent)).toBe(
      'parent_other_project',
    )
  })
  it('only fits a milestone from the item’s project', () => {
    expect(milestoneFits('x', 'x')).toBe(true)
    expect(milestoneFits('x', 'y')).toBe(false)
    expect(milestoneFits(null, 'y')).toBe(false)
    expect(milestoneFits(null, null)).toBe(true)
  })
})

describe('progress', () => {
  it('leaves cancelled items out', () => {
    const p = progressOf([
      { type: 'done', outcome: 'completed' },
      { type: 'done', outcome: 'cancelled' },
      { type: 'doing', outcome: null },
    ])
    expect(p).toMatchObject({ done: 1, total: 2, percent: 50 })
  })
})

describe('fields and priorities', () => {
  it('turns labels into keys', () => {
    expect(fieldKeyFrom('Rows expected')).toBe('rows_expected')
    expect(fieldKeyFrom('2027 target')).toBe('f_2027_target')
  })
  it('checks values against their type', () => {
    expect(valueFits('pick_one', 'Monthly', ['Monthly'])).toBe(true)
    expect(valueFits('pick_one', 'Weekly', ['Monthly'])).toBe(false)
    expect(valueFits('date', '2026-12-04')).toBe(true)
    expect(valueFits('link', 'javascript:alert(1)')).toBe(false)
    expect(valueFits('number', null)).toBe(true)
  })
  it('names stored priorities', () => {
    expect(priorityName(4)).toBe('urgent')
    expect(priorityName(undefined)).toBe('none')
  })
})
