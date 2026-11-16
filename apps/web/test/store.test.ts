import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { generateSampleWorkItems } from '@wm/shared'
import { ItemStore } from '../src/spike/store'

describe('spike ItemStore', () => {
  let store: ItemStore
  beforeEach(() => {
    vi.useFakeTimers()
    store = new ItemStore()
    store.load(generateSampleWorkItems(1000))
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('applies a write immediately and notifies only that item', () => {
    const changed = vi.fn()
    const other = vi.fn()
    store.subscribeItem('item-1', changed)
    store.subscribeItem('item-2', other)
    store.mutate('item-1', { statusId: 'done' })
    expect(store.getItem('item-1')?.statusId).toBe('done')
    expect(store.getItem('item-1')?.statusCategory).toBe('done')
    expect(changed).toHaveBeenCalledTimes(1)
    expect(other).not.toHaveBeenCalled()
  })

  it('reverts and shows a toast when the fake server rejects the write', () => {
    const before = store.getItem('item-1')
    store.rejectSomeWrites = true
    vi.spyOn(Math, 'random').mockReturnValue(0)
    store.mutate('item-1', { assigneeId: 'user-3' })
    expect(store.getItem('item-1')?.assigneeId).toBe('user-3')
    vi.advanceTimersByTime(500)
    expect(store.getItem('item-1')).toBe(before)
    expect(store.getToasts()).toHaveLength(1)
  })

  it('undoes the last change', () => {
    const before = store.getItem('item-5')
    store.mutate('item-5', { priority: 4 })
    store.undo()
    expect(store.getItem('item-5')).toBe(before)
  })

  it('filters by text and status category', () => {
    store.applyFilter('eng-1', 'all')
    expect(store.getView().ids.length).toBeGreaterThan(0)
    store.applyFilter('', 'done')
    const { ids } = store.getView()
    expect(ids.every((id) => store.getItem(id)?.statusCategory === 'done')).toBe(true)
    expect(store.idForKey('ENG-1')).toBe('item-1')
  })
})
