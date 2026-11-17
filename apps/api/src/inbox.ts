/**
 * Inbox entries (specs/comments.md, section 4). Entries are written here and filtered by the
 * permission layer when read, so an entry never shows an item its owner cannot see.
 */
import type { InboxKind } from '@wm/shared'
import type { Queryable } from './db/db.js'

export interface InboxEntry {
  readonly userId: string | null
  readonly kind: InboxKind
  readonly itemId: string
  readonly actorId: string | null
  readonly commentId?: string | null
}

/** Adds entries, never one about a person's own action (rule 4.2). */
export async function notify(db: Queryable, entries: readonly InboxEntry[]): Promise<void> {
  const seen = new Set<string>()
  for (const entry of entries) {
    if (!entry.userId || entry.userId === entry.actorId) continue
    const key = `${entry.userId}:${entry.kind}`
    if (seen.has(key)) continue
    seen.add(key)
    await db.query(
      'INSERT INTO inbox (user_id, kind, item_id, actor_id, comment_id) VALUES ($1, $2, $3, $4, $5)',
      [entry.userId, entry.kind, entry.itemId, entry.actorId, entry.commentId ?? null],
    )
  }
}
