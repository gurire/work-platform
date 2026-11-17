/**
 * Comment text and mentions. Implements specs/comments.md, sections 2 and 3. Comments are
 * plain text; a mention is written as @[Name](user-id) so it names exactly one person.
 */

export const MAX_COMMENT_LENGTH = 10_000
export const MAX_MENTIONS = 20

const MENTION = /@\[([^\]\n]{1,80})\]\(([A-Za-z0-9_-]{1,64})\)/g

export type CommentSegment =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'mention'; readonly name: string; readonly userId: string }

/** The people a comment mentions, each once, in order (rule 3.1). */
export function parseMentions(body: string): string[] {
  const ids = new Set<string>()
  for (const match of body.matchAll(MENTION)) {
    if (match[2]) ids.add(match[2])
    if (ids.size >= MAX_MENTIONS) break
  }
  return [...ids]
}

/** Splits a comment into text and mentions for display; nothing is ever run as markup. */
export function commentSegments(body: string): CommentSegment[] {
  const segments: CommentSegment[] = []
  let last = 0
  for (const match of body.matchAll(MENTION)) {
    const index = match.index ?? 0
    if (index > last) segments.push({ kind: 'text', text: body.slice(last, index) })
    segments.push({ kind: 'mention', name: match[1] ?? '', userId: match[2] ?? '' })
    last = index + match[0].length
  }
  if (last < body.length) segments.push({ kind: 'text', text: body.slice(last) })
  return segments
}

/** How a mention is written into a comment when picked from the list. */
export function mentionToken(name: string, userId: string): string {
  return `@[${name.replace(/[[\]\n]/g, '').slice(0, 80)}](${userId})`
}

export const INBOX_KINDS = [
  'mentioned',
  'assigned',
  'review_requested',
  'review_approved',
  'review_changes_requested',
  'commented',
] as const
export type InboxKind = (typeof INBOX_KINDS)[number]
