import { describe, expect, it } from 'vitest'
import {
  cumulativeFlow,
  days,
  defaultStageKind,
  forecastHowMany,
  forecastWhen,
  healthStatus,
  itemTimes,
  localDay,
  percentile,
  recentWeeks,
  startOfLocalDay,
  throughputByWeek,
  trendOf,
  weekOf,
  type StageEntry,
} from '../src/index.js'

const CATEGORY: Record<string, 'todo' | 'in_progress' | 'done' | 'cancelled'> = {
  analysis: 'todo',
  processing: 'in_progress',
  validation: 'in_progress',
  published: 'done',
  dropped: 'cancelled',
}
const categoryOf = (key: string) => CATEGORY[key]
const at = (iso: string) => Date.parse(iso)

describe('item times (spec section 8)', () => {
  const history: StageEntry[] = [
    { stageKey: 'analysis', enteredAt: at('2026-10-01T06:00:00Z') },
    { stageKey: 'processing', enteredAt: at('2026-10-03T06:00:00Z') },
    { stageKey: 'validation', enteredAt: at('2026-10-06T06:00:00Z') },
    { stageKey: 'published', enteredAt: at('2026-10-10T06:00:00Z') },
  ]

  it('example 1: cycle time 7.0 days, lead time 9.0 days', () => {
    const t = itemTimes(history, categoryOf)
    expect(days(t.started!, t.finished!)).toBe(7)
    expect(days(at('2026-10-01T06:00:00Z'), t.finished!)).toBe(9)
  })

  it('example 2: reopened and published again counts the new finish', () => {
    const reopened = [
      ...history,
      { stageKey: 'processing', enteredAt: at('2026-10-12T06:00:00Z') },
      { stageKey: 'published', enteredAt: at('2026-10-15T06:00:00Z') },
    ]
    const t = itemTimes(reopened, categoryOf)
    expect(days(t.started!, t.finished!)).toBe(12)
    expect(itemTimes(reopened.slice(0, 5), categoryOf).finished).toBeNull()
  })

  it('cancelled items never finish; entries can come in any order', () => {
    const t = itemTimes(
      [
        ...history.slice(0, 2),
        { stageKey: 'dropped', enteredAt: at('2026-10-05T00:00:00Z') },
      ].reverse(),
      categoryOf,
    )
    expect(t.finished).toBeNull()
    expect(t.started).toBe(at('2026-10-03T06:00:00Z'))
  })
})

describe('percentiles', () => {
  it('example 3: nearest rank 85th percentile of nine items is 9 days', () => {
    expect(percentile([14, 1, 2, 2, 3, 4, 5, 6, 9], 0.85)).toBe(9)
  })
  it('no values gives null', () => {
    expect(percentile([], 0.85)).toBeNull()
  })
})

describe('weeks and days in the organisation time zone', () => {
  it('a Sunday evening in India is still the week that started on Monday', () => {
    // 2026-11-15 is a Sunday. 20:00 IST = 14:30 UTC.
    expect(weekOf(at('2026-11-15T14:30:00Z'))).toBe('2026-11-09')
    // 00:30 IST on Monday 16 Nov is still Sunday 19:00 UTC.
    expect(weekOf(at('2026-11-15T19:00:00Z'))).toBe('2026-11-16')
    expect(localDay(at('2026-11-15T19:00:00Z'))).toBe('2026-11-16')
  })
  it('start of a local day', () => {
    expect(new Date(startOfLocalDay('2026-11-16')).toISOString()).toBe('2026-11-15T18:30:00.000Z')
  })
  it('recent weeks end with the current week, and throughput counts per week', () => {
    const weeks = recentWeeks(at('2026-11-17T06:00:00Z'), 3)
    expect(weeks).toEqual(['2026-11-02', '2026-11-09', '2026-11-16'])
    expect(
      throughputByWeek(
        [
          at('2026-11-03T06:00:00Z'),
          at('2026-11-16T06:00:00Z'),
          at('2026-11-17T06:00:00Z'),
          at('2026-01-01T00:00:00Z'),
        ],
        weeks,
      ),
    ).toEqual([1, 0, 2])
  })
})

describe('cumulative flow', () => {
  it('counts each item in the stage it was in at the end of each day, without cancelled', () => {
    const stages = [
      { key: 'analysis', category: 'todo' as const, position: 1 },
      { key: 'processing', category: 'in_progress' as const, position: 2 },
      { key: 'published', category: 'done' as const, position: 3 },
      { key: 'dropped', category: 'cancelled' as const, position: 4 },
    ]
    const ends = [
      at('2026-10-01T23:00:00Z'),
      at('2026-10-02T23:00:00Z'),
      at('2026-10-03T23:00:00Z'),
    ]
    const flow = cumulativeFlow(
      [
        [
          { stageKey: 'analysis', enteredAt: at('2026-10-01T05:00:00Z') },
          { stageKey: 'processing', enteredAt: at('2026-10-02T05:00:00Z') },
          { stageKey: 'published', enteredAt: at('2026-10-03T05:00:00Z') },
        ],
        [
          { stageKey: 'analysis', enteredAt: at('2026-10-02T05:00:00Z') },
          { stageKey: 'dropped', enteredAt: at('2026-10-03T05:00:00Z') },
        ],
      ],
      stages,
      ends,
    )
    expect(flow.map((s) => s.stageKey)).toEqual(['analysis', 'processing', 'published'])
    expect(flow[0]!.counts).toEqual([1, 1, 0])
    expect(flow[1]!.counts).toEqual([0, 1, 0])
    expect(flow[2]!.counts).toEqual([0, 0, 1])
  })
})

describe('forecast (spec section 5)', () => {
  const weekly = [3, 5, 4, 6, 3, 7, 4, 5, 2, 6, 5, 4]

  it('is the same for the same seed, and ordered 50 <= 85 <= 95', () => {
    const a = forecastWhen(weekly, 20, 'DATA:2026-11-17')!
    const b = forecastWhen(weekly, 20, 'DATA:2026-11-17')!
    expect(a).toEqual(b)
    expect(a.p50).toBeLessThanOrEqual(a.p85)
    expect(a.p85).toBeLessThanOrEqual(a.p95)
    // About 4.5 items a week: 20 items take 4 to 6 weeks.
    expect(a.p50).toBeGreaterThanOrEqual(4)
    expect(a.p95).toBeLessThanOrEqual(7)
    expect(a.spread.reduce((sum, share) => sum + share, 0)).toBeCloseTo(1, 1)
  })

  it('how many: more confidence means fewer items', () => {
    const f = forecastHowMany(weekly, 4, 'DATA:2026-11-17')!
    expect(f.p95).toBeLessThanOrEqual(f.p85)
    expect(f.p85).toBeLessThanOrEqual(f.p50)
    expect(f.p50).toBeGreaterThanOrEqual(16)
  })

  it('example 6: fewer than 4 complete weeks, or no finishes, is not enough history', () => {
    expect(forecastWhen([3, 4, 5], 10, 's')).toBeNull()
    expect(forecastWhen([0, 0, 0, 0], 10, 's')).toBeNull()
    expect(forecastHowMany([3, 4, 5], 2, 's')).toBeNull()
  })
})

describe('stage kinds and health', () => {
  it('starting kinds follow category and name', () => {
    expect(defaultStageKind({ name: 'Analysis', category: 'todo' })).toBe('waiting')
    expect(defaultStageKind({ name: 'Processing', category: 'in_progress' })).toBe('working')
    expect(defaultStageKind({ name: 'Client review', category: 'in_progress' })).toBe('review')
    expect(defaultStageKind({ name: 'Ready to publish', category: 'in_progress' })).toBe('release')
    expect(defaultStageKind({ name: 'Published', category: 'done' })).toBeNull()
  })

  it('status thresholds', () => {
    expect(healthStatus({ pastTarget: 2, startedOpen: 10, cycleNow: 5, cycleBefore: 5 })).toBe(
      'at_risk',
    )
    expect(healthStatus({ pastTarget: 1, startedOpen: 10, cycleNow: 5, cycleBefore: 5 })).toBe(
      'watch',
    )
    expect(healthStatus({ pastTarget: 0, startedOpen: 10, cycleNow: 6.5, cycleBefore: 5 })).toBe(
      'at_risk',
    )
    expect(healthStatus({ pastTarget: 0, startedOpen: 10, cycleNow: 5.6, cycleBefore: 5 })).toBe(
      'watch',
    )
    expect(healthStatus({ pastTarget: 0, startedOpen: 0, cycleNow: null, cycleBefore: null })).toBe(
      'on_track',
    )
  })

  it('trends are level within 10%', () => {
    expect(trendOf(11, 10)).toBe('level')
    expect(trendOf(12, 10)).toBe('up')
    expect(trendOf(8, 10)).toBe('down')
  })
})
