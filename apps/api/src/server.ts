import { mkdirSync } from 'node:fs'
import { buildApp } from './app.js'
import { createPgliteDb, type Db } from './db/db.js'
import { createPgDb } from './db/pg.js'
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
    if (!process.env['DATABASE_URL']) {
      throw new Error('Production needs DATABASE_URL (the RDS database). Refusing to start.')
    }
  }
  // DATABASE_URL points at a real PostgreSQL (RDS on AWS). Without it, the embedded PGlite
  // database keeps local data in WM_DATA_DIR.
  const databaseUrl = process.env['DATABASE_URL']
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
  })
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
