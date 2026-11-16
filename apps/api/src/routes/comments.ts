/**
 * Comments, mentions and the inbox (specs/comments.md). Reading comments is `item.view`;
 * adding, editing and deleting follow the comment rows of the permission matrix.
 */
import type { FastifyInstance } from 'fastify'
import {
  decide,
  MAX_COMMENT_LENGTH,
  parseMentions,
  type InboxKind,
  type UserPrincipal,
} from '@wm/shared'
import type { Db } from '../db/db.js'
import { notify } from '../inbox.js'
import { loadUserPrincipal, resolvePrincipal } from '../principal.js'
import { audit, iso, loadVisibleItemIn, targetOf, type ItemRow } from './items.js'

interface CommentRow {
  id: string
  item_id: string
  author_id: string
  body: string
  internal: boolean
  created_at: Date | string
  edited_at: Date | string | null
  deleted_at: Date | string | null
  deleted_by: string | null
}

const COMMENT_COLUMNS =
  'id, item_id, author_id, body, internal, created_at, edited_at, deleted_at, deleted_by'

const bodySchema = { type: 'string', minLength: 1, maxLength: MAX_COMMENT_LENGTH } as const
const idParams = {
  type: 'object',
  properties: { id: { type: 'string', pattern: '^[0-9]{1,18}$' } },
  required: ['id'],
} as const

export function registerCommentRoutes(
  app: FastifyInstance,
  { db, devAuth }: { db: Db; devAuth: boolean },
): void {
  async function commentsPayload(principal: UserPrincipal, row: ItemRow) {
    const target = targetOf(row)
    const rows = await db.query<CommentRow>(
      `SELECT ${COMMENT_COLUMNS} FROM comments WHERE item_id = $1 ORDER BY id`,
      [row.id],
    )
    const canDeleteAny = decide(principal, 'comment.deleteAny', target).allowed
    return {
      canComment: decide(principal, 'comment.add', target).allowed,
      comments: rows.map((c) => {
        const own = decide(principal, 'comment.editOwn', {
          ...target,
          createdBy: c.author_id,
        }).allowed
        const deleted = c.deleted_at !== null
        return {
          id: String(c.id),
          authorId: c.author_id,
          // A deleted comment's text is kept for the audit trail but never sent (rule 2.4).
          body: deleted ? null : c.body,
          internal: c.internal,
          createdAt: iso(c.created_at),
          editedAt: c.edited_at ? iso(c.edited_at) : null,
          deletedAt: c.deleted_at ? iso(c.deleted_at) : null,
          deletedBy: c.deleted_by,
          canEdit: !deleted && own,
          canDelete: !deleted && (own || canDeleteAny),
        }
      }),
    }
  }

  /** Mentioned people who can see the item get an inbox entry; the rest are reported back. */
  async function mentionEntries(
    row: ItemRow,
    ids: readonly string[],
    actorId: string,
    commentId: string,
  ) {
    const target = targetOf(row)
    const notified: string[] = []
    const notNotified: { id: string; name: string }[] = []
    for (const id of ids) {
      if (id === actorId) continue
      const who = await loadUserPrincipal(db, id)
      if (who && decide(who, 'item.view', target).allowed) {
        notified.push(id)
      } else {
        const names = await db.query<{ name: string }>('SELECT name FROM users WHERE id = $1', [id])
        notNotified.push({ id, name: names[0]?.name ?? id })
      }
    }
    const entries = notified.map((userId) => ({
      userId,
      kind: 'mentioned' as InboxKind,
      itemId: row.id,
      actorId,
      commentId,
    }))
    return { entries, notified, notNotified }
  }

  async function loadComment(principal: UserPrincipal, id: string) {
    const rows = await db.query<CommentRow>(
      `SELECT ${COMMENT_COLUMNS} FROM comments WHERE id = $1`,
      [id],
    )
    const comment = rows[0]
    if (!comment) return null
    const row = await loadVisibleItemIn(db, principal, comment.item_id)
    return row ? { comment, row } : null
  }

  app.get<{ Params: { id: string } }>('/items/:id/comments', async (request, reply) => {
    const principal = await resolvePrincipal(db, request, devAuth)
    if (!principal) return reply.code(401).send({ error: 'unauthenticated' })
    const row = await loadVisibleItemIn(db, principal, request.params.id)
    if (!row) return reply.code(404).send({ error: 'not_found' })
    return commentsPayload(principal, row)
  })

  app.post<{ Params: { id: string }; Body: { body: string; internal?: boolean } }>(
    '/items/:id/comments',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['body'],
          properties: { body: bodySchema, internal: { type: 'boolean' } },
        },
      },
    },
    async (request, reply) => {
      const principal = await resolvePrincipal(db, request, devAuth)
      if (!principal) return reply.code(401).send({ error: 'unauthenticated' })
      const row = await loadVisibleItemIn(db, principal, request.params.id)
      if (!row) return reply.code(404).send({ error: 'not_found' })
      if (!decide(principal, 'comment.add', targetOf(row)).allowed) {
        return reply.code(403).send({ error: 'forbidden' })
      }
      const body = request.body.body.trim()
      if (body === '') return reply.code(400).send({ error: 'empty_comment' })
      const inserted = await db.query<{ id: string }>(
        'INSERT INTO comments (item_id, author_id, body, internal) VALUES ($1, $2, $3, $4) RETURNING id',
        [row.id, principal.id, body, request.body.internal === true],
      )
      const commentId = String(inserted[0]?.id)
      const mentions = await mentionEntries(row, parseMentions(body), principal.id, commentId)
      // The owner hears about comments on their item, unless already mentioned (rule 4.1).
      const owner =
        row.assignee_id && !mentions.notified.includes(row.assignee_id)
          ? [
              {
                userId: row.assignee_id,
                kind: 'commented' as InboxKind,
                itemId: row.id,
                actorId: principal.id,
                commentId,
              },
            ]
          : []
      await notify(db, [...mentions.entries, ...owner])
      return { ...(await commentsPayload(principal, row)), notNotified: mentions.notNotified }
    },
  )

  /** Edit your own comment; earlier versions are kept (rule 2.3, rule 3.3). */
  app.patch<{ Params: { id: string }; Body: { body: string } }>(
    '/comments/:id',
    {
      schema: {
        params: idParams,
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['body'],
          properties: { body: bodySchema },
        },
      },
    },
    async (request, reply) => {
      const principal = await resolvePrincipal(db, request, devAuth)
      if (!principal) return reply.code(401).send({ error: 'unauthenticated' })
      const found = await loadComment(principal, request.params.id)
      if (!found) return reply.code(404).send({ error: 'not_found' })
      const { comment, row } = found
      const target = { ...targetOf(row), createdBy: comment.author_id }
      if (!decide(principal, 'comment.editOwn', target).allowed) {
        return reply.code(403).send({ error: 'forbidden' })
      }
      if (comment.deleted_at !== null) return reply.code(409).send({ error: 'deleted' })
      const body = request.body.body.trim()
      if (body === '') return reply.code(400).send({ error: 'empty_comment' })
      if (body !== comment.body) {
        await db.transaction(async (tx) => {
          await tx.query(
            'INSERT INTO comment_versions (comment_id, body, replaced_by) VALUES ($1, $2, $3)',
            [comment.id, comment.body, principal.id],
          )
          await tx.query('UPDATE comments SET body = $2, edited_at = now() WHERE id = $1', [
            comment.id,
            body,
          ])
        })
      }
      const before = new Set(parseMentions(comment.body))
      const added = parseMentions(body).filter((id) => !before.has(id))
      const mentions = await mentionEntries(row, added, principal.id, String(comment.id))
      await notify(db, mentions.entries)
      return { ...(await commentsPayload(principal, row)), notNotified: mentions.notNotified }
    },
  )

  /** Delete your own comment, or anyone's as a team admin (audited) (rule 2.4). */
  app.delete<{ Params: { id: string } }>(
    '/comments/:id',
    { schema: { params: idParams } },
    async (request, reply) => {
      const principal = await resolvePrincipal(db, request, devAuth)
      if (!principal) return reply.code(401).send({ error: 'unauthenticated' })
      const found = await loadComment(principal, request.params.id)
      if (!found) return reply.code(404).send({ error: 'not_found' })
      const { comment, row } = found
      const target = targetOf(row)
      const own = decide(principal, 'comment.editOwn', {
        ...target,
        createdBy: comment.author_id,
      }).allowed
      const any = decide(principal, 'comment.deleteAny', target).allowed
      if (!own && !any) return reply.code(403).send({ error: 'forbidden' })
      if (comment.deleted_at !== null) return reply.code(409).send({ error: 'deleted' })
      await db.transaction(async (tx) => {
        await tx.query(
          'INSERT INTO comment_versions (comment_id, body, replaced_by) VALUES ($1, $2, $3)',
          [comment.id, comment.body, principal.id],
        )
        await tx.query('UPDATE comments SET deleted_at = now(), deleted_by = $2 WHERE id = $1', [
          comment.id,
          principal.id,
        ])
      })
      if (!own) {
        await audit(db, principal, 'comment.deleteAny', row.team_id, row.id, {
          commentId: String(comment.id),
          author: comment.author_id,
        })
      }
      return commentsPayload(principal, row)
    },
  )

  /** Your inbox, newest first, only for items you can still see (rules 4.3 and 4.5). */
  app.get<{ Querystring: { unread?: boolean } }>(
    '/inbox',
    {
      schema: {
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: { unread: { type: 'boolean' } },
        },
      },
    },
    async (request, reply) => {
      const principal = await resolvePrincipal(db, request, devAuth)
      if (!principal) return reply.code(401).send({ error: 'unauthenticated' })
      const rows = await db.query<{
        id: string
        kind: InboxKind
        item_id: string
        item_key: string
        item_title: string
        team_id: string
        is_private: boolean
        actor_id: string | null
        comment_id: string | null
        comment_body: string | null
        comment_deleted: boolean | null
        created_at: Date | string
        read_at: Date | string | null
      }>(
        `SELECT n.id, n.kind, n.item_id, w.key AS item_key, w.title AS item_title, w.team_id,
           t.is_private, n.actor_id, n.comment_id, c.body AS comment_body,
           (c.deleted_at IS NOT NULL) AS comment_deleted, n.created_at, n.read_at
         FROM inbox n
         JOIN work_items w ON w.id = n.item_id
         JOIN teams t ON t.id = w.team_id
         LEFT JOIN comments c ON c.id = n.comment_id
         WHERE n.user_id = $1 AND w.deleted_at IS NULL ${request.query.unread ? 'AND n.read_at IS NULL' : ''}
         ORDER BY n.id DESC LIMIT 300`,
        [principal.id],
      )
      const visible = rows.filter(
        (r) =>
          decide(principal, 'item.view', { team: { id: r.team_id, isPrivate: r.is_private } })
            .allowed,
      )
      return {
        unread: visible.filter((r) => r.read_at === null).length,
        entries: visible.slice(0, 100).map((r) => ({
          id: String(r.id),
          kind: r.kind,
          itemId: r.item_id,
          itemKey: r.item_key,
          itemTitle: r.item_title,
          actorId: r.actor_id,
          excerpt: r.comment_body && !r.comment_deleted ? r.comment_body.slice(0, 200) : null,
          createdAt: iso(r.created_at),
          read: r.read_at !== null,
        })),
      }
    },
  )

  /** Mark entries read: the given ones, or all of them (rule 4.4). Only your own. */
  app.post<{ Body: { ids?: string[] } }>(
    '/inbox/read',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          properties: {
            ids: {
              type: 'array',
              maxItems: 200,
              items: { type: 'string', pattern: '^[0-9]{1,18}$' },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const principal = await resolvePrincipal(db, request, devAuth)
      if (!principal) return reply.code(401).send({ error: 'unauthenticated' })
      const ids = request.body.ids
      if (ids) {
        await db.query(
          'UPDATE inbox SET read_at = now() WHERE user_id = $1 AND read_at IS NULL AND id = ANY($2::bigint[])',
          [principal.id, ids],
        )
      } else {
        await db.query('UPDATE inbox SET read_at = now() WHERE user_id = $1 AND read_at IS NULL', [
          principal.id,
        ])
      }
      return { ok: true }
    },
  )
}
