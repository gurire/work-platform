import { PGlite } from '@electric-sql/pglite'

/**
 * The only way the API talks to the database. Local development and tests use PGlite
 * (Postgres compiled to run inside Node, nothing to install). On AWS the same interface
 * will be backed by RDS Postgres, so SQL here must stay plain Postgres.
 */
export interface Db {
  query<T = Record<string, unknown>>(sql: string, params?: readonly unknown[]): Promise<T[]>
  exec(sql: string): Promise<void>
  close(): Promise<void>
}

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
    async close(): Promise<void> {
      await pg.close()
    },
  }
}
