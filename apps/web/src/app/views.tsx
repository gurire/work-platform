import { useMemo, useState } from 'react'
import { STAGE_TYPES } from '@wm/shared'
import {
  Avatar,
  Button,
  Card,
  EmptyState,
  Field,
  ProgressBar,
  SplitBar,
  StatusTag,
  Tabs,
} from '../design/components'
import { viewsApi, type IntakeForm, type RequestView } from './core-api'
import { nameOf, useAppData, useLoad } from './data'
import { hrefFor } from './routes'
import { shortDate } from './work'

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

function TeamFilter({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { teams } = useAppData()
  return (
    <label className="mx-row md-meta">
      Team
      <select
        className="md-select mx-select-inline"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">All teams</option>
        {teams.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </select>
    </label>
  )
}

/* ---------- Calendar and workload ---------- */

export function PlanPage() {
  const [mode, setMode] = useState<'calendar' | 'workload'>('calendar')
  const [team, setTeam] = useState('')
  return (
    <div className="mx-page mx-page-wide">
      <header className="mx-page-head mx-head-row">
        <h1 className="md-h1">{mode === 'calendar' ? 'Calendar' : 'Workload'}</h1>
        <div className="mx-row">
          <Tabs
            label="View"
            variant="segmented"
            value={mode}
            onChange={setMode}
            options={[
              { id: 'calendar', label: 'Calendar' },
              { id: 'workload', label: 'Workload' },
            ]}
          />
          <TeamFilter value={team} onChange={setTeam} />
        </div>
      </header>
      {mode === 'calendar' ? <Calendar team={team} /> : <Workload team={team} />}
    </div>
  )
}

function Calendar({ team }: { team: string }) {
  const [month, setMonth] = useState(() => {
    const d = new Date()
    return new Date(d.getFullYear(), d.getMonth(), 1)
  })
  const first = new Date(month.getFullYear(), month.getMonth(), 1)
  const start = new Date(first)
  start.setDate(1 - ((first.getDay() + 6) % 7))
  const days = Array.from(
    { length: 42 },
    (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i),
  )
  const from = iso(days[0] as Date)
  const to = iso(days[41] as Date)
  const data = useLoad(() => viewsApi.calendar(from, to, team || undefined), `${from}:${team}`)
  const today = iso(new Date())
  const byDay = useMemo(() => {
    const map = new Map<
      string,
      { key: string; label: string; href: string; milestone: boolean; done: boolean }[]
    >()
    for (const m of data.data?.milestones ?? [])
      map.set(m.dueOn, [
        ...(map.get(m.dueOn) ?? []),
        {
          key: m.id,
          label: `⚑ ${m.name}`,
          href: hrefFor({ page: 'project', id: m.projectId }),
          milestone: true,
          done: false,
        },
      ])
    for (const i of data.data?.items ?? [])
      map.set(i.dueOn, [
        ...(map.get(i.dueOn) ?? []),
        {
          key: i.id,
          label: `${i.key} ${i.title}`,
          href: hrefFor({ page: 'item', key: i.key }),
          milestone: false,
          done: i.stageType === 'done',
        },
      ])
    return map
  }, [data.data])
  return (
    <Card className="mx-list-group">
      <div className="mx-cal-head">
        <div className="mx-row">
          <Button
            size="s"
            aria-label="Previous month"
            onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}
          >
            ‹
          </Button>
          <Button
            size="s"
            aria-label="Next month"
            onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}
          >
            ›
          </Button>
        </div>
        <span className="md-strong">
          {month.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}
        </span>
        <span className="mx-row md-meta">
          <span className="mx-legend-swatch mx-cal-item" /> Item due{' '}
          <span className="mx-legend-swatch mx-cal-milestone" /> Milestone
        </span>
      </div>
      <div className="mx-table-wrap mx-cal-wrap">
        <div className="mx-cal">
          {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
            <div key={d} className="mx-cal-dow">
              {d}
            </div>
          ))}
          {days.map((d) => {
            const key = iso(d)
            const entries = byDay.get(key) ?? []
            return (
              <div
                key={key}
                className={
                  d.getMonth() === month.getMonth() ? 'mx-cal-day' : 'mx-cal-day mx-cal-other'
                }
              >
                <span className={key === today ? 'mx-cal-num mx-cal-today' : 'mx-cal-num'}>
                  {d.getDate()}
                </span>
                {entries.slice(0, 4).map((e) => (
                  <a
                    key={e.key}
                    href={e.href}
                    className={
                      e.milestone
                        ? 'mx-cal-entry mx-cal-milestone'
                        : e.done
                          ? 'mx-cal-entry mx-cal-done'
                          : 'mx-cal-entry mx-cal-item'
                    }
                    title={e.label}
                  >
                    {e.label}
                  </a>
                ))}
                {entries.length > 4 ? (
                  <span className="md-meta">+{entries.length - 4} more</span>
                ) : null}
              </div>
            )
          })}
        </div>
      </div>
      {data.error ? <p className="mx-pad md-field-error">{data.error}</p> : null}
    </Card>
  )
}

function Workload({ team }: { team: string }) {
  const data = useLoad(() => viewsApi.workload(team || undefined, 4), `wl:${team}`)
  const wl = data.data
  return (
    <div className="mx-table-wrap">
      <table className="mx-table">
        <thead>
          <tr>
            <th scope="col">Person</th>
            {wl?.weekStarts.map((w) => (
              <th key={w} scope="col">
                Week of {shortDate(w)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {wl?.people.map((p) => (
            <tr key={p.id}>
              <th scope="row">
                <span className="mx-row">
                  <Avatar name={p.name} size={24} />
                  <span>
                    <span className="mx-block">{p.name}</span>
                    <span className="md-meta">{p.teams.join(', ')}</span>
                  </span>
                </span>
              </th>
              {p.weeks.map((w, i) => {
                const over = w.load > p.capacity
                return (
                  <td key={i}>
                    <div className="mx-stack mx-tight">
                      <ProgressBar
                        label={`${p.name}, week ${i + 1}`}
                        value={w.load}
                        max={p.capacity}
                        over={over}
                      />
                      <span className={over ? 'md-field-error' : 'md-meta'}>
                        {w.load} of {p.capacity} {p.unit === 'points' ? 'pts' : 'h'}
                        {over ? ` · over by ${w.load - p.capacity}` : ''} · {w.items} items
                      </span>
                    </div>
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {wl && wl.people.length === 0 ? (
        <p className="mx-pad md-meta">Nobody has dated, estimated work in these weeks.</p>
      ) : null}
      <p className="mx-pad md-meta">
        Load is the estimate of open items with a due date in that week. Capacity is set per team.
      </p>
    </div>
  )
}

/* ---------- Dashboard ---------- */

export function DashboardPage() {
  const { teams, people } = useAppData()
  const [team, setTeam] = useState('')
  const data = useLoad(() => viewsApi.dashboard(team || undefined), `dash:${team}`)
  const d = data.data
  const max = Math.max(1, ...(d?.people ?? []).map((p) => p.waiting + p.doing + p.review))
  return (
    <div className="mx-page mx-page-wide">
      <header className="mx-page-head mx-head-row">
        <div>
          <h1 className="md-h1">Dashboard</h1>
          <p className="mx-intro">How far along each project is, and who has what.</p>
        </div>
        <TeamFilter value={team} onChange={setTeam} />
      </header>
      {data.error ? <p className="md-field-error">{data.error}</p> : null}
      <div className="mx-tiles">
        {[
          ['Open items', d?.tiles.open],
          ['Done in the last 7 days', d?.tiles.doneThisWeek],
          ['Waiting on review', d?.tiles.inReview],
          ['Stuck 5+ days', d?.tiles.stuck],
        ].map(([label, value]) => (
          <Card key={String(label)} className="mx-tile">
            <span className="md-meta">{label}</span>
            <span className="mx-tile-num">{value ?? '–'}</span>
          </Card>
        ))}
      </div>
      <div className="mx-settings-grid">
        <Card className="mx-stack">
          <h2 className="md-h2">Project progress</h2>
          {d?.projects.length === 0 ? <p className="md-meta">No project has items yet.</p> : null}
          {d?.projects.map((p) => (
            <a key={p.id} href={hrefFor({ page: 'project', id: p.id })} className="mx-dash-project">
              <span className="mx-row mx-spread">
                <span className="md-strong">{p.name}</span>
                <span className="md-meta">
                  {p.progress.percent}% · {p.progress.done} of {p.progress.total}
                </span>
              </span>
              <SplitBar counts={p.progress.counts} />
            </a>
          ))}
        </Card>
        <Card className="mx-stack">
          <h2 className="md-h2">Who has what</h2>
          <span className="mx-row md-meta">
            {STAGE_TYPES.filter((t) => t !== 'done').map((t) => (
              <StatusTag key={t} type={t} />
            ))}
          </span>
          {d?.people.map((p) => {
            const total = p.waiting + p.doing + p.review
            return (
              <div key={p.id} className="mx-who">
                <span className="mx-who-name">{p.name}</span>
                <span
                  className="mx-who-bar"
                  role="img"
                  aria-label={`${p.name}: waiting ${p.waiting}, doing ${p.doing}, review ${p.review}`}
                >
                  {p.waiting ? (
                    <span className="md-split-seg md-seg-waiting" style={{ flexGrow: p.waiting }} />
                  ) : null}
                  {p.doing ? (
                    <span className="md-split-seg md-seg-doing" style={{ flexGrow: p.doing }} />
                  ) : null}
                  {p.review ? (
                    <span className="md-split-seg md-seg-review" style={{ flexGrow: p.review }} />
                  ) : null}
                  <span style={{ flexGrow: max - total }} />
                </span>
                <span className="mx-num md-meta">{total}</span>
              </div>
            )
          })}
        </Card>
      </div>
      <Card className="mx-list-group">
        <h2 className="mx-list-head">Stuck — no stage change in 5+ days</h2>
        {d?.stuck.length === 0 ? <p className="mx-pad md-meta">Nothing is stuck.</p> : null}
        {d?.stuck.map((s) => {
          const t = teams.find((x) => x.id === s.teamId)
          const stage = t?.stages.find((x) => x.key === s.stageKey)
          return (
            <a
              key={s.id}
              href={hrefFor({ page: 'item', key: s.key })}
              className="mx-list-row mx-link-row"
            >
              <span className="md-meta mx-key">{s.key}</span>
              <span className="mx-grow">{s.title}</span>
              {stage ? <StatusTag type={stage.type} name={stage.name} /> : null}
              <span className="md-meta">{nameOf(people, s.assigneeId) ?? 'Nobody'}</span>
              <span className="md-overdue-tag">{s.days} days</span>
            </a>
          )
        })}
      </Card>
    </div>
  )
}

/* ---------- Requests: forms, my requests and triage ---------- */

const STATUS_TEXT: Record<RequestView['status'], string> = {
  new: 'New',
  needs_info: 'Needs more information',
  accepted: 'Accepted',
  declined: 'Declined',
}

export function RequestsPage() {
  const { me, teams } = useAppData()
  // Org admins can sort any team's requests (they count as admin of every team).
  const myTeams =
    me?.orgRole === 'org_admin'
      ? teams
      : teams.filter((t) => t.members.some((m) => m.userId === me?.id))
  const [tab, setTab] = useState<string>('ask')
  const forms = useLoad(() => viewsApi.forms(), 'forms')
  const mine = useLoad(() => viewsApi.myRequests(), 'my-requests')
  const [open, setOpen] = useState<IntakeForm | null>(null)
  return (
    <div className="mx-page">
      <header className="mx-page-head">
        <h1 className="md-h1">Requests</h1>
        <p className="mx-intro">
          Ask any team for help with their form; each team sorts its requests in triage.
        </p>
      </header>
      <Tabs
        label="Requests"
        value={tab}
        onChange={setTab}
        options={[
          { id: 'ask', label: 'Ask for help' },
          { id: 'mine', label: 'My requests', count: mine.data?.length },
          ...myTeams.map((t) => ({ id: `team:${t.id}`, label: `Triage · ${t.name}` })),
        ]}
      />
      {tab === 'ask' ? (
        open ? (
          <RequestForm
            form={open}
            onDone={() => {
              setOpen(null)
              setTab('mine')
              mine.reload()
            }}
            onCancel={() => setOpen(null)}
          />
        ) : (
          <div className="mx-form-grid">
            {forms.data?.length === 0 ? (
              <EmptyState
                title="No forms yet"
                text="A team admin can add one in Team settings › Forms."
              />
            ) : null}
            {forms.data?.map((f) => (
              <button key={f.id} type="button" className="mx-card" onClick={() => setOpen(f)}>
                <span className="md-meta">{f.teamName}</span>
                <span className="mx-card-title">{f.name}</span>
                {f.intro ? <span className="md-meta">{f.intro}</span> : null}
              </button>
            ))}
          </div>
        )
      ) : null}
      {tab === 'mine' ? (
        <Card className="mx-list-group">
          {mine.data?.length === 0 ? (
            <p className="mx-pad md-meta">You have not asked for anything yet.</p>
          ) : null}
          {mine.data?.map((r) => (
            <div key={r.id} className="mx-list-row mx-static">
              <span className="mx-grow">
                <span className="mx-block md-strong">{r.title}</span>
                <span className="md-meta">
                  {r.formName} · {shortDate(r.createdAt.slice(0, 10))}
                  {r.note ? ` · “${r.note}”` : ''}
                </span>
              </span>
              <span
                className={
                  r.status === 'accepted'
                    ? 'mx-ok'
                    : r.status === 'declined'
                      ? 'md-field-error'
                      : 'md-meta'
                }
              >
                {STATUS_TEXT[r.status]}
              </span>
              {r.itemKey ? (
                <a href={hrefFor({ page: 'item', key: r.itemKey })}>{r.itemKey}</a>
              ) : null}
            </div>
          ))}
        </Card>
      ) : null}
      {tab.startsWith('team:') ? <Triage teamId={tab.slice(5)} /> : null}
    </div>
  )
}

function RequestForm({
  form,
  onDone,
  onCancel,
}: {
  form: IntakeForm
  onDone: () => void
  onCancel: () => void
}) {
  const [title, setTitle] = useState('')
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  return (
    <Card className="mx-stack mx-narrow">
      <span className="md-meta">{form.teamName}</span>
      <h2 className="md-h2">{form.name}</h2>
      {form.intro ? <p className="mx-intro">{form.intro}</p> : null}
      <Field label="What do you need?">
        {({ id }) => (
          <input
            id={id}
            className="md-input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        )}
      </Field>
      {form.questions.map((q) => (
        <Field key={q.key} label={`${q.label}${q.required ? ' *' : ''}`}>
          {({ id }) =>
            q.type === 'long_text' ? (
              <textarea
                id={id}
                className="md-textarea"
                value={answers[q.key] ?? ''}
                onChange={(e) => setAnswers({ ...answers, [q.key]: e.target.value })}
              />
            ) : q.type === 'pick_one' ? (
              <select
                id={id}
                className="md-select"
                value={answers[q.key] ?? ''}
                onChange={(e) => setAnswers({ ...answers, [q.key]: e.target.value })}
              >
                <option value="">Choose…</option>
                {q.options?.map((o) => (
                  <option key={o}>{o}</option>
                ))}
              </select>
            ) : (
              <input
                id={id}
                className="md-input"
                type={q.type === 'date' ? 'date' : 'text'}
                value={answers[q.key] ?? ''}
                onChange={(e) => setAnswers({ ...answers, [q.key]: e.target.value })}
              />
            )
          }
        </Field>
      ))}
      {error ? <span className="md-field-error">{error}</span> : null}
      <div className="mx-row">
        <Button
          kind="primary"
          disabled={!title.trim()}
          onClick={async () => {
            setError(null)
            try {
              await viewsApi.submit(form.id, title.trim(), answers)
              onDone()
            } catch (e) {
              setError(e instanceof Error ? e.message : String(e))
            }
          }}
        >
          Send request
        </Button>
        <Button onClick={onCancel}>Cancel</Button>
      </div>
    </Card>
  )
}

function Triage({ teamId }: { teamId: string }) {
  const { people, projects } = useAppData()
  const list = useLoad(() => viewsApi.teamRequests(teamId), `triage:${teamId}`)
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [project, setProject] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const act = async (fn: () => Promise<unknown>) => {
    setError(null)
    try {
      await fn()
      list.reload()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }
  return (
    <div className="mx-stack">
      {error ? <span className="md-field-error">{error}</span> : null}
      {list.data?.length === 0 ? (
        <Card>
          <EmptyState title="Nothing to triage" text="New requests to this team show up here." />
        </Card>
      ) : null}
      {list.data?.map((r) => (
        <Card key={r.id} className="mx-stack">
          <div className="mx-row mx-spread">
            <span>
              <span className="mx-block md-strong">{r.title}</span>
              <span className="md-meta">
                {nameOf(people, r.requesterId)} · {r.formName} ·{' '}
                {shortDate(r.createdAt.slice(0, 10))}
              </span>
            </span>
            <span
              className={
                r.status === 'accepted'
                  ? 'mx-ok'
                  : r.status === 'declined'
                    ? 'md-field-error'
                    : 'md-meta'
              }
            >
              {STATUS_TEXT[r.status]}
              {r.itemKey ? ` → ${r.itemKey}` : ''}
            </span>
          </div>
          <dl className="mx-props">
            {r.answers.map((a) => (
              <div key={a.label} className="mx-contents">
                <dt>{a.label}</dt>
                <dd>{a.value}</dd>
              </div>
            ))}
          </dl>
          {r.note ? <p className="md-meta">Note: {r.note}</p> : null}
          {r.status === 'new' || r.status === 'needs_info' ? (
            <div className="mx-row">
              <select
                className="md-select mx-select-inline"
                aria-label="Project for the new item"
                value={project[r.id] ?? ''}
                onChange={(e) => setProject({ ...project, [r.id]: e.target.value })}
              >
                <option value="">No project</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <Button
                kind="primary"
                size="s"
                onClick={() => act(() => viewsApi.accept(r.id, project[r.id] || null))}
              >
                Accept
              </Button>
              <input
                className="md-input mx-grow"
                aria-label="Note to the requester"
                placeholder="Note for asking or declining"
                value={notes[r.id] ?? ''}
                onChange={(e) => setNotes({ ...notes, [r.id]: e.target.value })}
              />
              <Button
                size="s"
                disabled={!notes[r.id]?.trim()}
                onClick={() => act(() => viewsApi.ask(r.id, notes[r.id] ?? ''))}
              >
                Ask for info
              </Button>
              <Button
                size="s"
                kind="danger"
                disabled={!notes[r.id]?.trim()}
                onClick={() => act(() => viewsApi.decline(r.id, notes[r.id] ?? ''))}
              >
                Decline
              </Button>
            </div>
          ) : null}
        </Card>
      ))}
    </div>
  )
}
