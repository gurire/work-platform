import { useEffect, useState } from 'react'
import type { WorkItem } from '@wm/shared'
import type { Api, ItemRecord, RecordSummary } from './api'
import { formatValue } from './record-format'
import type { ItemStore } from './store'

interface Props {
  api: Api
  store: ItemStore
  item: WorkItem
  onOpenRecord: (id: string) => void
}

const message = (error: unknown) =>
  error instanceof Error ? error.message : 'something went wrong'

/** The record this item is about (specs/records.md), shown beside the item's details. */
export function RecordCard({ api, store, item, onOpenRecord }: Props) {
  const [data, setData] = useState<ItemRecord | null>(null)
  const [picking, setPicking] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<readonly RecordSummary[]>([])
  const [reload, setReload] = useState(0)

  useEffect(() => {
    let cancelled = false
    api.itemRecord(item.id).then(
      (next) => {
        if (!cancelled) setData(next)
      },
      () => {
        if (!cancelled) setData(null)
      },
    )
    return () => {
      cancelled = true
    }
  }, [api, item.id, reload])

  // Search as the person types, a moment after they stop.
  useEffect(() => {
    if (!picking) return
    let cancelled = false
    const timer = setTimeout(() => {
      api.findRecords(query).then(
        (found) => {
          if (!cancelled) setResults(found)
        },
        (error: unknown) => {
          if (!cancelled) store.toast(`Could not search records: ${message(error)}.`)
        },
      )
    }, 150)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [api, store, picking, query])

  if (!data) return null

  async function link(recordId: string | null) {
    try {
      const { item: saved } = await api.linkRecord(item.id, recordId)
      if (saved) store.put(saved)
      setPicking(false)
      setQuery('')
      setReload((n) => n + 1)
    } catch (error) {
      store.toast(`${item.key}: ${message(error)}.`)
    }
  }

  const { record, type } = data
  return (
    <section className="record-card" aria-labelledby="record-card-title">
      <div className="panel-head">
        <h2 id="record-card-title">{type?.name ?? 'Record'}</h2>
        {record?.archived && <span className="badge">Archived</span>}
      </div>
      {record ? (
        <>
          <button
            type="button"
            className="link-button record-title"
            onClick={() => onOpenRecord(record.id)}
          >
            {record.title}
          </button>
          <dl className="details">
            {(type?.fields ?? []).map((field) => (
              <div key={field.key} className="details-pair">
                <dt>{field.label}</dt>
                <dd>
                  {field.kind === 'link' && typeof record.values[field.key] === 'string' ? (
                    <a
                      href={String(record.values[field.key])}
                      target="_blank"
                      rel="noreferrer noopener"
                    >
                      Open
                    </a>
                  ) : (
                    formatValue(field, record.values[field.key])
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </>
      ) : (
        <p className="muted">Not linked to a record.</p>
      )}

      {data.canLink && !picking && (
        <div className="move-row">
          <button type="button" className="button" onClick={() => setPicking(true)}>
            {record ? 'Change' : 'Link a record'}
          </button>
          {record && (
            <button type="button" className="button" onClick={() => void link(null)}>
              Unlink
            </button>
          )}
        </div>
      )}

      {picking && (
        <div className="record-pick">
          <input
            type="search"
            autoFocus
            placeholder="Search records by title"
            aria-label="Search records by title"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <ul>
            {results.map((r) => (
              <li key={r.id}>
                <button type="button" className="link-button" onClick={() => void link(r.id)}>
                  {r.title} <span className="muted">· {r.teamId}</span>
                </button>
              </li>
            ))}
            {results.length === 0 && <li className="muted">No records found.</li>}
          </ul>
          <button type="button" className="button" onClick={() => setPicking(false)}>
            Cancel
          </button>
        </div>
      )}
    </section>
  )
}
