/**
 * Recurring items and their runs (specs/data-model.md, rules 19–23). Schedules are worked out in
 * the team's time zone; India has no daylight saving, but any IANA zone works.
 */

export type ScheduleRule =
  | { kind: 'daily'; time?: string }
  | { kind: 'weekly'; weekdays: number[]; time?: string }
  | { kind: 'monthly'; day: number | 'first_working' | 'last_working'; time?: string }
  | { kind: 'quarterly'; time?: string }

export const DEFAULT_TZ = 'Asia/Kolkata'

/** A rule the scheduler can use, or the reason it cannot. */
export function checkRule(rule: unknown): string | null {
  if (!rule || typeof rule !== 'object') return 'rule_missing'
  const r = rule as Record<string, unknown>
  if (
    r['time'] !== undefined &&
    !(typeof r['time'] === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(r['time']))
  )
    return 'bad_time'
  switch (r['kind']) {
    case 'daily':
    case 'quarterly':
      return null
    case 'weekly': {
      const days = r['weekdays']
      return Array.isArray(days) &&
        days.length > 0 &&
        days.every((d) => Number.isInteger(d) && d >= 1 && d <= 7)
        ? null
        : 'bad_weekdays'
    }
    case 'monthly': {
      const day = r['day']
      return day === 'first_working' ||
        day === 'last_working' ||
        (Number.isInteger(day) && (day as number) >= 1 && (day as number) <= 31)
        ? null
        : 'bad_day'
    }
    default:
      return 'bad_kind'
  }
}

interface LocalDate {
  y: number
  m: number // 1–12
  d: number
}

/** Minutes the zone is ahead of UTC at a moment. */
function zoneOffsetMinutes(at: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  }).formatToParts(at)
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0)
  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  )
  return Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / 60000)
}

function localDateOf(at: Date, tz: string): LocalDate {
  const shifted = new Date(at.getTime() + zoneOffsetMinutes(at, tz) * 60000)
  return { y: shifted.getUTCFullYear(), m: shifted.getUTCMonth() + 1, d: shifted.getUTCDate() }
}

/** The moment a local date and time happens in the zone. */
function atLocal(date: LocalDate, time: string, tz: string): Date {
  const [hh = 9, mm = 0] = time.split(':').map(Number)
  const guess = new Date(Date.UTC(date.y, date.m - 1, date.d, hh, mm))
  return new Date(guess.getTime() - zoneOffsetMinutes(guess, tz) * 60000)
}

function addDays(date: LocalDate, n: number): LocalDate {
  const t = new Date(Date.UTC(date.y, date.m - 1, date.d + n))
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() }
}

/** 1 = Monday … 7 = Sunday. */
function weekday(date: LocalDate): number {
  const w = new Date(Date.UTC(date.y, date.m - 1, date.d)).getUTCDay()
  return w === 0 ? 7 : w
}

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}

const isWorking = (date: LocalDate) => weekday(date) <= 5

function firstWorking(y: number, m: number): number {
  for (let d = 1; ; d++) if (isWorking({ y, m, d })) return d
}

function lastWorking(y: number, m: number): number {
  for (let d = daysInMonth(y, m); ; d--) if (isWorking({ y, m, d })) return d
}

function matches(rule: ScheduleRule, date: LocalDate): boolean {
  switch (rule.kind) {
    case 'daily':
      return true
    case 'weekly':
      return rule.weekdays.includes(weekday(date))
    case 'monthly':
      if (rule.day === 'first_working') return date.d === firstWorking(date.y, date.m)
      if (rule.day === 'last_working') return date.d === lastWorking(date.y, date.m)
      // Day 31 in a 30-day month means the month's last day.
      return date.d === Math.min(rule.day, daysInMonth(date.y, date.m))
    case 'quarterly':
      return (date.m - 1) % 3 === 0 && date.d === firstWorking(date.y, date.m)
  }
}

/** The first scheduled moment strictly after `after`. */
export function nextRunAfter(rule: ScheduleRule, after: Date, tz: string = DEFAULT_TZ): Date {
  const time = rule.time ?? '09:00'
  let day = localDateOf(after, tz)
  for (let i = 0; i < 400; i++, day = addDays(day, 1)) {
    if (!matches(rule, day)) continue
    const at = atLocal(day, time, tz)
    if (at.getTime() > after.getTime()) return at
  }
  throw new Error('No run date within 400 days')
}

/** Plain words for a schedule, e.g. "Every month on the first working day at 09:00". */
export function describeRule(rule: ScheduleRule): string {
  const time = rule.time ?? '09:00'
  const names = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
  switch (rule.kind) {
    case 'daily':
      return `Every day at ${time}`
    case 'weekly':
      return `Every week on ${rule.weekdays.map((d) => names[d]).join(', ')} at ${time}`
    case 'monthly':
      return `Every month on ${rule.day === 'first_working' ? 'the first working day' : rule.day === 'last_working' ? 'the last working day' : `day ${rule.day}`} at ${time}`
    case 'quarterly':
      return `Every quarter on the first working day at ${time}`
  }
}
