import { PGlite } from '@electric-sql/pglite'
import type { Dialect } from 'kysely'
import { PgliteDialect } from './pglite-dialect.js'

/**
 * The only way the API talks to the database. Local development and tests use PGlite
 * (Postgres compiled to run inside Node, nothing to install). On AWS the same interface is
 * backed by RDS Postgres (pg.ts), so SQL here must stay plain Postgres. New code builds its
 * queries with Kysely (kysely.ts), which runs through `dialect()`.
 */
export interface Db {
  query<T = Record<string, unknown>>(sql: string, params?: readonly unknown[]): Promise<T[]>
  exec(sql: string): Promise<void>
  /** Runs `fn` in one transaction: everything in it is saved together, or nothing is. */
  transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>
  close(): Promise<void>
  /** How Kysely reaches this database. */
  dialect(): Dialect
}

export type Queryable = Pick<Db, 'query'>

/** `dataDir` undefined means in-memory (tests). A path keeps data between runs (local dev). */
export async function createPgliteDb(dataDir?: string): Promise<Db> {
  const pg = dataDir ? new PGlite(dataDir) : new PGlite()
  await pg.waitReady
  return {
    async query<T>(sql: string, params: readonly unknown[] = []): Promise<T[]> {
      const result = await pg.query<T>(sql, [...params])
      return result.rows
    },
    async exec(sql: string): Promise<void> {
      await pg.exec(sql)
    },
    async transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T> {
      return pg.transaction(async (tx) =>
        fn({
          async query<R>(sql: string, params: readonly unknown[] = []): Promise<R[]> {
            return (await tx.query<R>(sql, [...params])).rows
          },
        }),
      )
    },
    async close(): Promise<void> {
      await pg.close()
    },
    dialect: () => new PgliteDialect(pg),
  }
}
