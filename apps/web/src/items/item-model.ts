/** Pure helpers for the item page, kept out of React so they can be tested directly. */
import type { Stage } from '@wm/shared'

export interface HistoryEntry {
  readonly stageKey: string
  readonly ownerId: string | null
  readonly enteredAt: string
  readonly leftAt: string | null
  readonly movedBy: string | null
  readonly kind: 'move' | 'forced' | 'reopen' | 'sent_back' | 'automatic'
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

export type Route =
  | { readonly page: 'list'; readonly teamId?: string }
  | { readonly page: 'me' }
  | { readonly page: 'item'; readonly key: string }
  | { readonly page: 'record'; readonly id: string }
  | { readonly page: 'board'; readonly teamId: string }
  | { readonly page: 'inbox' }
  | { readonly page: 'dashboard'; readonly teamId: string }
  | { readonly page: 'dashboards' }

/** `#/item/ENG-42` opens an item, `#/record/<id>` a record; anything else is the list. */
export function parseRoute(hash: string): Route {
  const item = /^#\/item\/([A-Za-z0-9_-]{1,64})$/.exec(hash)
  if (item?.[1]) return { page: 'item', key: item[1] }
  const record = /^#\/record\/([A-Za-z0-9_-]{1,80})$/.exec(hash)
  if (record?.[1]) return { page: 'record', id: record[1] }
  if (hash === '#/inbox') return { page: 'inbox' }
  if (hash === '#/me') return { page: 'me' }
  const team = /^#\/team\/([A-Za-z0-9_-]{1,64})$/.exec(hash)
  if (team?.[1]) return { page: 'list', teamId: team[1] }
  if (hash === '#/dashboards') return { page: 'dashboards' }
  const dashboard = /^#\/dashboard\/([A-Za-z0-9_-]{1,64})$/.exec(hash)
  if (dashboard?.[1]) return { page: 'dashboard', teamId: dashboard[1] }
  const board = /^#\/board\/([A-Za-z0-9_-]{1,64})$/.exec(hash)
  if (board?.[1]) return { page: 'board', teamId: board[1] }
  return { page: 'list' }
}

export function itemHash(key: string): string {
  return `#/item/${encodeURIComponent(key)}`
}

export function recordHash(id: string): string {
  return `#/record/${encodeURIComponent(id)}`
}

export function dashboardHash(teamId: string | null): string {
  return teamId ? `#/dashboard/${encodeURIComponent(teamId)}` : '#/dashboards'
}

export function teamHash(teamId: string | null): string {
  return teamId ? `#/team/${encodeURIComponent(teamId)}` : '#/'
}

export function boardHash(teamId: string): string {
  return `#/board/${encodeURIComponent(teamId)}`
}

/** "3 h", "2 d": a short waiting time for a card. */
export function shortDuration(hours: number): string {
  if (hours < 1) return '<1 h'
  if (hours < 48) return `${Math.floor(hours)} h`
  return `${Math.floor(hours / 24)} d`
}
