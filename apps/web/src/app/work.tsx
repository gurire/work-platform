import { X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { PRIORITIES, type PriorityName } from '@wm/shared'
import {
  Avatar,
  Button,
  IconButton,
  Label,
  OverdueTag,
  PriorityTag,
  StagePath,
  StatusTag,
  Tabs,
} from '../design/components'
import { CommentsPanel, Description, FilesPanel, ReviewPanel, RunsPanel } from './collab'
import { coreApi, type CoreItem, type CoreTeam, type Workflow } from './core-api'
import { nameOf, useAppData, useLoad } from './data'
import { hrefFor } from './routes'

const today = () => new Date().toISOString().slice(0, 10)

export function isOverdue(item: Pick<CoreItem, 'dueOn' | 'stageType'>): boolean {
  return item.dueOn !== null && item.stageType !== 'done' && item.dueOn < today()
}

export function shortDate(iso: string | null): string {
  if (!iso) return ''
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

/** A board card. The whole card is one button that opens the item. */
export function ItemCard({
  item,
  team,
  selected,
  onOpen,
  showTeam = false,
}: {
  item: CoreItem
  team: CoreTeam | undefined
  selected: boolean
  onOpen: () => void
  showTeam?: boolean
}) {
  const { people } = useAppData()
  const stage = team?.stages.find((s) => s.key === item.stageKey)
  return (
    <button
      type="button"
      className={selected ? 'mx-card mx-card-selected' : 'mx-card'}
      onClick={onOpen}
      aria-pressed={selected}
    >
      <span className="md-meta">
        {item.key}
        {showTeam ? ` · ${team?.name ?? item.teamId} · ${stage?.name ?? item.stageKey}` : ''}
      </span>
      <span className="mx-card-title">{item.title}</span>
      <span className="mx-card-meta">
        <Avatar name={nameOf(people, item.assigneeId)} size={24} />
        {isOverdue(item) ? (
          <OverdueTag>Overdue {shortDate(item.dueOn)}</OverdueTag>
        ) : item.dueOn ? (
          <span className="md-meta">{shortDate(item.dueOn)}</span>
        ) : null}
        {item.priority === 'urgent' || item.priority === 'high' ? (
          <PriorityTag priority={item.priority} />
        ) : null}
        {item.subItems.total > 0 ? (
          <span className="md-meta">
            {item.subItems.done}/{item.subItems.total} sub-items
          </span>
        ) : null}
      </span>
    </button>
  )
}

/** Type a title and press Enter (WP-BRIEF-002, Quick add). */
export function QuickAdd({
  label,
  onAdd,
}: {
  label: string
  onAdd: (title: string) => Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  return (
    <div className="mx-quick">
      <input
        className="md-input md-input-quick"
        aria-label={label}
        placeholder="+ Add item, press Enter"
        disabled={busy}
        onKeyDown={async (e) => {
          if (e.key !== 'Enter') return
          const input = e.currentTarget
          const title = input.value.trim()
          if (!title) return
          setBusy(true)
          setError(null)
          try {
            await onAdd(title)
            input.value = ''
          } catch (err) {
            setError(err instanceof Error ? err.message : String(err))
          } finally {
            setBusy(false)
            input.focus()
          }
        }}
      />
      {error ? <span className="md-field-error">{error}</span> : null}
    </div>
  )
}

interface ItemDetailProps {
  itemId: string
  onClose?: (() => void) | undefined
  onChanged: () => void
  fullPage?: boolean
}

/** The item in the side panel, or as a full page (WP-BRIEF-002, Opening an item). */
export function ItemDetail({ itemId, onClose, onChanged, fullPage = false }: ItemDetailProps) {
  const { people, teams, projects } = useAppData()
  const [version, setVersion] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<'comments' | 'review' | 'runs' | 'files'>('comments')
  const loaded = useLoad(async () => {
    const { item: found, subItems } = await coreApi.item(itemId)
    const [workflow, project] = await Promise.all([
      coreApi.workflow(found.id),
      found.projectId ? coreApi.project(found.projectId) : Promise.resolve(null),
    ])
    return { item: found, workflow, subItems, milestones: project?.milestones ?? [] }
  }, `${itemId}:${version}`)
  const data = loaded.data
  useEffect(() => setError(null), [itemId])
  if (loaded.error) return <p className="md-field-error">{loaded.error}</p>
  if (!data) return <p className="md-meta">Loading…</p>
  const { item, workflow, subItems, milestones } = data
  const team = teams.find((t) => t.id === item.teamId)
  const stages = [...(team?.stages ?? [])].sort((a, b) => a.position - b.position)
  const current = stages.findIndex((s) => s.key === item.stageKey)
  const stage = stages[current]

  const run = async (fn: () => Promise<unknown>) => {
    setError(null)
    try {
      await fn()
      setVersion((v) => v + 1)
      onChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className={fullPage ? 'mx-detail mx-detail-page' : 'mx-detail'}>
      <div className="mx-detail-head">
        <span className="md-meta">
          {item.key} · {team?.name}
        </span>
        <span className="mx-row">
          {fullPage ? null : (
            <a
              className="md-btn md-btn-secondary md-btn-s"
              href={hrefFor({ page: 'item', key: item.key })}
            >
              Open full page
            </a>
          )}
          {onClose ? (
            <IconButton label="Close" onClick={onClose}>
              <X size={16} />
            </IconButton>
          ) : null}
        </span>
      </div>
      <input
        key={item.title}
        className="mx-title-input"
        aria-label="Title"
        defaultValue={item.title}
        onBlur={(e) => {
          const title = e.currentTarget.value.trim()
          if (title && title !== item.title) void run(() => coreApi.editItem(item.id, { title }))
        }}
      />
      {stages.length > 0 ? (
        <StagePath current={current} stages={stages.map((s) => ({ name: s.name, type: s.type }))} />
      ) : null}
      <div className="mx-row">
        {stage ? <StatusTag type={stage.type} name={stage.name} /> : null}
        <MoveButtons
          workflow={workflow}
          stages={stages}
          onMove={(to) => run(() => coreApi.editItem(item.id, { statusId: to }))}
        />
      </div>
      {workflow.missing.length > 0 ? (
        <p className="md-meta">Before moving on: {workflow.missing.join(', ')}</p>
      ) : null}
      {error ? (
        <p className="md-field-error" role="alert">
          {error}
        </p>
      ) : null}

      <dl className="mx-props">
        <dt>Owner</dt>
        <dd>
          <select
            className="md-select"
            aria-label="Owner"
            value={item.assigneeId ?? ''}
            onChange={(e) =>
              run(() => coreApi.editItem(item.id, { assigneeId: e.target.value || null }))
            }
          >
            <option value="">Nobody</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </dd>
        <dt>Priority</dt>
        <dd className="mx-row">
          <select
            className="md-select"
            aria-label="Priority"
            value={item.priority}
            onChange={(e) =>
              run(() =>
                coreApi.editItem(item.id, {
                  priority: PRIORITIES.indexOf(e.target.value as PriorityName),
                }),
              )
            }
          >
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {p[0]?.toUpperCase() + p.slice(1)}
              </option>
            ))}
          </select>
        </dd>
        <dt>Due</dt>
        <dd>
          <input
            className="md-input"
            type="date"
            aria-label="Due date"
            defaultValue={item.dueOn ?? ''}
            key={item.dueOn ?? 'none'}
            onBlur={(e) =>
              e.currentTarget.value !== (item.dueOn ?? '') &&
              run(() => coreApi.plan(item.id, { dueOn: e.currentTarget.value || null }))
            }
          />
        </dd>
        <dt>Estimate ({team?.estimateUnit ?? 'hours'})</dt>
        <dd>
          <input
            className="md-input"
            type="number"
            min={0}
            step={1}
            aria-label="Estimate"
            defaultValue={item.estimate ?? ''}
            key={String(item.estimate)}
            onBlur={(e) => {
              const raw = e.currentTarget.value
              const value = raw === '' ? null : Math.max(0, Math.round(Number(raw)))
              if (value !== item.estimate)
                void run(() => coreApi.plan(item.id, { estimate: value }))
            }}
          />
        </dd>
        <dt>Project</dt>
        <dd>
          <select
            className="md-select"
            aria-label="Project"
            value={item.projectId ?? ''}
            disabled={item.parentId !== null}
            onChange={(e) =>
              run(() => coreApi.plan(item.id, { projectId: e.target.value || null }))
            }
          >
            <option value="">No project</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </dd>
        <dt>Milestone</dt>
        <dd>
          <select
            className="md-select"
            aria-label="Milestone"
            value={item.milestoneId ?? ''}
            disabled={!item.projectId}
            onChange={(e) =>
              run(() => coreApi.plan(item.id, { milestoneId: e.target.value || null }))
            }
          >
            <option value="">None</option>
            {milestones.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </dd>
        <dt>Labels</dt>
        <dd>
          <input
            className="md-input"
            aria-label="Labels, separated by commas"
            placeholder="finance, monthly"
            defaultValue={item.labels.join(', ')}
            key={item.labels.join(',')}
            onBlur={(e) => {
              const labels = e.currentTarget.value
                .split(',')
                .map((l) => l.trim())
                .filter(Boolean)
              if (labels.join(',') !== item.labels.join(','))
                void run(() => coreApi.plan(item.id, { labels }))
            }}
          />
          <span className="mx-row">
            {item.labels.map((l) => (
              <Label key={l}>{l}</Label>
            ))}
          </span>
        </dd>
      </dl>

      {item.parentId === null ? (
        <section className="mx-subitems" aria-label="Sub-items">
          <h3 className="mx-h3">
            Sub-items · {subItems.filter((s) => s.stageType === 'done').length} of {subItems.length}{' '}
            done
          </h3>
          {subItems.map((s) => (
            <a key={s.id} className="mx-subitem" href={hrefFor({ page: 'item', key: s.key })}>
              <StatusTag
                type={s.stageType}
                name={team?.stages.find((x) => x.key === s.stageKey)?.name}
              />
              <span>{s.title}</span>
              <Avatar name={nameOf(people, s.assigneeId)} size={24} />
            </a>
          ))}
          {team?.canCreate ? (
            <QuickAdd
              label="Add a sub-item"
              onAdd={async (title) =>
                run(() => coreApi.createItem({ teamId: item.teamId, title, parentId: item.id }))
              }
            />
          ) : null}
        </section>
      ) : (
        <p className="md-meta">This is a sub-item; it follows its parent’s project.</p>
      )}
      <Description item={item} canEdit={team?.canCreate ?? false} />
      <Tabs
        label="Item activity"
        value={tab}
        onChange={setTab}
        options={[
          { id: 'comments', label: 'Comments' },
          { id: 'review', label: 'Review' },
          { id: 'runs', label: 'Runs' },
          { id: 'files', label: 'Files' },
        ]}
      />
      {tab === 'comments' ? <CommentsPanel itemId={item.id} /> : null}
      {tab === 'review' ? (
        <ReviewPanel
          item={item}
          team={team}
          onChanged={() => {
            setVersion((v) => v + 1)
            onChanged()
          }}
        />
      ) : null}
      {tab === 'runs' ? (
        <RunsPanel
          item={item}
          team={team}
          canEdit={team?.canCreate ?? false}
          onChanged={() => {
            setVersion((v) => v + 1)
            onChanged()
          }}
        />
      ) : null}
      {tab === 'files' ? <FilesPanel itemId={item.id} /> : null}
    </div>
  )
}

function MoveButtons({
  workflow,
  stages,
  onMove,
}: {
  workflow: Workflow
  stages: CoreTeam['stages']
  onMove: (to: string) => void
}) {
  if (workflow.allowedMoves.length === 0)
    return <span className="md-meta">No moves from this stage</span>
  return (
    <>
      {workflow.allowedMoves.map((to) => {
        const target = stages.find((s) => s.key === to)
        return (
          <Button
            key={to}
            size="s"
            kind={
              target?.type === 'done' && target.doneOutcome === 'cancelled' ? 'ghost' : 'secondary'
            }
            onClick={() => onMove(to)}
          >
            Move to {target?.name ?? to}
          </Button>
        )
      })}
    </>
  )
}
