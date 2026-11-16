import { describe, expect, it } from 'vitest'
import { generateSampleWorkItems, isWorkItemKind, SAMPLE_STATUSES } from '../src/index.js'

describe('generateSampleWorkItems', () => {
  it('is deterministic for a given seed', () => {
    expect(generateSampleWorkItems(50, 7)).toEqual(generateSampleWorkItems(50, 7))
    expect(generateSampleWorkItems(50, 7)).not.toEqual(generateSampleWorkItems(50, 8))
  })

  it('creates the requested number of items with unique ids and keys', () => {
    const items = generateSampleWorkItems(10_000)
    expect(items).toHaveLength(10_000)
    expect(new Set(items.map((i) => i.id)).size).toBe(10_000)
    expect(new Set(items.map((i) => i.key)).size).toBe(10_000)
  })

  it('uses valid kinds and keeps status and category consistent', () => {
    for (const item of generateSampleWorkItems(500)) {
      expect(isWorkItemKind(item.kind)).toBe(true)
      const status = SAMPLE_STATUSES.find((s) => s.id === item.statusId)
      expect(status?.category).toBe(item.statusCategory)
    }
  })
})
