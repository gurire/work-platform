import { mkdirSync } from 'node:fs'
import { buildApp } from './app.js'
import { createPgliteDb, type Db } from './db/db.js'
import { createPgDb } from './db/pg.js'
import { diskFileStore, s3FileStore } from './files.js'
import { runDueSchedules } from './runs.js'
import { migrate } from './db/migrations.js'
import { seedDevData } from './db/seed.js'
import { cognitoVerifier } from './cognito.js'

const port = Number(process.env['PORT'] ?? 3000)
const host = process.env['HOST'] ?? '127.0.0.1'
const isProduction = process.env['NODE_ENV'] === 'production'
/** Development only; matches scripts/code-event.mjs. */
const DEV_CODE_WEBHOOK_SECRET = 'dev-only-code-webhook-secret'

async function main(): Promise<void> {
  // Cognito sign-in (specs/sign-in.md): on when both settings are given.
  const userPoolId = process.env['COGNITO_USER_POOL_ID']
  const clientId = process.env['COGNITO_CLIENT_ID']
  const verifyIdToken = userPoolId && clientId ? cognitoVerifier(userPoolId, clientId) : undefined
  if (isProduction) {
    if (!verifyIdToken) {
      throw new Error(
        'Production needs COGNITO_USER_POOL_ID and COGNITO_CLIENT_ID. Refusing to start.',
      )
    }
    // The local embedded database is for development only.
    if (!process.env['DATABASE_URL'] && !process.env['DATABASE_HOST']) {
      throw new Error('Production needs DATABASE_URL (the RDS database). Refusing to start.')
    }
  }
  // DATABASE_URL points at a real PostgreSQL (RDS on AWS). Without it, the embedded PGlite
  // database keeps local data in WM_DATA_DIR.
  // On AWS the database address and its secret arrive as separate settings (infra HostingStack).
  const dbHost = process.env['DATABASE_HOST']
  const databaseUrl =
    process.env['DATABASE_URL'] ??
    (dbHost
      ? `postgres://${encodeURIComponent(process.env['DATABASE_USER'] ?? '')}:${encodeURIComponent(process.env['DATABASE_PASSWORD'] ?? '')}@${dbHost}:${process.env['DATABASE_PORT'] ?? '5432'}/${process.env['DATABASE_NAME'] ?? 'workplatform'}`
      : undefined)
  let db: Db
  if (databaseUrl) {
    db = createPgDb(databaseUrl, { ssl: process.env['DATABASE_SSL'] !== 'off' })
  } else {
    const dataDir = process.env['WM_DATA_DIR'] ?? '.data/pglite'
    mkdirSync(dataDir, { recursive: true })
    db = await createPgliteDb(dataDir)
  }
  const applied = await migrate(db)
  // Sample data is for development only; a real database never gets it.
  if (!isProduction) await seedDevData(db)

  // Signed code events (specs/code-status.md). Locally a fixed development secret is used so
  // `pnpm code-event` works; a real deployment must set its own and never this one.
  const codeWebhookSecret = process.env['WM_CODE_WEBHOOK_SECRET'] ?? DEV_CODE_WEBHOOK_SECRET
  // Development sign-in only when there is no Cognito (section 4).
  const devAuth = !verifyIdToken
  const app = buildApp({
    db,
    devAuth,
    codeWebhookSecret,
    ...(verifyIdToken ? { verifyIdToken } : {}),
    files: process.env['WM_FILES_BUCKET']
      ? await s3FileStore(process.env['WM_FILES_BUCKET'])
      : diskFileStore(process.env['WM_FILES_DIR'] ?? '.data/files'),
  })
  // Recurring runs: check for due schedules every minute.
  const tick = () =>
    void runDueSchedules(db).then(
      (r) => r.started + r.blocked > 0 && app.log.info(r, 'recurring runs'),
      (error: unknown) => app.log.error({ error }, 'recurring runs failed'),
    )
  setInterval(tick, 60_000).unref()
  tick()
  if (applied.length > 0) app.log.info({ applied }, 'migrations applied')
  if (devAuth) {
    app.log.warn('Development sign-in is ON: callers choose their user with the x-dev-user header.')
  } else {
    app.log.info({ userPoolId }, 'Cognito sign-in is ON')
  }
  await app.listen({ port, host })
}

main().catch((err: unknown) => {
  console.error(err)
  process.exit(1)
})
