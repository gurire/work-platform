import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import {
  can,
  isEndStage,
  REVIEW_REQUIREMENT,
  SAMPLE_PRIORITIES,
  type UserPrincipal,
} from '@wm/shared'
import type { Api, ApiTeam, ApiUser, Me, Workflow, WorkflowStep } from './api'
import { buildStageStrip, timeAgo, type HistoryEntry } from './item-model'
import { CodePanel } from './CodePanel'
import { CommentsPanel } from './CommentsPanel'
import { RecordCard } from './RecordCard'
import { ReviewPanel } from './ReviewPanel'
import type { ItemStore } from './store'

interface Props {
  api: Api
  store: ItemStore
  itemKey: string
  me: Me | null
  teams: readonly ApiTeam[]
  users: readonly ApiUser[]
  /** e.g. "Item 3 of 120", or null when the item is not in the current list. */
  positionLabel: string | null
  onBack: () => void
  onOpenRecord: (id: string) => void
}

const message = (error: unknown) =>
  error instanceof Error ? error.message : 'something went wrong'

/** Unmet requirements, steps first, as the server reports them. */
function missingOf(workflow: Workflow): string[] {
  return [
    ...workflow.steps.filter((step) => !step.ticked).map((step) => step.label),
    ...workflow.requiredFields.filter((field) => !field.filled).map((field) => field.label),
    ...(workflow.review && !workflow.review.approved ? [REVIEW_REQUIREMENT] : []),
  ]
}

export function ItemPage({
  api,
  store,
  itemKey,
  me,
  teams,
  users,
  positionLabel,
  onBack,
  onOpenRecord,
}: Props) {
  const [id, setId] = useState<string | undefined>(() => store.idForKey(itemKey))
  const [notFound, setNotFound] = useState(false)
  const [workflow, setWorkflow] = useState<Workflow | null>(null)
  const [history, setHistory] = useState<readonly HistoryEntry[]>([])
  const [reload, setReload] = useState(0)
  const [pending, setPending] = useState<{ to: string; mode: 'force' | 'reopen' } | null>(null)
  const [reason, setReason] = useState('')
  const [moving, setMoving] = useState(false)

  // Find the item: from the list if it is loaded, otherwise ask the server (a shared link).
  useEffect(() => {
    let cancelled = false
    setNotFound(false)
    const known = store.idForKey(itemKey)
    if (known) {
      setId(known)
      return
    }
    setId(undefined)
    api.getItem(itemKey).then(
      (item) => {
        if (cancelled) return
        store.put(item)
        setId(item.id)
      },
      () => {
        if (!cancelled) setNotFound(true)
      },
    )
    return () => {
      cancelled = true
    }
  }, [api, store, itemKey])

  const item = useSyncExternalStore(
    (listener) => (id ? store.subscribeItem(id, listener) : () => {}),
    () => (id ? store.getItem(id) : undefined),
  )
  const statusId = item?.statusId

  useEffect(() => {
    if (!id) return
    let cancelled = false
    Promise.all([api.workflow(id), api.stageHistory(id)]).then(
      ([nextWorkflow, nextHistory]) => {
        if (cancelled) return
        setWorkflow(nextWorkflow)
        setHistory(nextHistory)
      },
      (error: unknown) => {
        if (!cancelled) store.toast(`Could not load this item's stages: ${message(error)}.`)
      },
    )
    return () => {
      cancelled = true
    }
  }, [api, store, id, reload, statusId])

  const userNames = useMemo(() => new Map(users.map((u) => [u.id, u.name])), [users])
  const nameOf = (userId: string | null) =>
    userId ? (userNames.get(userId) ?? userId) : 'Unassigned'

  if (notFound) {
    return (
      <main className="item-page">
        <button type="button" className="link-button" onClick={onBack}>
          Back to the list
        </button>
        <h1 className="item-title">{itemKey} is not available</h1>
        <p className="muted">It does not exist, or you do not have access to it.</p>
      </main>
    )
  }
  if (!item) {
    return (
      <main className="item-page">
        <p className="muted">Loading {itemKey}…</p>
      </main>
    )
  }

  const team = teams.find((t) => t.id === item.teamId)
  const stages = [...(team?.stages ?? [])].sort((a, b) => a.position - b.position)
  const stageName = (key: string) => stages.find((s) => s.key === key)?.name ?? key
  const current = stages.find((s) => s.key === item.statusId)
  const target = { team: { id: item.teamId, isPrivate: team?.isPrivate ?? false } }
  const principal: UserPrincipal | null = me ? { kind: 'user', ...me } : null
  const allowed = (action: Parameters<typeof can>[1]) =>
    principal ? can(principal, action, target) : false
  const missing = workflow ? missingOf(workflow) : []
  const strip = buildStageStrip(stages, history, item.statusId, item.assigneeId)
  const fromEnd = current ? isEndStage(current) : false
  const priority = Number(item.fields.priority ?? 0)
  const otherFields = Object.entries(item.fields).filter(
    ([key]) => key !== 'priority' && !workflow?.requiredFields.some((f) => f.key === key),
  )

  async function tick(step: WorkflowStep) {
    if (!id || !workflow) return
    const before = workflow
    const steps = workflow.steps.map((s) => (s.id === step.id ? { ...s, ticked: !s.ticked } : s))
    setWorkflow({ ...workflow, steps })
    try {
      setWorkflow(await api.tickStep(id, step.id, !step.ticked))
    } catch (error) {
      setWorkflow(before)
      store.toast(`${item?.key}: ${message(error)}. The tick was undone.`)
    }
  }

  async function saveField(key: string, value: string) {
    if (!item) return
    const trimmed = value.trim()
    if (String(item.fields[key] ?? '') === trimmed) return
    try {
      const saved = await api.saveItem(item, { fields: { [key]: trimmed === '' ? null : trimmed } })
      if (saved) store.put(saved)
      setReload((n) => n + 1)
    } catch (error) {
      store.toast(`${item.key}: ${message(error)}.`)
    }
  }

  async function moveTo(to: string, options: { reason?: string; force?: boolean } = {}) {
    if (!id || !item) return
    setMoving(true)
    try {
      const saved = await api.moveItem(id, to, options)
      if (saved) store.put(saved)
      setPending(null)
      setReason('')
      setReload((n) => n + 1)
    } catch (error) {
      store.toast(`${item.key}: ${message(error)}.`)
    } finally {
      setMoving(false)
    }
  }

  const moves = (workflow?.allowedMoves ?? [])
    .map((key) => stages.find((s) => s.key === key))
    .filter((s): s is NonNullable<typeof s> => s !== undefined)
    .sort((a, b) => a.position - b.position)
  const canMove = allowed(fromEnd ? 'item.reopen' : 'item.transition')

  return (
    <main className="item-page" aria-labelledby="item-title">
      <div className="item-crumbs">
        <button type="button" className="link-button" onClick={onBack}>
          {team?.name ?? item.teamId}
        </button>
        <span aria-hidden="true">/</span>
        <span>{item.key}</span>
        <span className="item-crumbs-end muted">
          {positionLabel ? `${positionLabel} · ` : ''}J / K next and previous · Esc back
        </span>
      </div>

      <h1 id="item-title" className="item-title">
        {item.title}
      </h1>

      <ol className="stage-strip" aria-label="Stages">
        {strip.map((s) => (
          <li
            key={s.key}
            className={`stage-step stage-${s.state}${s.ended ? ' stage-ended' : ''}`}
            aria-current={s.state === 'current' ? 'step' : undefined}
          >
            <span className="stage-state">
              {s.state === 'current'
                ? s.passes > 1
                  ? `Now, pass ${s.passes}`
                  : 'Now'
                : s.state === 'visited'
                  ? 'Done'
                  : 'Not yet'}
            </span>
            <span className="stage-name">{s.name}</span>
            <span className="stage-owner">{s.state === 'upcoming' ? '' : nameOf(s.ownerId)}</span>
          </li>
        ))}
      </ol>

      <div className="item-columns">
        <div className="item-main">
          <section className="panel" aria-labelledby="req-title">
            <div className="panel-head">
              <h2 id="req-title">
                {fromEnd ? 'This item is finished' : 'Before this can move on'}
              </h2>
              {workflow && !fromEnd && (
                <span className="muted">
                  {missing.length === 0
                    ? 'Everything is done.'
                    : `${missing.length} left: ${missing.join(', ')}`}
                </span>
              )}
            </div>
            {!workflow && <p className="muted">Loading…</p>}
            {workflow &&
              workflow.steps.length === 0 &&
              workflow.requiredFields.length === 0 &&
              !workflow.review && (
                <p className="muted">{current?.name ?? 'This stage'} has no requirements.</p>
              )}
            {workflow?.steps.map((step) => (
              <label key={step.id} className="check-row">
                <input
                  type="checkbox"
                  checked={step.ticked}
                  disabled={!allowed('item.tickStep')}
                  onChange={() => void tick(step)}
                />
                <span>{step.label}</span>
                {step.ticked && step.tickedBy && (
                  <span className="muted check-meta">
                    {nameOf(step.tickedBy)}
                    {step.tickedAt ? `, ${timeAgo(step.tickedAt)}` : ''}
                  </span>
                )}
              </label>
            ))}
            {workflow?.requiredFields.map((field) => (
              <label
                key={`${field.key}:${String(item.fields[field.key] ?? '')}`}
                className="field-row"
              >
                <span>
                  {field.label} <span className="muted">(required)</span>
                </span>
                <input
                  type="text"
                  defaultValue={String(item.fields[field.key] ?? '')}
                  disabled={!allowed('item.edit')}
                  placeholder="Not filled in yet"
                  onBlur={(event) => void saveField(field.key, event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') event.currentTarget.blur()
                  }}
                />
              </label>
            ))}

            <div className="move-row" aria-label="Move this item">
              {canMove &&
                moves.map((to) => {
                  const forward =
                    !!current && to.position > current.position && to.category !== 'cancelled'
                  if (fromEnd) {
                    return (
                      <button
                        key={to.key}
                        type="button"
                        className="button"
                        disabled={moving}
                        onClick={() => setPending({ to: to.key, mode: 'reopen' })}
                      >
                        Reopen to {to.name}
                      </button>
                    )
                  }
                  if (forward && missing.length > 0) {
                    return workflow?.canForce ? (
                      <button
                        key={to.key}
                        type="button"
                        className="button"
                        disabled={moving}
                        onClick={() => setPending({ to: to.key, mode: 'force' })}
                      >
                        Force to {to.name}
                      </button>
                    ) : (
                      <button
                        key={to.key}
                        type="button"
                        className="button"
                        disabled
                        title={`Still needed: ${missing.join(', ')}`}
                      >
                        {to.name} · {missing.length} left
                      </button>
                    )
                  }
                  return (
                    <button
                      key={to.key}
                      type="button"
                      className={forward ? 'button button-primary' : 'button'}
                      disabled={moving}
                      onClick={() => void moveTo(to.key)}
                    >
                      {forward ? `Send to ${to.name}` : `Move to ${to.name}`}
                    </button>
                  )
                })}
              {!canMove && <span className="muted">You can view this item but not move it.</span>}
            </div>

            {pending && (
              <form
                className="reason-box"
                onSubmit={(event) => {
                  event.preventDefault()
                  void moveTo(pending.to, {
                    reason,
                    ...(pending.mode === 'force' ? { force: true } : {}),
                  })
                }}
              >
                <label htmlFor="move-reason">
                  {pending.mode === 'force'
                    ? `Why move to ${stageName(pending.to)} without the missing steps? This is recorded.`
                    : `Why reopen this item? The reason is shown on the item.`}
                </label>
                <textarea
                  id="move-reason"
                  rows={2}
                  value={reason}
                  autoFocus
                  onChange={(event) => setReason(event.target.value)}
                />
                <div className="move-row">
                  <button
                    type="submit"
                    className="button button-primary"
                    disabled={moving || reason.trim() === ''}
                  >
                    {pending.mode === 'force' ? 'Force the move' : 'Reopen'}
                  </button>
                  <button type="button" className="button" onClick={() => setPending(null)}>
                    Cancel
                  </button>
                </div>
              </form>
            )}
          </section>

          <ReviewPanel
            api={api}
            store={store}
            item={item}
            meId={me?.id ?? null}
            users={users}
            stageName={stageName}
            onChanged={() => setReload((n) => n + 1)}
          />

          <CommentsPanel api={api} store={store} item={item} users={users} />

          <CodePanel api={api} item={item} />

          <section className="panel" aria-labelledby="activity-title">
            <h2 id="activity-title">Stage history</h2>
            <ul className="activity">
              {[...history].reverse().map((entry, index) => (
                <li key={`${entry.enteredAt}-${index}`}>
                  <span>
                    {entry.kind === 'automatic'
                      ? `Moved automatically to ${stageName(entry.stageKey)}`
                      : entry.movedBy === null
                        ? `Started in ${stageName(entry.stageKey)}`
                        : entry.kind === 'forced'
                          ? `${nameOf(entry.movedBy)} forced it to ${stageName(entry.stageKey)}`
                          : entry.kind === 'reopen'
                            ? `${nameOf(entry.movedBy)} reopened it to ${stageName(entry.stageKey)}`
                            : entry.kind === 'sent_back'
                              ? `${nameOf(entry.movedBy)} asked for changes; sent back to ${stageName(entry.stageKey)}`
                              : `${nameOf(entry.movedBy)} moved it to ${stageName(entry.stageKey)}`}
                    {entry.reason ? `: "${entry.reason}"` : ''}
                  </span>
                  <span className="muted">
                    {entry.ownerId ? `owner ${nameOf(entry.ownerId)} · ` : ''}
                    {timeAgo(entry.enteredAt)}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </div>

        <aside className="item-side" aria-label="Details">
          <dl className="details">
            <dt>Stage</dt>
            <dd>{current?.name ?? item.statusId}</dd>
            <dt>
              <label htmlFor="owner-select">Owner</label>
            </dt>
            <dd>
              <select
                id="owner-select"
                value={item.assigneeId ?? ''}
                disabled={!allowed('item.assign')}
                onChange={(event) =>
                  store.mutate(item.id, { assigneeId: event.target.value || null })
                }
              >
                <option value="">Unassigned</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </dd>
            <dt>Team</dt>
            <dd>{team?.name ?? item.teamId}</dd>
            <dt>Kind</dt>
            <dd>{item.kind}</dd>
            <dt>Priority</dt>
            <dd>{SAMPLE_PRIORITIES[priority] ?? 'None'}</dd>
            {otherFields.map(([key, value]) => (
              <div key={key} className="details-pair">
                <dt>{key}</dt>
                <dd>{String(value ?? '')}</dd>
              </div>
            ))}
            <dt>Created</dt>
            <dd>{timeAgo(item.createdAt)}</dd>
          </dl>
          <RecordCard api={api} store={store} item={item} onOpenRecord={onOpenRecord} />
        </aside>
      </div>
    </main>
  )
}
