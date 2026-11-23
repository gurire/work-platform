import type { PGlite } from '@electric-sql/pglite'
import {
  CompiledQuery,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  type DatabaseConnection,
  type Dialect,
  type Driver,
  type Kysely,
  type QueryResult,
} from 'kysely'

/**
 * Lets Kysely run on PGlite (local development and tests). PGlite has one connection, so
 * Kysely's connections are handed out one at a time; a transaction holds it until it ends.
 */
export class PgliteDialect implements Dialect {
  constructor(private readonly pg: PGlite) {}
  createAdapter() {
    return new PostgresAdapter()
  }
  createDriver(): Driver {
    return new PgliteDriver(this.pg)
  }
  createIntrospector(db: Kysely<unknown>) {
    return new PostgresIntrospector(db)
  }
  createQueryCompiler() {
    return new PostgresQueryCompiler()
  }
}

class PgliteConnection implements DatabaseConnection {
  constructor(
    private readonly pg: PGlite,
    readonly release: () => void,
  ) {}

  async executeQuery<R>(query: CompiledQuery): Promise<QueryResult<R>> {
    const result = await this.pg.query<R>(query.sql, [...query.parameters])
    return result.affectedRows !== undefined && result.rows.length === 0
      ? { rows: result.rows, numAffectedRows: BigInt(result.affectedRows) }
      : { rows: result.rows }
  }

  // eslint-disable-next-line require-yield
  async *streamQuery<R>(): AsyncIterableIterator<QueryResult<R>> {
    throw new Error('Streaming queries are not supported on PGlite')
  }
}

class PgliteDriver implements Driver {
  private queue: Promise<void> = Promise.resolve()

  constructor(private readonly pg: PGlite) {}

  async init(): Promise<void> {}

  async acquireConnection(): Promise<DatabaseConnection> {
    let release!: () => void
    const turn = new Promise<void>((resolve) => (release = resolve))
    const previous = this.queue
    this.queue = previous.then(() => turn)
    await previous
    return new PgliteConnection(this.pg, release)
  }

  async beginTransaction(connection: DatabaseConnection): Promise<void> {
    await connection.executeQuery(CompiledQuery.raw('BEGIN'))
  }

  async commitTransaction(connection: DatabaseConnection): Promise<void> {
    await connection.executeQuery(CompiledQuery.raw('COMMIT'))
  }

  async rollbackTransaction(connection: DatabaseConnection): Promise<void> {
    await connection.executeQuery(CompiledQuery.raw('ROLLBACK'))
  }

  async releaseConnection(connection: DatabaseConnection): Promise<void> {
    ;(connection as PgliteConnection).release()
  }

  async destroy(): Promise<void> {}
}
