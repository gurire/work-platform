import Fastify, { type FastifyInstance } from 'fastify'
import { WORK_ITEM_KINDS } from '@wm/shared'
import type { Db } from './db/db.js'
import { registerAuth, type IdTokenVerifier } from './auth.js'
import { registerItemRoutes } from './routes/items.js'
import { registerReviewRoutes } from './routes/reviews.js'
import { registerRecordRoutes } from './routes/records.js'
import { registerBoardRoutes } from './routes/board.js'
import { registerCodeRoutes } from './routes/code.js'
import { registerCommentRoutes } from './routes/comments.js'
import { registerDashboardRoutes } from './routes/dashboards.js'
import { registerPeopleRoutes } from './routes/people.js'

export interface AppOptions {
  /** Without a database only the health and meta routes exist. */
  db?: Db
  /** Development-only header sign-in. See principal.ts. Never enable in production. */
  devAuth?: boolean
  /** Shared secret for signed code host events. Without it the webhook is off. */
  codeWebhookSecret?: string
  /** Checks Cognito ID tokens (specs/sign-in.md). Without it, only development sign-in works. */
  verifyIdToken?: IdTokenVerifier
}

export function buildApp(options: AppOptions = {}): FastifyInstance {
  const app = Fastify({
    logger: process.env['NODE_ENV'] !== 'test',
    // Reject unknown fields instead of silently dropping them (Fastify's default).
    ajv: { customOptions: { removeAdditional: false } },
  })

  app.get('/health', async () => ({ status: 'ok' }))

  // Placeholder route so web and mobile clients have something real to call.
  app.get('/meta/work-item-kinds', async () => ({ kinds: WORK_ITEM_KINDS }))

  if (options.db) {
    if (options.verifyIdToken) registerAuth(app, options.db, options.verifyIdToken)
    registerItemRoutes(app, { db: options.db, devAuth: options.devAuth === true })
    registerReviewRoutes(app, { db: options.db, devAuth: options.devAuth === true })
    registerRecordRoutes(app, { db: options.db, devAuth: options.devAuth === true })
    registerBoardRoutes(app, { db: options.db, devAuth: options.devAuth === true })
    registerCommentRoutes(app, { db: options.db, devAuth: options.devAuth === true })
    registerDashboardRoutes(app, { db: options.db, devAuth: options.devAuth === true })
    registerPeopleRoutes(app, { db: options.db, devAuth: options.devAuth === true })
    registerCodeRoutes(app, {
      db: options.db,
      devAuth: options.devAuth === true,
      webhookSecret: options.codeWebhookSecret,
    })
  }

  return app
}
