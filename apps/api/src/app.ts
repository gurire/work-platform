import Fastify, { type FastifyInstance } from 'fastify'
import { WORK_ITEM_KINDS } from '@wm/shared'
import type { Db } from './db/db.js'
import { registerItemRoutes } from './routes/items.js'
import { registerReviewRoutes } from './routes/reviews.js'

export interface AppOptions {
  /** Without a database only the health and meta routes exist. */
  db?: Db
  /** Development-only header sign-in. See principal.ts. Never enable in production. */
  devAuth?: boolean
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
    registerItemRoutes(app, { db: options.db, devAuth: options.devAuth === true })
    registerReviewRoutes(app, { db: options.db, devAuth: options.devAuth === true })
  }

  return app
}
