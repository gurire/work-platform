/**
 * Spike-only local store. Reads come from memory, writes apply immediately and a fake
 * server confirms or rejects them later. This is NOT the sync engine and has no permission
 * layer; it exists to measure how the UI feels with local-first reads and optimistic writes.
 */
import type { StatusCategory, WorkItem } from '@wm/shared'
import { SAMPLE_STATUSES } from '@wm/shared'

type Listener = () => void
export type CategoryFilter = 'all' | StatusCategory
export type ItemPatch = Partial<Pick<WorkItem, 'statusId' | 'assigneeId'>> & { priority?: number }

export interface Toast {
  readonly id: number
  readonly message: string
}

interface Change {
  readonly id: string
  readonly before: WorkItem
  readonly after: WorkItem
}

export interface ViewSnapshot {
  readonly ids: readonly string[]
  readonly total: number
  readonly query: string
  readonly category: CategoryFilter
  readonly filterMs: number
}

export class ItemStore {
  private readonly items = new Map<string, WorkItem>()
  private readonly keyToId = new Map<string, string>()
  private readonly haystack = new Map<string, string>()
  private readonly itemListeners = new Map<string, Set<Listener>>()
  private readonly listeners = new Set<Listener>()
  private allIds: string[] = []
  private viewSnapshot: ViewSnapshot = {
    ids: [],
    total: 0,
    query: '',
    category: 'all',
    filterMs: 0,
  }
  private toastList: readonly Toast[] = []
  private undoStack: Change[] = []
  private nextToastId = 1
  /** When on, the fake server rejects about one write in three. */
  rejectSomeWrites = false

  load(items: readonly WorkItem[]): void {
    this.items.clear()
    this.keyToId.clear()
    this.haystack.clear()
    this.allIds = []
    for (const item of items) {
      this.items.set(item.id, item)
      this.keyToId.set(item.key.toLowerCase(), item.id)
      this.haystack.set(item.id, `${item.key} ${item.title}`.toLowerCase())
      this.allIds.push(item.id)
    }
    this.applyFilter(this.viewSnapshot.query, this.viewSnapshot.category)
  }

  // --- reads -------------------------------------------------------------------------------
  getItem = (id: string): WorkItem | undefined => this.items.get(id)
  getView = (): ViewSnapshot => this.viewSnapshot
  getToasts = (): readonly Toast[] => this.toastList
  idForKey = (key: string): string | undefined => this.keyToId.get(key.toLowerCase())

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  subscribeItem(id: string, listener: Listener): () => void {
    let set = this.itemListeners.get(id)
    if (!set) this.itemListeners.set(id, (set = new Set()))
    set.add(listener)
    return () => {
      set.delete(listener)
      if (set.size === 0) this.itemListeners.delete(id)
    }
  }

  // --- filtering ---------------------------------------------------------------------------
  applyFilter(query: string, category: CategoryFilter): void {
    const start = performance.now()
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
    const ids =
      terms.length === 0 && category === 'all'
        ? this.allIds
        : this.allIds.filter((id) => {
            if (category !== 'all' && this.items.get(id)?.statusCategory !== category) return false
            const text = this.haystack.get(id) ?? ''
            return terms.every((term) => text.includes(term))
          })
    this.viewSnapshot = {
      ids,
      total: this.allIds.length,
      query,
      category,
      filterMs: performance.now() - start,
    }
    this.emit()
  }

  // --- writes ------------------------------------------------------------------------------
  /** Apply a change locally right away, then let the fake server confirm or reject it. */
  mutate(id: string, patch: ItemPatch): void {
    const before = this.items.get(id)
    if (!before) return
    const after = applyPatch(before, patch)
    this.setItem(after)
    const change: Change = { id, before, after }
    this.undoStack.push(change)
    if (this.undoStack.length > 50) this.undoStack.shift()

    const latency = 150 + Math.random() * 250
    setTimeout(() => {
      if (!this.rejectSomeWrites || Math.random() > 0.33) return
      // Only revert if nothing newer has replaced this write.
      if (this.items.get(id) !== after) return
      this.setItem(before)
      this.undoStack = this.undoStack.filter((c) => c !== change)
      this.toast(`${before.key}: the server rejected that change, so it was reverted.`)
    }, latency)
  }

  undo(): void {
    const change = this.undoStack.pop()
    if (!change) return
    if (this.items.get(change.id) === change.after) this.setItem(change.before)
    this.toast(`${change.before.key}: change undone.`)
  }

  toast(message: string): void {
    const toast = { id: this.nextToastId++, message }
    this.toastList = [...this.toastList, toast]
    this.emit()
    setTimeout(() => {
      this.toastList = this.toastList.filter((t) => t !== toast)
      this.emit()
    }, 5000)
  }

  private setItem(item: WorkItem): void {
    this.items.set(item.id, item)
    this.itemListeners.get(item.id)?.forEach((listener) => listener())
  }

  private emit(): void {
    this.listeners.forEach((listener) => listener())
  }
}

function applyPatch(item: WorkItem, patch: ItemPatch): WorkItem {
  let next: WorkItem = item
  if (patch.statusId !== undefined) {
    const status = SAMPLE_STATUSES.find((s) => s.id === patch.statusId)
    if (status) next = { ...next, statusId: status.id, statusCategory: status.category }
  }
  if (patch.assigneeId !== undefined) next = { ...next, assigneeId: patch.assigneeId }
  if (patch.priority !== undefined) {
    next = { ...next, fields: { ...next.fields, priority: patch.priority } }
  }
  return next
}
