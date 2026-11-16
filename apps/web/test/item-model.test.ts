import { describe, expect, it } from 'vitest'
import type { Stage } from '@wm/shared'
import {
  buildStageStrip,
  itemHash,
  parseRoute,
  timeAgo,
  type HistoryEntry,
} from '../src/items/item-model'

const stage = (key: string, category: Stage['category'], position: number): Stage => ({
  teamId: 'T',
  key,
  name: key.toUpperCase(),
  category,
  position,
})
const entry = (stageKey: string, ownerId: string | null): HistoryEntry => ({
  stageKey,
  ownerId,
  enteredAt: '2026-11-10T00:00:00Z',
  leftAt: null,
  movedBy: null,
  kind: 'move',
  reason: null,
})

describe('buildStageStrip', () => {
  const stages = [stage('c', 'done', 3), stage('a', 'todo', 1), stage('b', 'in_progress', 2)]

  it('orders stages and marks current, visited and upcoming', () => {
    const strip = buildStageStrip(stages, [entry('a', 'ana'), entry('b', null)], 'b', 'ben')
    expect(strip.map((s) => [s.key, s.state, s.ownerId])).toEqual([
      ['a', 'visited', 'ana'],
      ['b', 'current', 'ben'],
      ['c', 'upcoming', null],
    ])
    expect(strip[2]?.ended).toBe(true)
  })

  it('counts passes and shows the owner of the latest pass', () => {
    const history = [entry('a', 'ana'), entry('b', 'ben'), entry('a', 'eve'), entry('b', null)]
    const strip = buildStageStrip(stages, history, 'b', null)
    expect(strip[0]).toMatchObject({ ownerId: 'eve', passes: 2 })
    expect(strip[1]).toMatchObject({ state: 'current', passes: 2 })
  })
})

describe('timeAgo', () => {
  const now = Date.parse('2026-11-17T12:00:00Z')
  it('describes recent times in words', () => {
    expect(timeAgo('2026-11-17T11:59:30Z', now)).toBe('just now')
    expect(timeAgo('2026-11-17T11:30:00Z', now)).toBe('30 min ago')
    expect(timeAgo('2026-11-17T07:00:00Z', now)).toBe('5 h ago')
    expect(timeAgo('2026-11-15T12:00:00Z', now)).toBe('2 d ago')
  })
})

describe('routes', () => {
  it('opens an item from the hash and falls back to the list', () => {
    expect(parseRoute('#/item/DATA-12')).toEqual({ page: 'item', key: 'DATA-12' })
    expect(parseRoute('')).toEqual({ page: 'list' })
    expect(parseRoute('#/item/<script>')).toEqual({ page: 'list' })
    expect(itemHash('ENG-1')).toBe('#/item/ENG-1')
  })
})
