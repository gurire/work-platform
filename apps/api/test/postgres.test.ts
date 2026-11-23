// Runs against a real PostgreSQL when TEST_DATABASE_URL is set (CI starts one). Locally it is
// skipped unless you point it at a throwaway database: it creates and drops its own schema.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Db } from '../src/db/db.js'
import { createKysely } from '../src/db/kysely.js'
import { migrate } from '../src/db/migrations.js'
import { createPgDb } from '../src/db/pg.js'
import { seedDevData } from '../src/db/seed.js'

const url = process.env['TEST_DATABASE_URL']
const schema = `test_${Date.now()}`

describe.skipIf(!url)('the same code on real PostgreSQL', () => {
  let db: Db

  beforeAll(async () => {
    const admin = createPgDb(url as string)
    await admin.exec(`CREATE SCHEMA ${schema}`)
    await admin.close()
    const sep = (url as string).includes('?') ? '&' : '?'
    db = createPgDb(`${url as string}${sep}options=-c%20search_path%3D${schema}`)
  })

  afterAll(async () => {
    if (!db) return
    await db.exec(`DROP SCHEMA ${schema} CASCADE`)
    await db.close()
  })

  it('applies every migration and the sample data', async () => {
    const applied = await migrate(db)
    expect(applied.length).toBeGreaterThan(0)
    await seedDevData(db)
    const [row] = await db.query<{ n: number }>('SELECT count(*)::int AS n FROM work_items')
    expect(row?.n).toBeGreaterThan(0)
  })

  it('returns sequence numbers as numbers, as the embedded database does', async () => {
    const [row] = await db.query<{ seq: unknown }>(
      'SELECT seq FROM work_items ORDER BY seq LIMIT 1',
    )
    expect(typeof row?.seq).toBe('number')
  })

  it('runs typed Kysely queries and rolls back failed transactions', async () => {
    const sql = createKysely(db)
    await expect(
      sql.transaction().execute(async (trx) => {
        await trx
          .insertInto('users')
          .values({ id: 'pg-1', name: 'Never saved', org_role: 'member' })
          .execute()
        throw new Error('stop')
      }),
    ).rejects.toThrow('stop')
    const row = await sql
      .selectFrom('users')
      .select('id')
      .where('id', '=', 'pg-1')
      .executeTakeFirst()
    expect(row).toBeUndefined()
  })
})
