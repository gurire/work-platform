/** Pure helpers for the item page, kept out of React so they can be tested directly. */
import type { Stage } from '@wm/shared'

export interface HistoryEntry {
  readonly stageKey: string
  readonly ownerId: string | null
  readonly enteredAt: string
  readonly leftAt: string | null
  readonly movedBy: string | null
  readonly kind: 'move' | 'forced' | 'reopen'
  readonly reason: string | null
}

export interface StripStage {
  readonly key: string
  readonly name: string
  readonly state: 'current' | 'visited' | 'upcoming'
  /** The owner of the latest pass through this stage, or the current owner for the current stage. */
  readonly ownerId: string | null
  /** How many times the item has entered this stage. */
  readonly passes: number
  readonly ended: boolean
}

/** One entry per stage, in order, showing where the item is and who owned each step. */
export function buildStageStrip(
  stages: readonly Stage[],
  history: readonly HistoryEntry[],
  currentKey: string,
  currentOwner: string | null,
): StripStage[] {
  return [...stages]
    .sort((a, b) => a.position - b.position)
    .map((stage) => {
      const passes = history.filter((entry) => entry.stageKey === stage.key)
      const last = passes[passes.length - 1]
      const current = stage.key === currentKey
      return {
        key: stage.key,
        name: stage.name,
        state: current ? 'current' : passes.length > 0 ? 'visited' : 'upcoming',
        ownerId: current ? currentOwner : (last?.ownerId ?? null),
        passes: passes.length,
        ended: stage.category === 'done' || stage.category === 'cancelled',
      }
    })
}

/** "just now", "5 min ago", "3 h ago", "2 d ago", then a date. */
export function timeAgo(iso: string, now: number = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000))
  if (seconds < 60) return 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  const days = Math.round(hours / 24)
  if (days < 30) return `${days} d ago`
  return new Date(iso).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

export type Route = { readonly page: 'list' } | { readonly page: 'item'; readonly key: string }

/** `#/item/ENG-42` opens an item; anything else is the list. */
export function parseRoute(hash: string): Route {
  const match = /^#\/item\/([A-Za-z0-9_-]{1,64})$/.exec(hash)
  return match?.[1] ? { page: 'item', key: match[1] } : { page: 'list' }
}

export function itemHash(key: string): string {
  return `#/item/${encodeURIComponent(key)}`
}
