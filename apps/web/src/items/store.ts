/**
 * Local item store. Screens read from memory; writes apply immediately and are then sent to
 * the server. If the server refuses, the change is reverted and a toast explains why. This is
 * the single rejection path from ADR 0006: screens do not handle write errors themselves.
 */
import type { Stage, StatusCategory, WorkItem } from '@wm/shared'

type Listener = () => void
export type CategoryFilter = 'all' | StatusCategory
export type ItemPatch = Partial<Pick<WorkItem, 'statusId' | 'assigneeId'>> & {
  priority?: number
  fields?: Record<string, string | number | boolean | null>
}

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

  /** `save` sends one change to the server and rejects with a readable message if refused. */
  constructor(
    private readonly save: (item: WorkItem, patch: ItemPatch) => Promise<WorkItem | null | void>,
  ) {}

  private stages = new Map<string, Stage>()

  /** The stages of every visible team, so a stage change can show its category at once. */
  setStages(stages: readonly Stage[]): void {
    this.stages = new Map(stages.map((stage) => [`${stage.teamId}:${stage.key}`, stage]))
  }

  /** Forget everything, for example when the signed-in user changes. */
  reset(): void {
    this.items.clear()
    this.keyToId.clear()
    this.haystack.clear()
    this.allIds = []
    this.undoStack = []
    this.applyFilter(this.viewSnapshot.query, this.viewSnapshot.category)
  }

  /** Add a page of items as it arrives; the view updates without waiting for the rest. */
  append(items: readonly WorkItem[]): void {
    for (const item of items) {
      if (!this.items.has(item.id)) this.allIds.push(item.id)
      this.items.set(item.id, item)
      this.keyToId.set(item.key.toLowerCase(), item.id)
      this.haystack.set(item.id, `${item.key} ${item.title}`.toLowerCase())
    }
    // A new array, so subscribers see the view change.
    this.allIds = [...this.allIds]
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
  /** Apply a change locally right away, then send it. A refusal reverts it with a toast. */
  mutate(id: string, patch: ItemPatch): void {
    const before = this.items.get(id)
    if (!before) return
    const after = this.applyPatch(before, patch)
    this.setItem(after)
    const change: Change = { id, before, after }
    this.undoStack.push(change)
    if (this.undoStack.length > 50) this.undoStack.shift()

    this.save(before, patch).then(
      (saved) => {
        // The server has the last word (for example, a hand-over may clear the owner),
        // unless a newer local change has replaced this one in the meantime.
        if (saved && this.items.get(id) === after) this.setItem(saved)
      },
      (error: unknown) => {
        this.undoStack = this.undoStack.filter((c) => c !== change)
        // Only revert if nothing newer has replaced this write.
        if (this.items.get(id) === after) this.setItem(before)
        const reason = error instanceof Error ? error.message : 'the server rejected that change'
        this.toast(`${before.key}: ${reason}. The change was reverted.`)
      },
    )
  }

  /** Undo the last change by sending the previous values as a new change. */
  undo(): void {
    const change = this.undoStack.pop()
    if (!change) return
    const { before, after } = change
    const patch: ItemPatch = {
      ...(before.statusId !== after.statusId ? { statusId: before.statusId } : {}),
      ...(before.assigneeId !== after.assigneeId ? { assigneeId: before.assigneeId } : {}),
      ...(before.fields.priority !== after.fields.priority
        ? { priority: Number(before.fields.priority ?? 0) }
        : {}),
    }
    this.mutate(change.id, patch)
    this.undoStack.pop() // the undo itself is not something to undo
    this.toast(`${before.key}: change undone.`)
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

  private applyPatch(item: WorkItem, patch: ItemPatch): WorkItem {
    let next: WorkItem = item
    if (patch.statusId !== undefined) {
      const stage = this.stages.get(`${item.teamId}:${patch.statusId}`)
      next = {
        ...next,
        statusId: patch.statusId,
        statusCategory: stage?.category ?? next.statusCategory,
      }
    }
    if (patch.assigneeId !== undefined) next = { ...next, assigneeId: patch.assigneeId }
    if (patch.priority !== undefined) {
      next = { ...next, fields: { ...next.fields, priority: patch.priority } }
    }
    if (patch.fields !== undefined) next = { ...next, fields: { ...next.fields, ...patch.fields } }
    return next
  }

  /** Put the server's copy of one item into the store, for example after a move on the item page. */
  put(item: WorkItem): void {
    if (!this.items.has(item.id)) {
      this.append([item])
      return
    }
    this.setItem(item)
    this.haystack.set(item.id, `${item.key} ${item.title}`.toLowerCase())
  }
}
