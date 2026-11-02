import Fastify, { type FastifyInstance } from 'fastify'
import { WORK_ITEM_KINDS } from '@wm/shared'

export function buildApp(): FastifyInstance {
  const app = Fastify({ logger: process.env['NODE_ENV'] !== 'test' })

  app.get('/health', async () => ({ status: 'ok' }))

  // Placeholder route so web and mobile clients have something real to call.
  app.get('/meta/work-item-kinds', async () => ({ kinds: WORK_ITEM_KINDS }))

  return app
}
