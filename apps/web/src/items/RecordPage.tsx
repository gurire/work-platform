import { useEffect, useState } from 'react'
import { checkRecordValues, type RecordField, type RecordValue } from '@wm/shared'
import type { Api, ApiTeam, ApiUser, RecordDetail } from './api'
import { timeAgo } from './item-model'
import { formatValue, parseInput } from './record-format'
import type { ItemStore } from './store'

interface Props {
  api: Api
  store: ItemStore
  recordId: string
  users: readonly ApiUser[]
  teams: readonly ApiTeam[]
  onBack: () => void
  onOpenItem: (key: string) => void
}

const message = (error: unknown) =>
  error instanceof Error ? error.message : 'something went wrong'

function inputType(field: RecordField): string {
  if (field.kind === 'number') return 'number'
  if (field.kind === 'date') return 'date'
  if (field.kind === 'link') return 'url'
  return 'text'
}

/** One record: its fields, the items about it, and every change (specs/records.md). */
export function RecordPage({ api, store, recordId, users, teams, onBack, onOpenItem }: Props) {
  const [detail, setDetail] = useState<RecordDetail | null>(null)
  const [missing, setMissing] = useState(false)
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [title, setTitle] = useState('')
  const [saving, setSaving] = useState(false)
  const [confirmArchive, setConfirmArchive] = useState(false)

  function load(next: RecordDetail) {
    setDetail(next)
    setTitle(next.record.title)
    setDraft(
      Object.fromEntries(
        (next.type?.fields ?? []).map((f) => [f.key, String(next.record.values[f.key] ?? '')]),
      ),
    )
  }

  useEffect(() => {
    let cancelled = false
    setMissing(false)
    api.record(recordId).then(
      (next) => {
        if (!cancelled) load(next)
      },
      () => {
        if (!cancelled) setMissing(true)
      },
    )
    return () => {
      cancelled = true
    }
  }, [api, recordId])

  if (missing) {
    return (
      <main className="item-page">
        <button type="button" className="link-button" onClick={onBack}>
          Back
        </button>
        <h1 className="item-title">This record is not available</h1>
        <p className="muted">It does not exist, or you do not have access to it.</p>
      </main>
    )
  }
  if (!detail) {
    return (
      <main className="item-page">
        <p className="muted">Loading record…</p>
      </main>
    )
  }

  const { record, type } = detail
  const fields = type?.fields ?? []
  const nameOf = (id: string | null) =>
    id ? (users.find((u) => u.id === id)?.name ?? id) : 'Someone'
  const teamName = (id: string) => teams.find((t) => t.id === id)?.name ?? id
  const labelOf = (key: string) =>
    key === 'title' ? 'Title' : (fields.find((f) => f.key === key)?.label ?? key)
  const fieldOf = (key: string) => fields.find((f) => f.key === key)

  // Only what changed is sent; the same rules as the server are checked first.
  const changes: Record<string, RecordValue> = {}
  for (const field of fields) {
    const next = parseInput(field, draft[field.key] ?? '')
    if (next !== (record.values[field.key] ?? null)) changes[field.key] = next
  }
  const titleChanged = title.trim() !== record.title && title.trim() !== ''
  const local = type ? checkRecordValues(type, changes, record.values) : null
  const problem =
    local && !local.ok
      ? `${labelOf(local.field)}: ${local.error === 'required_missing' ? 'required' : 'does not fit'}`
      : null
  const dirty = titleChanged || Object.keys(changes).length > 0

  async function save() {
    setSaving(true)
    try {
      load(
        await api.updateRecord(record.id, {
          ...(titleChanged ? { title: title.trim() } : {}),
          ...(Object.keys(changes).length > 0 ? { values: changes } : {}),
        }),
      )
    } catch (error) {
      store.toast(`${record.title}: ${message(error)}.`)
    } finally {
      setSaving(false)
    }
  }

  async function archive() {
    try {
      load(await api.archiveRecord(record.id))
      setConfirmArchive(false)
    } catch (error) {
      store.toast(`${record.title}: ${message(error)}.`)
    }
  }

  return (
    <main className="item-page" aria-labelledby="record-title">
      <div className="item-crumbs">
        <button type="button" className="link-button" onClick={onBack}>
          Back
        </button>
        <span aria-hidden="true">/</span>
        <span>
          {type?.name ?? 'Record'} · looked after by {teamName(record.teamId)}
        </span>
        <span className="item-crumbs-end muted">Esc back</span>
      </div>

      <h1 id="record-title" className="item-title">
        {record.title} {record.archived && <span className="badge">Archived</span>}
      </h1>

      <div className="item-columns">
        <div className="item-main">
          <section className="panel" aria-labelledby="fields-title">
            <div className="panel-head">
              <h2 id="fields-title">Facts</h2>
              <span className="muted">
                {detail.canEdit
                  ? 'Changes show on every linked item.'
                  : record.archived
                    ? 'Archived records cannot be changed.'
                    : `Only ${teamName(record.teamId)} can change these.`}
              </span>
            </div>
            {detail.canEdit && (
              <label className="field-row">
                <span>Title</span>
                <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} />
              </label>
            )}
            {fields.map((field) =>
              detail.canEdit ? (
                <label key={field.key} className="field-row">
                  <span>
                    {field.label} {field.required && <span className="muted">(required)</span>}
                  </span>
                  {field.kind === 'choice' ? (
                    <select
                      value={draft[field.key] ?? ''}
                      onChange={(e) => setDraft({ ...draft, [field.key]: e.target.value })}
                    >
                      <option value="">—</option>
                      {(field.options ?? []).map((option) => (
                        <option key={option} value={option}>
                          {formatValue(field, option)}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type={inputType(field)}
                      value={draft[field.key] ?? ''}
                      onChange={(e) => setDraft({ ...draft, [field.key]: e.target.value })}
                    />
                  )}
                </label>
              ) : (
                <div key={field.key} className="field-row">
                  <span>{field.label}</span>
                  <span>{formatValue(field, record.values[field.key])}</span>
                </div>
              ),
            )}
            {detail.canEdit && (
              <div className="move-row">
                <button
                  type="button"
                  className="button button-primary"
                  disabled={!dirty || saving || problem !== null}
                  onClick={() => void save()}
                >
                  Save changes
                </button>
                {problem && <span className="muted">{problem}</span>}
              </div>
            )}
          </section>

          <section className="panel" aria-labelledby="record-history-title">
            <h2 id="record-history-title">History</h2>
            <ul className="activity">
              {detail.history.map((event, index) => (
                <li key={`${event.at}-${index}`}>
                  <span>
                    {event.action === 'created'
                      ? `${nameOf(event.actorId)} created this record`
                      : event.action === 'archived'
                        ? `${nameOf(event.actorId)} archived this record`
                        : `${nameOf(event.actorId)} changed ${event.changes
                            .map(
                              (c) =>
                                `${labelOf(c.field)} from ${formatValue(fieldOf(c.field), c.from)} to ${formatValue(fieldOf(c.field), c.to)}`,
                            )
                            .join('; ')}`}
                  </span>
                  <span className="muted">{timeAgo(event.at)}</span>
                </li>
              ))}
            </ul>
          </section>
        </div>

        <aside className="item-side" aria-label="Linked items">
          <h2 className="side-title">Items about this ({detail.items.length})</h2>
          <ul className="linked-items">
            {detail.items.map((item) => (
              <li key={item.id}>
                <button type="button" className="link-button" onClick={() => onOpenItem(item.key)}>
                  {item.key}
                </button>{' '}
                <span>{item.title}</span>
              </li>
            ))}
            {detail.items.length === 0 && <li className="muted">None that you can see.</li>}
          </ul>
          {detail.canArchive && (
            <div className="move-row">
              {confirmArchive ? (
                <>
                  <button type="button" className="button" onClick={() => void archive()}>
                    Yes, archive it
                  </button>
                  <button type="button" className="button" onClick={() => setConfirmArchive(false)}>
                    Cancel
                  </button>
                </>
              ) : (
                <button type="button" className="button" onClick={() => setConfirmArchive(true)}>
                  Archive record
                </button>
              )}
            </div>
          )}
        </aside>
      </div>
    </main>
  )
}
