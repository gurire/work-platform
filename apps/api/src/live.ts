/**
 * Live updates (WP-BRIEF-002, Updates): after any change, every open page is told to refresh.
 * Messages carry no item data, so nothing private can leak through them; each page reloads
 * through the normal API, which applies the permission layer.
 */
import websocket from '@fastify/websocket'
import type { FastifyInstance } from 'fastify'
import type { Db } from './db/db.js'
import { resolvePrincipal } from './principal.js'

interface Client {
  userId: string
  send: (data: string) => void
}

export function registerLive(
  app: FastifyInstance,
  { db, devAuth }: { db: Db; devAuth: boolean },
): void {
  const clients = new Set<Client>()
  let pending: ReturnType<typeof setTimeout> | null = null
  const broadcast = () => {
    // Many changes in a burst become one message.
    if (pending) return
    pending = setTimeout(() => {
      pending = null
      const message = JSON.stringify({ type: 'changed', at: Date.now() })
      for (const client of clients) client.send(message)
    }, 150)
  }

  void app.register(websocket)
  void app.register(async (scope) => {
    scope.get<{ Querystring: { user?: string; token?: string } }>(
      '/live',
      { websocket: true },
      async (socket, request) => {
        // Development sign-in names the user in the address; Cognito tokens are checked by auth.ts.
        if (!request.authUserId && devAuth && typeof request.query.user === 'string') {
          request.headers['x-dev-user'] = request.query.user
        }
        const principal = await resolvePrincipal(db, request, devAuth)
        if (!principal) {
          socket.close(4401, 'unauthenticated')
          return
        }
        const client: Client = {
          userId: principal.id,
          send: (data) => socket.readyState === 1 && socket.send(data),
        }
        clients.add(client)
        socket.send(JSON.stringify({ type: 'hello' }))
        socket.on('close', () => clients.delete(client))
      },
    )
  })

  app.addHook('onResponse', async (request, reply) => {
    if (request.method === 'GET' || request.method === 'HEAD' || request.method === 'OPTIONS')
      return
    if (reply.statusCode >= 200 && reply.statusCode < 300) broadcast()
  })
}
