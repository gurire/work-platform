import pg from 'pg'
import { PostgresDialect } from 'kysely'
import type { Db, Queryable } from './db.js'

/** Big integer columns (bigserial sequence numbers) come back as numbers, as on PGlite. */
pg.types.setTypeParser(20, (value) => Number(value))

export interface PgOptions {
  /** RDS needs TLS. Locally (a Postgres in Docker) it is usually off. */
  ssl?: boolean | undefined
  /** Most connections the API opens at once. */
  max?: number | undefined
}

/** The real database: PostgreSQL (Amazon RDS on AWS, or any Postgres locally). */
export function createPgDb(connectionString: string, options: PgOptions = {}): Db {
  const pool = new pg.Pool({
    connectionString,
    max: options.max ?? 10,
    ...(options.ssl ? { ssl: { rejectUnauthorized: true } } : {}),
  })
  return {
    async query<T>(sql: string, params: readonly unknown[] = []): Promise<T[]> {
      const result = await pool.query(sql, [...params])
      return result.rows as T[]
    },
    async exec(sql: string): Promise<void> {
      await pool.query(sql)
    },
    async transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T> {
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        const value = await fn({
          async query<R>(sql: string, params: readonly unknown[] = []): Promise<R[]> {
            return (await client.query(sql, [...params])).rows as R[]
          },
        })
        await client.query('COMMIT')
        return value
      } catch (error) {
        await client.query('ROLLBACK')
        throw error
      } finally {
        client.release()
      }
    },
    async close(): Promise<void> {
      await pool.end()
    },
    dialect: () => new PostgresDialect({ pool }),
  }
}
