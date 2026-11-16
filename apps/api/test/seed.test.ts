import { describe, expect, it } from 'vitest'
import { createPgliteDb } from '../src/db/db.js'
import { migrate } from '../src/db/migrations.js'
import { seedDevData } from '../src/db/seed.js'

describe('migrations and dev seed', () => {
  it('migrates once and seeds made-up data idempotently', async () => {
    const db = await createPgliteDb()
    expect(await migrate(db)).toEqual(['0001_core'])
    expect(await migrate(db)).toEqual([])
    await seedDevData(db, 40)
    await seedDevData(db, 40)
    const items = await db.query<{ count: string }>('SELECT count(*) AS count FROM work_items')
    expect(Number(items[0]?.count)).toBe(41)
    const priv = await db.query('SELECT 1 FROM teams WHERE is_private')
    expect(priv).toHaveLength(1)
    await db.close()
  }, 30_000)
})
