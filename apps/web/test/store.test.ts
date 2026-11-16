import { beforeEach, describe, expect, it, vi } from 'vitest'
import { generateSampleWorkItems, type WorkItem } from '@wm/shared'
import { ItemStore, type ItemPatch } from '../src/items/store'

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('ItemStore', () => {
  let save: ReturnType<typeof vi.fn<(item: WorkItem, patch: ItemPatch) => Promise<void>>>
  let store: ItemStore
  beforeEach(() => {
    save = vi.fn<(item: WorkItem, patch: ItemPatch) => Promise<void>>().mockResolvedValue()
    store = new ItemStore(save)
    store.append(generateSampleWorkItems(1000))
  })

  it('applies a write immediately, notifies only that item, and sends it', () => {
    const changed = vi.fn()
    const other = vi.fn()
    store.subscribeItem('item-1', changed)
    store.subscribeItem('item-2', other)
    store.mutate('item-1', { statusId: 'done' })
    expect(store.getItem('item-1')?.statusId).toBe('done')
    expect(store.getItem('item-1')?.statusCategory).toBe('done')
    expect(changed).toHaveBeenCalledTimes(1)
    expect(other).not.toHaveBeenCalled()
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ id: 'item-1' }), {
      statusId: 'done',
    })
  })

  it('reverts and explains when the server refuses the write', async () => {
    const before = store.getItem('item-1')
    save.mockRejectedValueOnce(new Error('you can only change items in your own teams'))
    store.mutate('item-1', { assigneeId: 'user-3' })
    expect(store.getItem('item-1')?.assigneeId).toBe('user-3')
    await flush()
    expect(store.getItem('item-1')).toBe(before)
    expect(store.getToasts()[0]?.message).toContain('your own teams')
  })

  it('does not revert over a newer change', async () => {
    let reject: (error: Error) => void = () => {}
    save.mockReturnValueOnce(new Promise<void>((_, r) => (reject = r)))
    store.mutate('item-1', { statusId: 'done' })
    store.mutate('item-1', { statusId: 'todo' })
    reject(new Error('refused'))
    await flush()
    expect(store.getItem('item-1')?.statusId).toBe('todo')
  })

  it('undoes the last change by sending the old values', () => {
    const before = store.getItem('item-5')
    store.mutate('item-5', { priority: (Number(before?.fields.priority) + 1) % 5 })
    store.undo()
    expect(store.getItem('item-5')?.fields.priority).toBe(before?.fields.priority)
    expect(save).toHaveBeenLastCalledWith(expect.anything(), {
      priority: Number(before?.fields.priority),
    })
  })

  it('filters by text and status category, and resets', () => {
    store.applyFilter('eng-1', 'all')
    expect(store.getView().ids.length).toBeGreaterThan(0)
    store.applyFilter('', 'done')
    const { ids } = store.getView()
    expect(ids.every((id) => store.getItem(id)?.statusCategory === 'done')).toBe(true)
    expect(store.idForKey('ENG-1')).toBe('item-1')
    store.reset()
    expect(store.getView().total).toBe(0)
  })

  it('appends pages without duplicating items', () => {
    store.append(generateSampleWorkItems(1000))
    expect(store.getView().total).toBe(1000)
  })
})
