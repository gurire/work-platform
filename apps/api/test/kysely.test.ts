import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createPgliteDb, type Db } from '../src/db/db.js'
import { createKysely, type Sql } from '../src/db/kysely.js'
import { migrate } from '../src/db/migrations.js'

let db: Db
let sql: Sql

beforeAll(async () => {
  db = await createPgliteDb()
  await migrate(db)
  sql = createKysely(db)
})

afterAll(async () => {
  await sql.destroy()
  await db.close()
})

describe('Kysely on the embedded database', () => {
  it('inserts and reads rows with typed queries', async () => {
    await sql
      .insertInto('users')
      .values({ id: 'u-k1', name: 'Kysely Tester', org_role: 'member' })
      .execute()
    const row = await sql
      .selectFrom('users')
      .select(['id', 'name'])
      .where('id', '=', 'u-k1')
      .executeTakeFirst()
    expect(row).toEqual({ id: 'u-k1', name: 'Kysely Tester' })
  })

  it('sees rows written with plain SQL, and the other way round', async () => {
    await db.query("INSERT INTO teams (id, key, name) VALUES ('t-k1', 'KYS', 'Kysely team')")
    const team = await sql
      .selectFrom('teams')
      .selectAll()
      .where('id', '=', 't-k1')
      .executeTakeFirstOrThrow()
    expect(team.is_private).toBe(false)
    await sql
      .insertInto('team_members')
      .values({ team_id: 't-k1', user_id: 'u-k1', role: 'admin' })
      .execute()
    const rows = await db.query<{ role: string }>(
      "SELECT role FROM team_members WHERE team_id = 't-k1'",
    )
    expect(rows).toEqual([{ role: 'admin' }])
  })

  it('rolls a failed transaction back completely', async () => {
    await expect(
      sql.transaction().execute(async (trx) => {
        await trx
          .insertInto('users')
          .values({ id: 'u-k2', name: 'Never saved', org_role: 'member' })
          .execute()
        throw new Error('stop')
      }),
    ).rejects.toThrow('stop')
    const row = await sql
      .selectFrom('users')
      .select('id')
      .where('id', '=', 'u-k2')
      .executeTakeFirst()
    expect(row).toBeUndefined()
  })

  it('runs queries one after another while a transaction is open', async () => {
    const order: string[] = []
    const tx = sql.transaction().execute(async (trx) => {
      await trx
        .insertInto('users')
        .values({ id: 'u-k3', name: 'In transaction', org_role: 'member' })
        .execute()
      order.push('tx')
    })
    const read = sql
      .selectFrom('users')
      .select('id')
      .where('id', '=', 'u-k3')
      .execute()
      .then((r) => {
        order.push('read')
        return r
      })
    const [, rows] = await Promise.all([tx, read])
    expect(order).toEqual(['tx', 'read'])
    expect(rows).toEqual([{ id: 'u-k3' }])
  })
})
