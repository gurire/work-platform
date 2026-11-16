import { mkdirSync } from 'node:fs'
import { buildApp } from './app.js'
import { createPgliteDb } from './db/db.js'
import { migrate } from './db/migrations.js'
import { seedDevData } from './db/seed.js'

const port = Number(process.env['PORT'] ?? 3000)
const host = process.env['HOST'] ?? '127.0.0.1'
const isProduction = process.env['NODE_ENV'] === 'production'
/** Development only; matches scripts/code-event.mjs. */
const DEV_CODE_WEBHOOK_SECRET = 'dev-only-code-webhook-secret'

async function main(): Promise<void> {
  if (isProduction) {
    // The local embedded database and header sign-in are for development only.
    throw new Error('Production database and sign-in are not built yet. Refusing to start.')
  }
  const dataDir = process.env['WM_DATA_DIR'] ?? '.data/pglite'
  mkdirSync(dataDir, { recursive: true })
  const db = await createPgliteDb(dataDir)
  const applied = await migrate(db)
  await seedDevData(db)

  // Signed code events (specs/code-status.md). Locally a fixed development secret is used so
  // `pnpm code-event` works; a real deployment must set its own and never this one.
  const codeWebhookSecret = process.env['WM_CODE_WEBHOOK_SECRET'] ?? DEV_CODE_WEBHOOK_SECRET
  const app = buildApp({ db, devAuth: true, codeWebhookSecret })
  if (applied.length > 0) app.log.info({ applied }, 'migrations applied')
  app.log.warn('Development sign-in is ON: callers choose their user with the x-dev-user header.')
  await app.listen({ port, host })
}

main().catch((err: unknown) => {
  console.error(err)
  process.exit(1)
})
