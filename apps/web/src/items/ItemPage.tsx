import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import {
  can,
  isEndStage,
  REVIEW_REQUIREMENT,
  SAMPLE_PRIORITIES,
  type UserPrincipal,
} from '@wm/shared'
import type { Api, ApiTeam, ApiUser, Me, Workflow, WorkflowStep } from './api'
import {
  buildStageStrip,
  shortDuration,
  splitMoves,
  timeAgo,
  type HistoryEntry,
} from './item-model'
import {
  ArrowRight,
  CalendarClock,
  Check,
  ChevronDown,
  CircleDot,
  Clock,
  Eye,
  Shapes,
  Signal,
  Tag,
  UserRound,
  Users,
} from 'lucide-react'
import { Avatar, KindIcon, PriorityIcon, StageChip, TeamTile, stageLook } from '../ui/kit'
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

/** Oldest first, by when each stage was entered. */
const sortHistory = (entries: readonly HistoryEntry[]) =>
  [...entries].sort((a, b) => a.enteredAt.localeCompare(b.enteredAt))

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
        setHistory(sortHistory(nextHistory))
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
  const { forward, others } = splitMoves(moves, current)
  const owner = item.assigneeId ? nameOf(item.assigneeId) : null
  // How long it has waited in this stage, against the stage's target (specs/stage-limits.md).
  const enteredAt = history.at(-1)?.enteredAt
  const waitedHours = enteredAt ? (Date.now() - new Date(enteredAt).getTime()) / 3_600_000 : null
  const targetHours =
    team?.stageLimits.find((l) => l.stageKey === item.statusId)?.targetHours ?? null
  const late = waitedHours !== null && targetHours !== null && waitedHours > targetHours
  const doneCount = workflow
    ? workflow.steps.filter((s) => s.ticked).length +
      workflow.requiredFields.filter((f) => String(item.fields[f.key] ?? '').trim() !== '').length
    : 0
  const totalCount = workflow ? workflow.steps.length + workflow.requiredFields.length : 0
  const shownStrip = strip.filter(
    (s) =>
      !(
        s.ended &&
        s.state === 'upcoming' &&
        stages.find((st) => st.key === s.key)?.category === 'cancelled'
      ),
  )

  return (
    <main className="item-page item-v2" aria-labelledby="item-title">
      <div className="item-crumbs">
        <button type="button" className="crumb" onClick={onBack}>
          {team && <TeamTile id={team.id} name={team.name} size={16} />}
          {team?.name ?? item.teamId}
        </button>
        <span aria-hidden="true" className="muted">
          /
        </span>
        <span className="crumb-key">
          <KindIcon kind={item.kind} />
          {item.key}
        </span>
        <span className="item-crumbs-end muted">
          {positionLabel ? `${positionLabel} · ` : ''}J / K next and previous · Esc back
        </span>
      </div>

      <h1 id="item-title" className="item-title">
        {item.title}
      </h1>

      <div className="pill-row" aria-label="Key details">
        <StageChip look={stageLook(stages, item.statusId)} />
        <span className="pill">
          <PriorityIcon level={priority} />
          {SAMPLE_PRIORITIES[priority] ?? 'None'}
        </span>
        <span className="pill">
          <Avatar name={owner} id={item.assigneeId} size={18} />
          {owner ?? 'Unassigned'}
        </span>
        {waitedHours !== null && !fromEnd && (
          <span
            className={late ? 'pill chip late' : 'pill'}
            title={targetHours ? `Target ${shortDuration(targetHours)}` : undefined}
          >
            <Clock size={13} aria-hidden="true" />
            {shortDuration(waitedHours)} in {current?.name ?? 'this stage'}
            {late ? ' · past target' : ''}
          </span>
        )}
        <span className="pill muted">Created {timeAgo(item.createdAt)}</span>
      </div>

      <ol className="stepper" aria-label="Stages">
        {shownStrip.map((s) => (
          <li
            key={s.key}
            className={`step step-${s.state}${s.ended ? ' step-end' : ''}`}
            aria-current={s.state === 'current' ? 'step' : undefined}
          >
            <span className="step-dot" aria-hidden="true">
              {s.state === 'visited' && <Check size={12} strokeWidth={3} />}
            </span>
            <span className="step-name">
              {s.name}
              {s.state === 'current' && s.passes > 1 && (
                <span className="step-pass">pass {s.passes}</span>
              )}
            </span>
            <span className="step-owner">
              {s.state === 'upcoming' ? '' : (nameOf(s.ownerId) ?? '')}
            </span>
            <span className="sr-only">
              {s.state === 'current'
                ? 'current stage'
                : s.state === 'visited'
                  ? 'done'
                  : 'not reached yet'}
            </span>
          </li>
        ))}
      </ol>

      <div className="item-columns">
        <div className="item-main">
          <section className="panel next-card" aria-labelledby="req-title">
            <div className="panel-head">
              <h2 id="req-title">
                {fromEnd
                  ? `${current?.name ?? 'Finished'}: this item is finished`
                  : forward
                    ? `To send this to ${forward.name}`
                    : 'Before this can move on'}
              </h2>
              {workflow && !fromEnd && totalCount > 0 && (
                <span className="muted">
                  {doneCount} of {totalCount} done
                </span>
              )}
            </div>
            {workflow && !fromEnd && totalCount > 0 && (
              <div
                className="progress"
                role="progressbar"
                aria-label="Requirements done"
                aria-valuemin={0}
                aria-valuemax={totalCount}
                aria-valuenow={doneCount}
              >
                <span style={{ width: `${(doneCount / totalCount) * 100}%` }} />
              </div>
            )}
            {!workflow && <p className="muted">Loading…</p>}
            {workflow &&
              workflow.steps.length === 0 &&
              workflow.requiredFields.length === 0 &&
              !workflow.review &&
              !fromEnd && (
                <p className="muted">{current?.name ?? 'This stage'} has no requirements.</p>
              )}
            {workflow?.steps.map((step) => (
              <label key={step.id} className={step.ticked ? 'check-row check-done' : 'check-row'}>
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
            {workflow && missing.includes(REVIEW_REQUIREMENT) && (
              <p className="needs-review">
                <Eye size={14} aria-hidden="true" /> Needs an approved review (below).
              </p>
            )}

            <div className="move-row" aria-label="Move this item">
              {canMove && fromEnd && moves.length > 0 && (
                <MoveMenu
                  label="Reopen…"
                  items={moves.map((to) => ({
                    key: to.key,
                    label: `Reopen to ${to.name}`,
                    run: () => setPending({ to: to.key, mode: 'reopen' }),
                  }))}
                  disabled={moving}
                />
              )}
              {canMove &&
                !fromEnd &&
                forward &&
                (missing.length > 0 ? (
                  <button
                    type="button"
                    className="button button-primary"
                    disabled
                    title={`Still needed: ${missing.join(', ')}`}
                  >
                    Send to {forward.name} · {missing.length} left
                  </button>
                ) : (
                  <button
                    type="button"
                    className="button button-primary"
                    disabled={moving}
                    onClick={() => void moveTo(forward.key)}
                  >
                    Send to {forward.name} <ArrowRight size={14} aria-hidden="true" />
                  </button>
                ))}
              {canMove &&
                !fromEnd &&
                (others.length > 0 || (forward && missing.length > 0 && workflow?.canForce)) && (
                  <MoveMenu
                    label="More"
                    disabled={moving}
                    items={[
                      ...(forward && missing.length > 0 && workflow?.canForce
                        ? [
                            {
                              key: `force-${forward.key}`,
                              label: `Force to ${forward.name} (needs a reason)`,
                              run: () => setPending({ to: forward.key, mode: 'force' as const }),
                            },
                          ]
                        : []),
                      ...others.map((to): MoveMenuItem => {
                        const ahead =
                          !!current && to.position > current.position && to.category !== 'cancelled'
                        if (ahead && missing.length > 0) {
                          return workflow?.canForce
                            ? {
                                key: to.key,
                                label: `Force to ${to.name} (needs a reason)`,
                                run: () => setPending({ to: to.key, mode: 'force' as const }),
                              }
                            : {
                                key: to.key,
                                label: `${to.name} · ${missing.length} left`,
                                run: null,
                              }
                        }
                        return {
                          key: to.key,
                          label:
                            to.category === 'cancelled'
                              ? `Drop (move to ${to.name})`
                              : ahead
                                ? `Skip ahead to ${to.name}`
                                : `Move back to ${to.name}`,
                          danger: to.category === 'cancelled',
                          run: () => {
                            void moveTo(to.key)
                          },
                        }
                      }),
                    ]}
                  />
                )}
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
            <ul className="activity timeline">
              {[...history].reverse().map((entry, index) => (
                <li key={`${entry.enteredAt}-${index}`}>
                  <Avatar
                    name={entry.movedBy ? nameOf(entry.movedBy) : null}
                    id={entry.movedBy}
                    size={20}
                  />
                  <span>
                    {entry.kind === 'automatic'
                      ? `Moved automatically to ${stageName(entry.stageKey)}`
                      : entry.movedBy === null
                        ? index === history.length - 1
                          ? `Started in ${stageName(entry.stageKey)}`
                          : `Moved to ${stageName(entry.stageKey)}`
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
          <dl className="details rail">
            <dt>
              <CircleDot size={14} aria-hidden="true" /> Stage
            </dt>
            <dd>
              <StageChip look={stageLook(stages, item.statusId)} />
            </dd>
            <dt>
              <UserRound size={14} aria-hidden="true" /> <label htmlFor="owner-select">Owner</label>
            </dt>
            <dd className="with-avatar">
              <Avatar name={owner} id={item.assigneeId} size={20} />
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
            <dt>
              <Signal size={14} aria-hidden="true" />{' '}
              <label htmlFor="priority-select">Priority</label>
            </dt>
            <dd className="with-avatar">
              <PriorityIcon level={priority} />
              <select
                id="priority-select"
                value={priority}
                disabled={!allowed('item.edit')}
                onChange={(event) =>
                  store.mutate(item.id, { priority: Number(event.target.value) })
                }
              >
                {[4, 3, 2, 1, 0].map((level) => (
                  <option key={level} value={level}>
                    {SAMPLE_PRIORITIES[level] ?? 'None'}
                  </option>
                ))}
              </select>
            </dd>
            <dt>
              <Users size={14} aria-hidden="true" /> Team
            </dt>
            <dd className="with-avatar">
              {team && <TeamTile id={team.id} name={team.name} size={18} />}
              {team?.name ?? item.teamId}
            </dd>
            <dt>
              <Shapes size={14} aria-hidden="true" /> Kind
            </dt>
            <dd className="with-avatar">
              <KindIcon kind={item.kind} />
              {item.kind[0]?.toUpperCase() + item.kind.slice(1)}
            </dd>
            {otherFields.map(([key, value]) => (
              <div key={key} className="details-pair">
                <dt>
                  <Tag size={14} aria-hidden="true" /> {key}
                </dt>
                <dd>{String(value ?? '')}</dd>
              </div>
            ))}
            <dt>
              <CalendarClock size={14} aria-hidden="true" /> Created
            </dt>
            <dd>{timeAgo(item.createdAt)}</dd>
          </dl>
          <RecordCard api={api} store={store} item={item} onOpenRecord={onOpenRecord} />
        </aside>
      </div>
    </main>
  )
}

interface MoveMenuItem {
  readonly key: string
  readonly label: string
  readonly danger?: boolean
  /** Null shows the entry but disabled, with the reason in its label. */
  readonly run: (() => void) | null
}

/** A small menu of less common moves, so the page has one obvious main button. */
function MoveMenu({
  label,
  items,
  disabled,
}: {
  label: string
  items: readonly MoveMenuItem[]
  disabled: boolean
}) {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (!open) return
    const close = (event: KeyboardEvent | MouseEvent) => {
      if (event instanceof KeyboardEvent) {
        if (event.key !== 'Escape') return
        // Close the menu only; Escape must not also leave the page.
        event.stopPropagation()
        setOpen(false)
      } else if (!(event.target as HTMLElement).closest('.move-menu')) setOpen(false)
    }
    document.addEventListener('keydown', close)
    document.addEventListener('mousedown', close)
    return () => {
      document.removeEventListener('keydown', close)
      document.removeEventListener('mousedown', close)
    }
  }, [open])
  return (
    <div className="move-menu">
      <button
        type="button"
        className="button"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
      >
        {label} <ChevronDown size={14} aria-hidden="true" />
      </button>
      {open && (
        <div className="menu" role="menu">
          {items.map((entry) => (
            <button
              key={entry.key}
              type="button"
              role="menuitem"
              className={entry.danger ? 'menu-item menu-danger' : 'menu-item'}
              disabled={entry.run === null}
              onClick={() => {
                setOpen(false)
                entry.run?.()
              }}
            >
              {entry.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
