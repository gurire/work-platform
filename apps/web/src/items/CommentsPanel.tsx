import { useEffect, useRef, useState } from 'react'
import { commentSegments, mentionToken, MAX_COMMENT_LENGTH, type WorkItem } from '@wm/shared'
import type { Api, ApiUser, Comments, CommentView } from './api'
import { timeAgo } from './item-model'
import type { ItemStore } from './store'

interface Props {
  api: Api
  store: ItemStore
  item: WorkItem
  users: readonly ApiUser[]
}

const message = (error: unknown) =>
  error instanceof Error ? error.message : 'something went wrong'

/** The @word being typed just before the caret, if any. */
function mentionQuery(text: string, caret: number): { start: number; query: string } | null {
  const match = /(^|\s)@([^\s@[\]()]{0,30})$/.exec(text.slice(0, caret))
  if (!match) return null
  return { start: caret - (match[2]?.length ?? 0) - 1, query: (match[2] ?? '').toLowerCase() }
}

function Body({ text }: { text: string }) {
  return (
    <p className="comment-body">
      {commentSegments(text).map((segment, index) =>
        segment.kind === 'mention' ? (
          <span key={index} className="mention">
            @{segment.name}
          </span>
        ) : (
          <span key={index}>{segment.text}</span>
        ),
      )}
    </p>
  )
}

/** A text box with @-mention picking. Ctrl+Enter sends. */
function Composer({
  users,
  initial,
  busy,
  submitLabel,
  showInternal,
  onSubmit,
  onCancel,
}: {
  users: readonly ApiUser[]
  initial: string
  busy: boolean
  submitLabel: string
  showInternal: boolean
  onSubmit: (body: string, internal: boolean) => Promise<boolean>
  onCancel?: () => void
}) {
  const [text, setText] = useState(initial)
  const [internal, setInternal] = useState(false)
  const [picker, setPicker] = useState<{ start: number; query: string } | null>(null)
  const [active, setActive] = useState(0)
  const box = useRef<HTMLTextAreaElement>(null)
  const matches = picker
    ? users.filter((u) => u.name.toLowerCase().includes(picker.query)).slice(0, 6)
    : []

  function pick(user: ApiUser) {
    if (!picker || !box.current) return
    const caret = box.current.selectionStart
    const token = `${mentionToken(user.name, user.id)} `
    const next = text.slice(0, picker.start) + token + text.slice(caret)
    setText(next)
    setPicker(null)
    const position = picker.start + token.length
    requestAnimationFrame(() => {
      box.current?.focus()
      box.current?.setSelectionRange(position, position)
    })
  }

  async function submit() {
    if (text.trim() === '' || busy) return
    if (await onSubmit(text, internal)) {
      setText('')
      setInternal(false)
    }
  }

  return (
    <div className="composer">
      <textarea
        ref={box}
        rows={3}
        maxLength={MAX_COMMENT_LENGTH}
        value={text}
        placeholder="Write a comment. Type @ to mention someone."
        aria-label="Comment"
        onChange={(event) => {
          setText(event.target.value)
          setPicker(mentionQuery(event.target.value, event.target.selectionStart))
          setActive(0)
        }}
        onKeyDown={(event) => {
          if (picker && matches.length > 0) {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault()
              const step = event.key === 'ArrowDown' ? 1 : -1
              setActive((i) => (i + step + matches.length) % matches.length)
              return
            }
            if (event.key === 'Enter' || event.key === 'Tab') {
              event.preventDefault()
              const user = matches[active]
              if (user) pick(user)
              return
            }
            if (event.key === 'Escape') {
              event.stopPropagation()
              setPicker(null)
              return
            }
          }
          if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
            event.preventDefault()
            void submit()
          }
        }}
      />
      {picker && matches.length > 0 && (
        <ul className="mention-picker" role="listbox" aria-label="Mention someone">
          {matches.map((u, index) => (
            <li key={u.id} role="option" aria-selected={index === active}>
              <button
                type="button"
                className={index === active ? 'mention-option active' : 'mention-option'}
                onMouseDown={(event) => {
                  event.preventDefault()
                  pick(u)
                }}
              >
                {u.name}
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="move-row">
        <button
          type="button"
          className="button button-primary"
          disabled={busy || text.trim() === ''}
          onClick={() => void submit()}
        >
          {submitLabel} <kbd>Ctrl Enter</kbd>
        </button>
        {onCancel && (
          <button type="button" className="button" onClick={onCancel}>
            Cancel
          </button>
        )}
        {showInternal && (
          <label className="muted internal-toggle">
            <input
              type="checkbox"
              checked={internal}
              onChange={(event) => setInternal(event.target.checked)}
            />{' '}
            Internal note (never shown to clients)
          </label>
        )}
      </div>
    </div>
  )
}

/** Comments on one item (specs/comments.md). */
export function CommentsPanel({ api, store, item, users }: Props) {
  const [data, setData] = useState<Comments | null>(null)
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    api.comments(item.id).then(
      (next) => {
        if (!cancelled) setData(next)
      },
      (error: unknown) => {
        if (!cancelled) store.toast(`Could not load comments: ${message(error)}.`)
      },
    )
    return () => {
      cancelled = true
    }
  }, [api, store, item.id])

  if (!data) return null
  const nameOf = (id: string | null) => (id ? (users.find((u) => u.id === id)?.name ?? id) : '')

  async function run(action: () => Promise<Comments>): Promise<boolean> {
    setBusy(true)
    try {
      const next = await action()
      setData(next)
      if (next.notNotified && next.notNotified.length > 0) {
        store.toast(
          `Not notified: ${next.notNotified.map((p) => p.name).join(', ')} cannot see this item.`,
        )
      }
      return true
    } catch (error) {
      store.toast(`${item.key}: ${message(error)}.`)
      return false
    } finally {
      setBusy(false)
    }
  }

  const visible = data.comments
  return (
    <section className="panel" aria-labelledby="comments-title">
      <div className="panel-head">
        <h2 id="comments-title">Comments</h2>
        <span className="muted">{visible.filter((c) => !c.deletedAt).length}</span>
      </div>
      <ol className="comment-list">
        {visible.map((c: CommentView) => (
          <li key={c.id} className={c.internal ? 'comment comment-internal' : 'comment'}>
            <div className="comment-head">
              <strong>{nameOf(c.authorId)}</strong>
              <span className="muted">
                {timeAgo(c.createdAt)}
                {c.editedAt ? ' · edited' : ''}
              </span>
              {c.internal && <span className="badge">Internal note</span>}
              <span className="comment-actions">
                {c.canEdit && editing !== c.id && (
                  <button type="button" className="link-button" onClick={() => setEditing(c.id)}>
                    Edit
                  </button>
                )}
                {c.canDelete && (
                  <button
                    type="button"
                    className="link-button"
                    disabled={busy}
                    onClick={() => void run(() => api.deleteComment(c.id))}
                  >
                    Delete
                  </button>
                )}
              </span>
            </div>
            {c.deletedAt ? (
              <p className="muted comment-body">
                Comment deleted
                {c.deletedBy && c.deletedBy !== c.authorId ? ` by ${nameOf(c.deletedBy)}` : ''}.
              </p>
            ) : editing === c.id ? (
              <Composer
                users={users}
                initial={c.body ?? ''}
                busy={busy}
                submitLabel="Save"
                showInternal={false}
                onCancel={() => setEditing(null)}
                onSubmit={async (body) => {
                  const ok = await run(() => api.editComment(c.id, body))
                  if (ok) setEditing(null)
                  return ok
                }}
              />
            ) : (
              <Body text={c.body ?? ''} />
            )}
          </li>
        ))}
        {visible.length === 0 && <li className="muted">No comments yet.</li>}
      </ol>
      {data.canComment ? (
        <Composer
          users={users}
          initial=""
          busy={busy}
          submitLabel="Comment"
          showInternal
          onSubmit={(body, internal) => run(() => api.addComment(item.id, body, internal))}
        />
      ) : (
        <p className="muted">You can read comments here but not add them.</p>
      )}
    </section>
  )
}
