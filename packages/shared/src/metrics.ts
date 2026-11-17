/**
 * Dashboard numbers (specs/dashboards.md). Pure functions, shared by the API and the web app,
 * so a number means the same thing wherever it is shown.
 */
import type { Stage } from './work-item.js'

export const STAGE_KINDS = ['waiting', 'working', 'review', 'release'] as const
export type StageKind = (typeof STAGE_KINDS)[number]

/** The organisation's time zone for weeks and days (spec section 1, default). */
export const ORG_TIME_ZONE = 'Asia/Kolkata'
const DAY_MS = 86_400_000

/** A stage's kind when the team has not set one (spec section 4, rule 2). */
export function defaultStageKind(stage: Pick<Stage, 'name' | 'category'>): StageKind | null {
  if (stage.category === 'done' || stage.category === 'cancelled') return null
  if (/review/i.test(stage.name)) return 'review'
  if (/release|publish/i.test(stage.name)) return 'release'
  return stage.category === 'todo' ? 'waiting' : 'working'
}

export function effectiveStageKind(
  stage: Pick<Stage, 'name' | 'category'> & { readonly kind?: StageKind | null },
): StageKind | null {
  if (stage.category === 'done' || stage.category === 'cancelled') return null
  return stage.kind ?? defaultStageKind(stage)
}

/** One stage entry of an item's history. Times are milliseconds since 1970. */
export interface StageEntry {
  readonly stageKey: string
  readonly enteredAt: number
}

export type CategoryOf = (stageKey: string) => Stage['category'] | undefined

export interface ItemTimes {
  /** First entry into an in_progress stage. */
  readonly started: number | null
  /** Last entry into a done stage, only while the item is still done. */
  readonly finished: number | null
}

/** Started and finished for one item (spec section 1). Entries may come in any order. */
export function itemTimes(entries: readonly StageEntry[], categoryOf: CategoryOf): ItemTimes {
  const ordered = [...entries].sort((a, b) => a.enteredAt - b.enteredAt)
  let started: number | null = null
  for (const entry of ordered) {
    if (categoryOf(entry.stageKey) === 'in_progress') {
      started = entry.enteredAt
      break
    }
  }
  const last = ordered.at(-1)
  const finished = last && categoryOf(last.stageKey) === 'done' ? last.enteredAt : null
  return { started, finished }
}

/** Days with one decimal. */
export function days(fromMs: number, toMs: number): number {
  return Math.round(((toMs - fromMs) / DAY_MS) * 10) / 10
}

/** Nearest rank: sort, take position ceil(p × count). Null for no values. */
export function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const rank = Math.max(1, Math.ceil(p * sorted.length))
  return sorted[rank - 1] ?? null
}

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1
    ? (sorted[mid] ?? null)
    : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2
}

/** The local calendar day, as YYYY-MM-DD, in a time zone. */
export function localDay(ms: number, timeZone = ORG_TIME_ZONE): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(ms)
}

/** Minutes the time zone is ahead of UTC at a moment. */
function offsetMinutes(ms: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
  }).formatToParts(ms)
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0)
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'))
  return Math.round((asUtc - Math.floor(ms / 60_000) * 60_000) / 60_000)
}

/** Midnight at the start of a local day (YYYY-MM-DD), as milliseconds. */
export function startOfLocalDay(day: string, timeZone = ORG_TIME_ZONE): number {
  const [y, m, d] = day.split('-').map(Number)
  const guess = Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1)
  return guess - offsetMinutes(guess, timeZone) * 60_000
}

/** The Monday that starts the local week of a moment, as YYYY-MM-DD. */
export function weekOf(ms: number, timeZone = ORG_TIME_ZONE): string {
  const day = localDay(ms, timeZone)
  const [y, m, d] = day.split('-').map(Number)
  const date = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1))
  const back = (date.getUTCDay() + 6) % 7
  date.setUTCDate(date.getUTCDate() - back)
  return date.toISOString().slice(0, 10)
}

/** The Mondays of the last `count` weeks ending with the week of `now`, oldest first. */
export function recentWeeks(now: number, count: number, timeZone = ORG_TIME_ZONE): string[] {
  const current = weekOf(now, timeZone)
  const base = Date.parse(`${current}T00:00:00Z`)
  return Array.from({ length: count }, (_, i) =>
    new Date(base - (count - 1 - i) * 7 * DAY_MS).toISOString().slice(0, 10),
  )
}

/** Items finished per week, for the given weeks. */
export function throughputByWeek(
  finishedTimes: readonly number[],
  weeks: readonly string[],
  timeZone = ORG_TIME_ZONE,
): number[] {
  const index = new Map(weeks.map((week, i) => [week, i]))
  const counts = weeks.map(() => 0)
  for (const time of finishedTimes) {
    const i = index.get(weekOf(time, timeZone))
    if (i !== undefined) counts[i] = (counts[i] ?? 0) + 1
  }
  return counts
}

export interface FlowSeries {
  readonly stageKey: string
  readonly counts: readonly number[]
}

/**
 * Cumulative flow: at the end of each moment in `ends`, how many items sit in each stage.
 * Cancelled stages are left out. Stacking the series in workflow order gives "in or past".
 */
export function cumulativeFlow(
  histories: readonly (readonly StageEntry[])[],
  stages: readonly Pick<Stage, 'key' | 'category' | 'position'>[],
  ends: readonly number[],
): FlowSeries[] {
  const shown = [...stages]
    .filter((stage) => stage.category !== 'cancelled')
    .sort((a, b) => a.position - b.position)
  const row = new Map(shown.map((stage, i) => [stage.key, i]))
  const counts = shown.map(() => ends.map(() => 0))
  for (const history of histories) {
    const ordered = [...history].sort((a, b) => a.enteredAt - b.enteredAt)
    let at = -1
    ends.forEach((end, day) => {
      while (at + 1 < ordered.length && (ordered[at + 1]?.enteredAt ?? Infinity) <= end) at++
      const key = ordered[at]?.stageKey
      const r = key === undefined ? undefined : row.get(key)
      if (r !== undefined) {
        const line = counts[r]
        if (line) line[day] = (line[day] ?? 0) + 1
      }
    })
  }
  return shown.map((stage, i) => ({ stageKey: stage.key, counts: counts[i] ?? [] }))
}

/** A small, fast, seeded random number generator (mulberry32). */
function seeded(seed: string): () => number {
  let h = 1779033703 ^ seed.length
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353)
    h = (h << 13) | (h >>> 19)
  }
  let a = h >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export const FORECAST_RUNS = 10_000
export const FORECAST_MIN_WEEKS = 4

/** Forecasting needs 4 complete weeks with at least one finish (spec section 5, rule 6). */
export function canForecast(weekly: readonly number[]): boolean {
  return weekly.length >= FORECAST_MIN_WEEKS && weekly.some((count) => count > 0)
}

export interface WhenForecast {
  readonly p50: number
  readonly p85: number
  readonly p95: number
  /** Share of runs finishing in each week (index 0 = week 1), for the chart. */
  readonly spread: readonly number[]
}

/** In how many weeks will `remaining` items be done? Null without enough history. */
export function forecastWhen(
  weekly: readonly number[],
  remaining: number,
  seed: string,
  runs = FORECAST_RUNS,
): WhenForecast | null {
  if (!canForecast(weekly) || remaining < 1) return null
  const random = seeded(seed)
  const results: number[] = []
  for (let run = 0; run < runs; run++) {
    let done = 0
    let weeks = 0
    while (done < remaining && weeks < 520) {
      done += weekly[Math.floor(random() * weekly.length)] ?? 0
      weeks++
    }
    results.push(weeks)
  }
  const longest = Math.max(...results)
  const spread = Array.from({ length: longest }, () => 0)
  for (const weeks of results) spread[weeks - 1] = (spread[weeks - 1] ?? 0) + 1 / runs
  return {
    p50: percentile(results, 0.5) ?? 0,
    p85: percentile(results, 0.85) ?? 0,
    p95: percentile(results, 0.95) ?? 0,
    spread: spread.map((share) => Math.round(share * 1000) / 1000),
  }
}

export interface HowManyForecast {
  /** At least this many in 95% of runs, and so on. */
  readonly p95: number
  readonly p85: number
  readonly p50: number
}

/** How many items in the next `weeks` weeks? Null without enough history. */
export function forecastHowMany(
  weekly: readonly number[],
  weeks: number,
  seed: string,
  runs = FORECAST_RUNS,
): HowManyForecast | null {
  if (!canForecast(weekly) || weeks < 1) return null
  const random = seeded(seed)
  const totals: number[] = []
  for (let run = 0; run < runs; run++) {
    let total = 0
    for (let week = 0; week < weeks; week++) {
      total += weekly[Math.floor(random() * weekly.length)] ?? 0
    }
    totals.push(total)
  }
  // "At least N in 95% of runs" is the 5th percentile of the totals.
  return {
    p95: percentile(totals, 0.05) ?? 0,
    p85: percentile(totals, 0.15) ?? 0,
    p50: percentile(totals, 0.5) ?? 0,
  }
}

export type Trend = 'up' | 'down' | 'level'

/** Up or down when the change is more than 10%; otherwise level (spec section 6). */
export function trendOf(current: number | null, previous: number | null): Trend {
  if (current === null || previous === null || previous === 0) return 'level'
  const change = (current - previous) / previous
  if (change > 0.1) return 'up'
  if (change < -0.1) return 'down'
  return 'level'
}

export type HealthStatus = 'on_track' | 'watch' | 'at_risk'

/** The status rule from spec section 6. */
export function healthStatus(input: {
  readonly pastTarget: number
  readonly startedOpen: number
  readonly cycleNow: number | null
  readonly cycleBefore: number | null
}): HealthStatus {
  const share = input.startedOpen > 0 ? input.pastTarget / input.startedOpen : 0
  const rise =
    input.cycleNow !== null && input.cycleBefore !== null && input.cycleBefore > 0
      ? (input.cycleNow - input.cycleBefore) / input.cycleBefore
      : 0
  if (share >= 0.2 || rise > 0.25) return 'at_risk'
  if (share >= 0.1 || rise > 0.1) return 'watch'
  return 'on_track'
}
