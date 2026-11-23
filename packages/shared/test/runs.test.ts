import { describe, expect, it } from 'vitest'
import { checkRule, describeRule, nextRunAfter } from '../src/runs.js'

const ist = (iso: string) => new Date(`${iso}+05:30`)

describe('schedules (data model rule 23)', () => {
  it('runs daily at the set time in India time', () => {
    expect(nextRunAfter({ kind: 'daily' }, ist('2026-11-23T10:00:00')).toISOString()).toBe(
      ist('2026-11-24T09:00:00').toISOString(),
    )
    expect(
      nextRunAfter({ kind: 'daily', time: '18:30' }, ist('2026-11-23T10:00:00')).toISOString(),
    ).toBe(ist('2026-11-23T18:30:00').toISOString())
  })
  it('runs weekly on chosen weekdays', () => {
    // 23 Nov 2026 is a Monday.
    expect(
      nextRunAfter({ kind: 'weekly', weekdays: [1, 4] }, ist('2026-11-23T10:00:00')).toISOString(),
    ).toBe(ist('2026-11-26T09:00:00').toISOString())
  })
  it('runs on the first and last working day of the month', () => {
    // 1 Nov 2026 is a Sunday, so the first working day is Monday 2 Nov; 1 Dec is a Tuesday.
    expect(
      nextRunAfter(
        { kind: 'monthly', day: 'first_working' },
        ist('2026-11-23T10:00:00'),
      ).toISOString(),
    ).toBe(ist('2026-12-01T09:00:00').toISOString())
    // 31 Jan 2027 is a Sunday: the last working day is Friday 29 Jan.
    expect(
      nextRunAfter(
        { kind: 'monthly', day: 'last_working' },
        ist('2027-01-02T10:00:00'),
      ).toISOString(),
    ).toBe(ist('2027-01-29T09:00:00').toISOString())
  })
  it('treats day 31 as the last day of shorter months', () => {
    expect(
      nextRunAfter({ kind: 'monthly', day: 31 }, ist('2027-02-01T10:00:00')).toISOString(),
    ).toBe(ist('2027-02-28T09:00:00').toISOString())
  })
  it('runs quarterly on the first working day of the quarter', () => {
    // 1 Jan 2027 is a Friday.
    expect(nextRunAfter({ kind: 'quarterly' }, ist('2026-11-23T10:00:00')).toISOString()).toBe(
      ist('2027-01-01T09:00:00').toISOString(),
    )
  })
  it('refuses bad rules and describes good ones', () => {
    expect(checkRule({ kind: 'weekly', weekdays: [] })).toBe('bad_weekdays')
    expect(checkRule({ kind: 'monthly', day: 40 })).toBe('bad_day')
    expect(checkRule({ kind: 'daily', time: '25:00' })).toBe('bad_time')
    expect(checkRule({ kind: 'monthly', day: 'first_working' })).toBeNull()
    expect(describeRule({ kind: 'monthly', day: 'first_working' })).toBe(
      'Every month on the first working day at 09:00',
    )
  })
})
