import { beforeEach, describe, expect, it, vi } from 'vitest'
import { generateSampleWorkItems, type WorkItem } from '@wm/shared'
import { ItemStore, type ItemPatch } from '../src/items/store'

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('ItemStore', () => {
  let save: ReturnType<
    typeof vi.fn<(item: WorkItem, patch: ItemPatch) => Promise<WorkItem | null | void>>
  >
  let store: ItemStore
  beforeEach(() => {
    save = vi
      .fn<(item: WorkItem, patch: ItemPatch) => Promise<WorkItem | null | void>>()
      .mockResolvedValue(undefined)
    store = new ItemStore(save)
    store.setStages([
      { teamId: 'ENG', key: 'done', name: 'Done', category: 'done', position: 5 },
      { teamId: 'ENG', key: 'todo', name: 'Todo', category: 'todo', position: 2 },
    ])
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

  it('takes the server version after a save, such as an owner cleared on hand-over', async () => {
    const before = store.getItem('item-1') as WorkItem
    save.mockResolvedValueOnce({
      ...before,
      statusId: 'done',
      statusCategory: 'done',
      assigneeId: null,
    })
    store.mutate('item-1', { statusId: 'done' })
    await flush()
    expect(store.getItem('item-1')?.assigneeId).toBeNull()
  })

  it('appends pages without duplicating items', () => {
    store.append(generateSampleWorkItems(1000))
    expect(store.getView().total).toBe(1000)
  })

  it('bulk change: one message, refusals reverted and counted, one Undo for the rest', async () => {
    save.mockImplementation(async (item) => {
      if (item.id === 'item-2') throw new Error('you can only change items in your own teams')
    })
    const before = ['item-1', 'item-2', 'item-3'].map((id) => store.getItem(id)!.assigneeId)
    await store.mutateMany(
      ['item-1', 'item-2', 'item-3'],
      { assigneeId: 'user-9' },
      'Assigned {items}.',
    )
    expect(store.getItem('item-1')?.assigneeId).toBe('user-9')
    expect(store.getItem('item-2')?.assigneeId).toBe(before[1])
    const toasts = store.getToasts()
    expect(toasts).toHaveLength(1)
    expect(toasts[0]!.message).toBe(
      'Assigned 2 items. 1 could not be changed: you can only change items in your own teams.',
    )
    toasts[0]!.action!.run()
    expect(store.getItem('item-1')?.assigneeId).toBe(before[0])
    expect(store.getItem('item-3')?.assigneeId).toBe(before[2])
  })

  it('chip filters combine with search and status', () => {
    const owner = store.getItem('item-1')!.assigneeId
    store.setFacets({ owners: [owner] })
    const view = store.getView()
    expect(view.ids.length).toBeGreaterThan(0)
    expect(view.ids.every((id) => store.getItem(id)?.assigneeId === owner)).toBe(true)
    store.applyFilter('', 'done')
    expect(
      store.getView().ids.every((id) => {
        const item = store.getItem(id)
        return item?.assigneeId === owner && item.statusCategory === 'done'
      }),
    ).toBe(true)
    store.setFacets({})
    store.applyFilter('', 'all')
    expect(store.getView().ids).toHaveLength(1000)
  })

  it('a team filter narrows the list and keeps the other filters', () => {
    const team = store.getItem('item-1')!.teamId
    store.setTeam(team)
    const view = store.getView()
    expect(view.teamId).toBe(team)
    expect(view.ids.length).toBeGreaterThan(0)
    expect(view.ids.every((id) => store.getItem(id)?.teamId === team)).toBe(true)
    store.applyFilter('', 'done')
    expect(store.getView().ids.every((id) => store.getItem(id)?.teamId === team)).toBe(true)
    store.setTeam(null)
    store.applyFilter('', 'all')
    expect(store.getView().ids).toHaveLength(1000)
  })

  it('put replaces a known item and keeps an unknown one (opened from a link) out of the list', () => {
    const changed = vi.fn()
    store.subscribeItem('item-1', changed)
    const known = store.getItem('item-1')!
    store.put({ ...known, title: 'Renamed on the server' })
    expect(store.getItem('item-1')?.title).toBe('Renamed on the server')
    expect(changed).toHaveBeenCalled()
    expect(store.getView().total).toBe(1000)

    store.put({ ...known, id: 'item-new', key: 'OPS-9999', title: 'From a shared link' })
    expect(store.idForKey('ops-9999')).toBe('item-new')
    expect(store.getItem('item-new')?.title).toBe('From a shared link')
    // Opening an item early must not make it "item 1 of N" in the list.
    expect(store.getView().total).toBe(1000)
    expect(store.getView().ids[0]).toBe('item-1')

    // When its page of the list arrives, it joins the list in list order.
    store.append([store.getItem('item-new')!])
    expect(store.getView().total).toBe(1001)
    expect(store.getView().ids.at(-1)).toBe('item-new')
  })

  it('a stage move offers Undo, and Undo puts the stage back once', async () => {
    const known = store.getItem('item-1')!
    const target = known.statusId === 'done' ? 'todo' : 'done'
    store.mutate('item-1', { statusId: target })
    await Promise.resolve()
    await Promise.resolve()
    const toast = store.getToasts().find((t) => t.action)
    expect(toast?.action?.label).toBe('Undo')
    toast?.action?.run()
    toast?.action?.run()
    expect(store.getItem('item-1')?.statusId).toBe(known.statusId)
  })

  it('itemsForTeam ignores the filter, and the revision moves on every change', () => {
    const teamId = store.getItem('item-1')!.teamId
    const all = store.itemsForTeam(teamId)
    store.applyFilter('no such item anywhere', 'all')
    expect(store.itemsForTeam(teamId)).toHaveLength(all.length)
    const before = store.getRevision()
    const listener = vi.fn()
    store.subscribeChanges(listener)
    store.mutate('item-1', { assigneeId: null })
    expect(store.getRevision()).toBeGreaterThan(before)
    expect(listener).toHaveBeenCalled()
  })
})
