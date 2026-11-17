/**
 * Local item store. Screens read from memory; writes apply immediately and are then sent to
 * the server. If the server refuses, the change is reverted and a toast explains why. This is
 * the single rejection path from ADR 0006: screens do not handle write errors themselves.
 */
import type { Stage, StatusCategory, WorkItem } from '@wm/shared'
import { NO_FACETS, facetCount, matchesFacets, type Facets } from './list-view'

type Listener = () => void
export type CategoryFilter = 'all' | StatusCategory
export type ItemPatch = Partial<Pick<WorkItem, 'statusId' | 'assigneeId'>> & {
  priority?: number
  fields?: Record<string, string | number | boolean | null>
}

export interface ToastAction {
  readonly label: string
  readonly run: () => void
}

export interface Toast {
  readonly id: number
  readonly message: string
  readonly action?: ToastAction
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
  /** Only this team's items, or every visible team. */
  readonly teamId: string | null
  readonly filterMs: number
}

export class ItemStore {
  private readonly items = new Map<string, WorkItem>()
  private readonly keyToId = new Map<string, string>()
  private readonly haystack = new Map<string, string>()
  private readonly itemListeners = new Map<string, Set<Listener>>()
  private readonly listeners = new Set<Listener>()
  private readonly changeListeners = new Set<Listener>()
  /** Goes up whenever any item is added or changed, for screens that show many items. */
  private revision = 0
  private allIds: string[] = []
  /** Items that belong to the list. Items fetched on their own (put) stay out of it. */
  private readonly listed = new Set<string>()
  private viewSnapshot: ViewSnapshot = {
    ids: [],
    total: 0,
    query: '',
    category: 'all',
    teamId: null,
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
    this.listed.clear()
    this.undoStack = []
    this.changed()
    this.applyFilter(this.viewSnapshot.query, this.viewSnapshot.category)
  }

  /** Add a page of items as it arrives; the view updates without waiting for the rest. */
  append(items: readonly WorkItem[]): void {
    for (const item of items) {
      if (!this.listed.has(item.id)) {
        this.listed.add(item.id)
        this.allIds.push(item.id)
      }
      this.items.set(item.id, item)
      this.keyToId.set(item.key.toLowerCase(), item.id)
      this.haystack.set(item.id, `${item.key} ${item.title}`.toLowerCase())
    }
    // A new array, so subscribers see the view change.
    this.allIds = [...this.allIds]
    this.changed()
    this.applyFilter(this.viewSnapshot.query, this.viewSnapshot.category)
  }

  // --- reads -------------------------------------------------------------------------------
  getItem = (id: string): WorkItem | undefined => this.items.get(id)
  getView = (): ViewSnapshot => this.viewSnapshot
  getToasts = (): readonly Toast[] => this.toastList
  idForKey = (key: string): string | undefined => this.keyToId.get(key.toLowerCase())
  getRevision = (): number => this.revision

  /** Notified when any item is added or changed. */
  subscribeChanges = (listener: Listener): (() => void) => {
    this.changeListeners.add(listener)
    return () => this.changeListeners.delete(listener)
  }

  /** Every loaded item of one team, ignoring the list filter. */
  itemsForTeam(teamId: string): WorkItem[] {
    const result: WorkItem[] = []
    for (const id of this.allIds) {
      const item = this.items.get(id)
      if (item?.teamId === teamId) result.push(item)
    }
    return result
  }

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
  /** Show one team's items (a team's list), or null for every team. Keeps the other filters. */
  setTeam(teamId: string | null): void {
    if (teamId === this.viewSnapshot.teamId) return
    this.teamFilter = teamId
    this.applyFilter(this.viewSnapshot.query, this.viewSnapshot.category)
  }

  private teamFilter: string | null = null
  private facets: Facets = NO_FACETS

  /** Chip filters (owner, priority, kind, stage). Keeps the search and status filters. */
  setFacets(facets: Facets): void {
    this.facets = facets
    this.applyFilter(this.viewSnapshot.query, this.viewSnapshot.category)
  }

  getFacets = (): Facets => this.facets

  applyFilter(query: string, category: CategoryFilter): void {
    const start = performance.now()
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
    const teamId = this.teamFilter
    const facets = this.facets
    const anyFacet = facetCount(facets) > 0
    const ids =
      terms.length === 0 && category === 'all' && teamId === null && !anyFacet
        ? this.allIds
        : this.allIds.filter((id) => {
            const item = this.items.get(id)
            if (teamId !== null && item?.teamId !== teamId) return false
            if (category !== 'all' && item?.statusCategory !== category) return false
            if (anyFacet && (!item || !matchesFacets(item, facets))) return false
            const text = this.haystack.get(id) ?? ''
            return terms.every((term) => text.includes(term))
          })
    this.viewSnapshot = {
      ids,
      total: this.allIds.length,
      query,
      category,
      teamId,
      filterMs: performance.now() - start,
    }
    this.emit()
  }

  // --- writes ------------------------------------------------------------------------------
  /** Apply a change locally right away, then send it. A refusal reverts it with a toast. */
  mutate(id: string, patch: ItemPatch): void {
    void this.apply(id, patch, false)
  }

  /**
   * One change to many items (bulk actions): applied at once, sent one by one through the
   * same checks, then one message with one Undo for all of them. Refused items are reverted
   * and counted in the message.
   */
  async mutateMany(ids: readonly string[], patch: ItemPatch, done: string): Promise<void> {
    const sent = ids.map((id) => this.apply(id, patch, true)).filter((s) => s !== null)
    const results = await Promise.all(sent.map((s) => s.result))
    const changes = sent.filter((_, i) => results[i] === null).map((s) => s.change)
    const refused = results.filter((r): r is string => r !== null)
    const reason = refused[0]
    if (changes.length > 0) {
      const n = changes.length
      const message = `${done.replace('{items}', n === 1 ? '1 item' : `${n} items`)}${
        refused.length ? ` ${refused.length} could not be changed: ${reason}.` : ''
      }`
      this.toast(message, {
        label: 'Undo',
        run: () => {
          for (const change of changes) this.undoChange(change, true)
          this.toast(`Undone for ${changes.length} item${changes.length === 1 ? '' : 's'}.`)
        },
      })
    } else if (reason) {
      this.toast(`Nothing was changed: ${reason}.`)
    }
  }

  /** Apply locally, send, and report null (saved) or the reason it was refused. */
  private apply(
    id: string,
    patch: ItemPatch,
    quiet: boolean,
  ): { change: Change; result: Promise<string | null> } | null {
    const before = this.items.get(id)
    if (!before) return null
    const after = this.applyPatch(before, patch)
    this.setItem(after)
    const change: Change = { id, before, after }
    const announce = !this.undoing && !quiet
    this.undoStack.push(change)
    if (this.undoStack.length > 50) this.undoStack.shift()

    const result = this.save(before, patch).then(
      (saved) => {
        if (patch.statusId !== undefined && patch.statusId !== before.statusId && announce) {
          const name = this.stages.get(`${before.teamId}:${patch.statusId}`)?.name ?? patch.statusId
          this.toast(`${before.key} moved to ${name}.`, {
            label: 'Undo',
            run: () => this.undoChange(change),
          })
        }
        // The server has the last word (for example, a hand-over may clear the owner),
        // unless a newer local change has replaced this one in the meantime.
        if (saved && this.items.get(id) === after) this.setItem(saved)
        return null
      },
      (error: unknown) => {
        this.undoStack = this.undoStack.filter((c) => c !== change)
        // Only revert if nothing newer has replaced this write.
        if (this.items.get(id) === after) this.setItem(before)
        const reason = error instanceof Error ? error.message : 'the server rejected that change'
        if (!quiet) this.toast(`${before.key}: ${reason}. The change was reverted.`)
        return reason
      },
    )
    return { change, result }
  }

  /** Undo the last change by sending the previous values as a new change. */
  undo(): void {
    const change = this.undoStack.pop()
    if (!change) return
    this.undoChange(change)
  }

  private undoing = false
  private readonly undone = new WeakSet<Change>()

  private undoChange(change: Change, quiet = false): void {
    if (this.undone.has(change)) return
    this.undone.add(change)
    this.undoStack = this.undoStack.filter((c) => c !== change)
    const { before, after } = change
    const patch: ItemPatch = {
      ...(before.statusId !== after.statusId ? { statusId: before.statusId } : {}),
      ...(before.assigneeId !== after.assigneeId ? { assigneeId: before.assigneeId } : {}),
      ...(before.fields.priority !== after.fields.priority
        ? { priority: Number(before.fields.priority ?? 0) }
        : {}),
    }
    this.undoing = true
    this.mutate(change.id, patch)
    this.undoing = false
    this.undoStack.pop() // the undo itself is not something to undo
    if (!quiet) this.toast(`${before.key}: change undone.`)
  }

  toast(message: string, action?: ToastAction): void {
    const toast: Toast = action
      ? { id: this.nextToastId++, message, action }
      : { id: this.nextToastId++, message }
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
    this.changed()
  }

  private changed(): void {
    this.revision++
    this.changeListeners.forEach((listener) => listener())
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
      // Known by itself, not part of the list: keep it out of the list order and counts.
      this.items.set(item.id, item)
      this.keyToId.set(item.key.toLowerCase(), item.id)
      this.haystack.set(item.id, `${item.key} ${item.title}`.toLowerCase())
      this.changed()
      return
    }
    this.setItem(item)
    this.haystack.set(item.id, `${item.key} ${item.title}`.toLowerCase())
  }
}
