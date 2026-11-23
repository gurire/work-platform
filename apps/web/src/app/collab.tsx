import { Paperclip, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { commentSegments, describeRule, type ScheduleRule } from '@wm/shared'
import { Avatar, Button, EmptyState, IconButton, RunTag, StatusTag } from '../design/components'
import { workApi, type CoreItem, type CoreTeam } from './core-api'
import { nameOf, useAppData, useLoad } from './data'
import { shortDate } from './work'

const when = (iso: string) =>
  new Date(iso).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })

function useRun() {
  const [error, setError] = useState<string | null>(null)
  const run = async (fn: () => Promise<unknown>, after?: () => void) => {
    setError(null)
    try {
      await fn()
      after?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }
  return { error, run }
}

/* ---------- Description ---------- */

export function Description({ item, canEdit }: { item: CoreItem; canEdit: boolean }) {
  const loaded = useLoad(() => workApi.description(item.id), item.id)
  const { error, run } = useRun()
  if (loaded.data === null && !loaded.error) return null
  return (
    <section className="mx-stack" aria-label="Description">
      <h3 className="mx-h3">Description</h3>
      <textarea
        className="md-textarea"
        aria-label="Description"
        placeholder={
          canEdit ? 'What this item is about, and what done looks like' : 'No description'
        }
        defaultValue={loaded.data ?? ''}
        readOnly={!canEdit}
        onBlur={(e) => {
          const text = e.currentTarget.value
          if (text !== (loaded.data ?? ''))
            void run(() => workApi.setDescription(item.id, text), loaded.reload)
        }}
      />
      {error ? <span className="md-field-error">{error}</span> : null}
    </section>
  )
}

/* ---------- Comments with @mentions ---------- */

export function CommentsPanel({ itemId }: { itemId: string }) {
  const { people } = useAppData()
  const loaded = useLoad(() => workApi.comments(itemId), itemId)
  const [text, setText] = useState('')
  const [picking, setPicking] = useState<string | null>(null)
  const { error, run } = useRun()
  const data = loaded.data
  const matches =
    picking === null
      ? []
      : people.filter((p) => p.name.toLowerCase().includes(picking.toLowerCase())).slice(0, 6)

  const insertMention = (id: string, name: string) => {
    setText((t) => t.replace(/@([^\s@]*)$/, `@[${name}](${id}) `))
    setPicking(null)
  }

  return (
    <section className="mx-stack" aria-label="Comments">
      {data?.comments.length === 0 ? <p className="md-meta">No comments yet.</p> : null}
      {data?.comments.map((c) => (
        <div key={c.id} className="mx-comment">
          <Avatar name={nameOf(people, c.authorId)} size={32} />
          <div className="mx-grow">
            <span className="md-meta">
              <b className="mx-author">{nameOf(people, c.authorId)}</b> · {when(c.createdAt)}
              {c.editedAt ? ' · edited' : ''}
            </span>
            {c.body === null ? (
              <p className="md-meta">Comment deleted.</p>
            ) : (
              <p className="mx-comment-body">
                {commentSegments(c.body).map((s, i) =>
                  s.kind === 'mention' ? (
                    <span key={i} className="mx-mention">
                      @{s.name}
                    </span>
                  ) : (
                    <span key={i}>{s.text}</span>
                  ),
                )}
              </p>
            )}
          </div>
          {c.canDelete && c.body !== null ? (
            <IconButton
              label="Delete comment"
              small
              onClick={() => run(() => workApi.deleteComment(c.id), loaded.reload)}
            >
              <Trash2 size={14} />
            </IconButton>
          ) : null}
        </div>
      ))}
      {data?.canComment ? (
        <div className="mx-composer">
          <textarea
            className="md-textarea"
            aria-label="Write a comment"
            placeholder="Write a comment — type @ to mention someone"
            value={text}
            onChange={(e) => {
              setText(e.target.value)
              const m = /@([^\s@[\]]*)$/.exec(e.target.value)
              setPicking(m ? (m[1] ?? '') : null)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && text.trim()) {
                void run(
                  () => workApi.addComment(itemId, text.trim()),
                  () => {
                    setText('')
                    loaded.reload()
                  },
                )
              }
            }}
          />
          {matches.length > 0 ? (
            <div className="md-menu mx-mention-menu" role="listbox" aria-label="Mention someone">
              {matches.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  role="option"
                  aria-selected={false}
                  className="md-menu-item"
                  onClick={() => insertMention(p.id, p.name)}
                >
                  {p.name}
                </button>
              ))}
            </div>
          ) : null}
          <div className="mx-row mx-spread">
            <span className="md-meta">
              Ctrl + Enter to send. Mentioned people get an inbox notice.
            </span>
            <Button
              size="s"
              kind="primary"
              disabled={!text.trim()}
              onClick={() =>
                run(
                  () => workApi.addComment(itemId, text.trim()),
                  () => {
                    setText('')
                    loaded.reload()
                  },
                )
              }
            >
              Comment
            </Button>
          </div>
        </div>
      ) : null}
      {error ? <span className="md-field-error">{error}</span> : null}
    </section>
  )
}

/* ---------- Reviews ---------- */

export function ReviewPanel({
  item,
  team,
  onChanged,
}: {
  item: CoreItem
  team: CoreTeam | undefined
  onChanged: () => void
}) {
  const { people } = useAppData()
  const loaded = useLoad(() => workApi.reviews(item.id), `${item.id}:${item.stageKey}`)
  const [reviewers, setReviewers] = useState<string[]>([])
  const [note, setNote] = useState('')
  const { error, run } = useRun()
  const data = loaded.data
  if (!data) return null
  if (!data.reviewStage) {
    const reviewStages = team?.stages.filter((s) => s.type === 'review') ?? []
    return (
      <p className="md-meta">
        {reviewStages.length
          ? `Reviews happen in ${reviewStages.map((s) => s.name).join(' and ')}.`
          : 'This team has no review stage.'}
      </p>
    )
  }
  const open = data.rounds.find((r) => r.state === 'open')
  const after = () => {
    loaded.reload()
    onChanged()
  }
  return (
    <section className="mx-stack" aria-label="Review">
      {data.approved ? <p className="mx-ok">✓ Approved — the item can move on.</p> : null}
      {open ? (
        <>
          <span className="md-meta">
            Round {open.number}, asked {when(open.openedAt)}
          </span>
          {open.reviewers.map((r) => (
            <div key={r.userId} className="mx-review-row">
              <Avatar name={nameOf(people, r.userId)} size={24} />
              <span className="mx-grow">{nameOf(people, r.userId)}</span>
              <span
                className={
                  r.verdict === 'approved'
                    ? 'mx-ok'
                    : r.verdict === 'changes_requested'
                      ? 'md-field-error'
                      : 'md-meta'
                }
              >
                {r.verdict === 'approved'
                  ? '✓ Approved'
                  : r.verdict === 'changes_requested'
                    ? '↩ Changes asked'
                    : 'Waiting'}
              </span>
            </div>
          ))}
          {data.canVerdict ? (
            <div className="mx-stack">
              <textarea
                className="md-textarea"
                aria-label="Note for the verdict"
                placeholder="Note (needed when asking for changes)"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
              <div className="mx-row">
                <Button
                  kind="primary"
                  size="s"
                  onClick={() => run(() => workApi.verdict(open.id, 'approved', note), after)}
                >
                  Approve
                </Button>
                <Button
                  kind="danger"
                  size="s"
                  disabled={!note.trim()}
                  onClick={() =>
                    run(() => workApi.verdict(open.id, 'changes_requested', note), after)
                  }
                >
                  Send back
                </Button>
              </div>
            </div>
          ) : null}
        </>
      ) : data.canOpen ? (
        <div className="mx-stack">
          <span className="md-meta">Ask for a review</span>
          <div className="mx-row">
            {people.map((p) => (
              <label key={p.id} className="mx-check-pill">
                <input
                  type="checkbox"
                  className="md-check"
                  checked={reviewers.includes(p.id)}
                  onChange={(e) =>
                    setReviewers((r) =>
                      e.target.checked ? [...r, p.id] : r.filter((x) => x !== p.id),
                    )
                  }
                />
                {p.name}
              </label>
            ))}
          </div>
          <Button
            size="s"
            kind="primary"
            disabled={reviewers.length === 0}
            onClick={() => run(() => workApi.openReview(item.id, reviewers), after)}
          >
            Ask for review
          </Button>
        </div>
      ) : (
        <p className="md-meta">No review is open.</p>
      )}
      {data.rounds.filter((r) => r.state !== 'open').length > 0 ? (
        <span className="md-meta">
          Earlier rounds:{' '}
          {data.rounds
            .filter((r) => r.state !== 'open')
            .map((r) => `${r.number} (${r.state.replace('_', ' ')})`)
            .join(', ')}
        </span>
      ) : null}
      {error ? <span className="md-field-error">{error}</span> : null}
    </section>
  )
}

/* ---------- Recurring runs ---------- */

type RuleKind = ScheduleRule['kind']

export function RunsPanel({
  item,
  team,
  canEdit,
  onChanged,
}: {
  item: CoreItem
  team: CoreTeam | undefined
  canEdit: boolean
  onChanged: () => void
}) {
  const { people } = useAppData()
  const loaded = useLoad(() => workApi.runs(item.id), `${item.id}:${item.stageKey}`)
  const [editing, setEditing] = useState(false)
  const [kind, setKind] = useState<RuleKind>('monthly')
  const [day, setDay] = useState<string>('first_working')
  const [weekdays, setWeekdays] = useState<number[]>([1])
  const [time, setTime] = useState('09:00')
  const stages = [...(team?.stages ?? [])].sort((a, b) => a.position - b.position)
  const [startStage, setStartStage] = useState<string>('')
  const [owner, setOwner] = useState<string>('')
  const { error, run } = useRun()
  const data = loaded.data
  if (!data) return null
  const schedule = data.schedule
  const rule = (): ScheduleRule =>
    kind === 'weekly'
      ? { kind, weekdays, time }
      : kind === 'monthly'
        ? { kind, day: day === 'first_working' || day === 'last_working' ? day : Number(day), time }
        : { kind, time }
  const after = () => {
    loaded.reload()
    onChanged()
  }
  const stageName = (key: string) => stages.find((s) => s.key === key)?.name ?? key
  const openRun = data.runs.find((r) => r.endedAt === null)

  return (
    <section className="mx-stack" aria-label="Runs">
      {schedule ? (
        <p className="mx-intro">
          ↻ {schedule.text} · starts in {stageName(schedule.startStage)} · next{' '}
          {when(schedule.nextAt)}
          {schedule.waitingForOpenRun ? ' · waiting for the open run to finish' : ''}
        </p>
      ) : (
        <p className="md-meta">This item does not repeat.</p>
      )}
      {canEdit ? (
        <div className="mx-row">
          <Button size="s" onClick={() => setEditing((e) => !e)}>
            {schedule ? 'Change schedule' : 'Make recurring'}
          </Button>
          {schedule ? (
            <Button
              size="s"
              kind="ghost"
              onClick={() => run(() => workApi.setSchedule(item.id, null), after)}
            >
              Stop repeating
            </Button>
          ) : null}
          <Button
            size="s"
            kind="primary"
            disabled={Boolean(openRun) || !schedule}
            onClick={() => run(() => workApi.startRun(item.id), after)}
          >
            {openRun ? `Run ${openRun.number} is open` : 'Start next run now'}
          </Button>
        </div>
      ) : null}
      {editing ? (
        <div className="mx-schedule-form">
          <label className="md-field">
            <span className="md-field-label">Repeats</span>
            <select
              className="md-select"
              value={kind}
              onChange={(e) => setKind(e.target.value as RuleKind)}
            >
              <option value="daily">Every day</option>
              <option value="weekly">Every week</option>
              <option value="monthly">Every month</option>
              <option value="quarterly">Every quarter</option>
            </select>
          </label>
          {kind === 'weekly' ? (
            <div className="md-field">
              <span className="md-field-label">On</span>
              <span className="mx-row">
                {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d, i) => (
                  <label key={d} className="mx-check-pill">
                    <input
                      type="checkbox"
                      className="md-check"
                      checked={weekdays.includes(i + 1)}
                      onChange={(e) =>
                        setWeekdays((w) =>
                          e.target.checked ? [...w, i + 1] : w.filter((x) => x !== i + 1),
                        )
                      }
                    />
                    {d}
                  </label>
                ))}
              </span>
            </div>
          ) : null}
          {kind === 'monthly' ? (
            <label className="md-field">
              <span className="md-field-label">On</span>
              <select className="md-select" value={day} onChange={(e) => setDay(e.target.value)}>
                <option value="first_working">First working day</option>
                <option value="last_working">Last working day</option>
                {Array.from({ length: 31 }, (_, i) => (
                  <option key={i} value={String(i + 1)}>
                    Day {i + 1}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label className="md-field">
            <span className="md-field-label">At (India time)</span>
            <input
              className="md-input"
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
            />
          </label>
          <label className="md-field">
            <span className="md-field-label">Each run starts in</span>
            <select
              className="md-select"
              value={
                startStage ||
                schedule?.startStage ||
                stages.find((s) => s.type !== 'done')?.key ||
                ''
              }
              onChange={(e) => setStartStage(e.target.value)}
            >
              {stages
                .filter((s) => s.type !== 'done')
                .map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.name}
                  </option>
                ))}
            </select>
          </label>
          <label className="md-field">
            <span className="md-field-label">Owner of each run</span>
            <select
              className="md-select"
              value={owner || schedule?.ownerId || ''}
              onChange={(e) => setOwner(e.target.value)}
            >
              <option value="">Keep the current owner</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <p className="md-meta">{describeRule(rule())}</p>
          <Button
            kind="primary"
            size="s"
            onClick={() =>
              run(
                () =>
                  workApi.setSchedule(
                    item.id,
                    rule(),
                    startStage ||
                      schedule?.startStage ||
                      stages.find((s) => s.type !== 'done')?.key,
                    owner || schedule?.ownerId || null,
                  ),
                () => {
                  setEditing(false)
                  after()
                },
              )
            }
          >
            Save schedule
          </Button>
        </div>
      ) : null}
      {data.runs.length === 0 ? null : (
        <div className="mx-stack">
          <h3 className="mx-h3">Runs history</h3>
          {data.runs.map((r) => (
            <details key={r.number} className="mx-run">
              <summary className="mx-run-summary">
                <RunTag run={r.number} />
                <span className="mx-grow">
                  {shortDate(r.startedAt.slice(0, 10))} →{' '}
                  {r.endedAt ? shortDate(r.endedAt.slice(0, 10)) : 'open'}
                  <span className="md-meta">
                    {' '}
                    ·{' '}
                    {r.startedBy === 'schedule'
                      ? 'started by schedule'
                      : `started by ${nameOf(people, r.starterId) ?? 'someone'}`}
                  </span>
                </span>
                <span
                  className={
                    r.outcome === 'completed'
                      ? 'mx-ok'
                      : r.outcome === 'cancelled'
                        ? 'md-meta'
                        : 'md-meta'
                  }
                >
                  {r.outcome ?? 'In progress'}
                </span>
              </summary>
              <div className="mx-stack mx-run-body">
                {r.passes.map((p, i) => {
                  const st = stages.find((s) => s.key === p.stageKey)
                  return (
                    <div key={i} className="mx-row">
                      {st ? <StatusTag type={st.type} name={st.name} /> : <span>{p.stageKey}</span>}
                      <span className="md-meta">
                        {nameOf(people, p.ownerId) ?? 'nobody'} · {when(p.enteredAt)}
                        {p.leftAt ? ` → ${when(p.leftAt)}` : ''}
                      </span>
                    </div>
                  )
                })}
                <span className="md-meta">
                  {r.comments} comments
                  {r.fieldValues?.estimate != null ? ` · estimate ${r.fieldValues.estimate}` : ''}
                  {r.fieldValues?.ownerId
                    ? ` · owner at the end: ${nameOf(people, r.fieldValues.ownerId)}`
                    : ''}
                </span>
              </div>
            </details>
          ))}
        </div>
      )}
      {error ? <span className="md-field-error">{error}</span> : null}
    </section>
  )
}

/* ---------- Attachments ---------- */

export function FilesPanel({ itemId }: { itemId: string }) {
  const { people } = useAppData()
  const loaded = useLoad(() => workApi.attachments(itemId), itemId)
  const { error, run } = useRun()
  const [busy, setBusy] = useState(false)
  const size = (n: number) =>
    n > 1024 * 1024
      ? `${(n / 1024 / 1024).toFixed(1)} MB`
      : `${Math.max(1, Math.round(n / 1024))} KB`
  return (
    <section className="mx-stack" aria-label="Files">
      {loaded.data?.length === 0 ? (
        <EmptyState
          icon={<Paperclip size={20} />}
          title="No files yet"
          text="Pictures, documents, PDFs and spreadsheets, up to 25 MB each."
        />
      ) : null}
      {loaded.data?.map((a) => (
        <div key={a.id} className="mx-file">
          <Paperclip size={16} aria-hidden="true" />
          <button
            type="button"
            className="mx-link-btn mx-grow"
            onClick={() => run(() => workApi.download(a))}
          >
            {a.name}
          </button>
          <span className="md-meta">
            {size(a.size)} · {nameOf(people, a.uploadedBy)}
          </span>
          <IconButton
            label={`Remove ${a.name}`}
            small
            onClick={() => run(() => workApi.removeAttachment(a.id), loaded.reload)}
          >
            <Trash2 size={14} />
          </IconButton>
        </div>
      ))}
      <label className="md-btn md-btn-secondary md-btn-s mx-upload">
        <Paperclip size={14} aria-hidden="true" />
        {busy ? 'Uploading…' : 'Attach files'}
        <input
          type="file"
          multiple
          className="mx-visually-hidden"
          onChange={async (e) => {
            const list = Array.from(e.currentTarget.files ?? [])
            e.currentTarget.value = ''
            setBusy(true)
            for (const file of list) await run(() => workApi.upload(itemId, file))
            setBusy(false)
            loaded.reload()
          }}
        />
      </label>
      {error ? <span className="md-field-error">{error}</span> : null}
    </section>
  )
}
