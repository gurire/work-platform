import { describe, expect, it } from 'vitest'
import { createPgliteDb } from '../src/db/db.js'
import { migrate } from '../src/db/migrations.js'
import { seedDevData } from '../src/db/seed.js'

describe('migrations and dev seed', () => {
  it('migrates once and seeds made-up data idempotently', async () => {
    const db = await createPgliteDb()
    expect(await migrate(db)).toEqual([
      '0001_core',
      '0002_stages',
      '0003_stage_rules',
      '0004_reviews',
      '0005_records',
      '0006_stage_limits',
      '0007_code_status',
      '0008_comments',
      '0009_stage_kind',
    ])
    expect(await migrate(db)).toEqual([])
    await seedDevData(db, 40, 10)
    await seedDevData(db, 40, 10)
    const items = await db.query<{ count: string }>('SELECT count(*) AS count FROM work_items')
    expect(Number(items[0]?.count)).toBe(51)
    // Every item has a full sample history and exactly one current stage entry.
    const history = await db.query<{ count: string }>(
      'SELECT count(*) AS count FROM stage_history WHERE left_at IS NULL',
    )
    expect(Number(history[0]?.count)).toBe(51)
    const earlier = await db.query<{ count: string }>(
      'SELECT count(*) AS count FROM stage_history WHERE left_at IS NOT NULL AND left_at < entered_at',
    )
    expect(Number(earlier[0]?.count)).toBe(0)
    const stages = await db.query("SELECT 1 FROM stages WHERE team_id = 'DATA'")
    expect(stages).toHaveLength(8)
    const priv = await db.query('SELECT 1 FROM teams WHERE is_private')
    expect(priv).toHaveLength(1)
    await db.close()
  }, 30_000)
})
