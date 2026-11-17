/**
 * One team's dashboard (specs/dashboards.md, section 3).
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { forecastHowMany, forecastWhen, localDay } from '@wm/shared'
import { LayoutGrid, RefreshCw } from 'lucide-react'
import type { Api, ApiTeam, ApiUser, TeamDashboard as Data } from '../items/api'
import { Avatar, TeamTile } from '../ui/kit'
import {
  Columns,
  DataTable,
  DotColumns,
  FlowChart,
  TimeScatter,
  shortDate,
  type Band,
} from './charts'

interface Props {
  api: Api
  teamId: string
  teams: readonly ApiTeam[]
  users: readonly ApiUser[]
  onOpenItem: (key: string) => void
  onTeamChange: (teamId: string) => void
  onOpenAllTeams: () => void
}

const DAY = 86_400_000

/** Lighter for early stages, full teal for done: one hue, light to dark. */
function bandColor(index: number, count: number): string {
  const share = count <= 1 ? 100 : Math.round(28 + (72 * index) / (count - 1))
  return `color-mix(in oklab, var(--seq-hue) ${share}%, var(--seq-base))`
}

export function TeamDashboard({
  api,
  teamId,
  teams,
  users,
  onOpenItem,
  onTeamChange,
  onOpenAllTeams,
}: Props) {
  const [data, setData] = useState<Data | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [count, setCount] = useState<number | null>(null)
  const [weeks, setWeeks] = useState(4)
  const team = teams.find((t) => t.id === teamId)
  const names = useMemo(() => new Map(users.map((u) => [u.id, u.name])), [users])

  const load = useCallback(() => {
    setError(null)
    api
      .dashboard(teamId)
      .then(setData, (e: unknown) => setError(e instanceof Error ? e.message : 'could not load'))
  }, [api, teamId])
  useEffect(load, [load])

  if (error)
    return (
      <main className="dash">
        <p className="dash-empty">Could not load the dashboard: {error}</p>
      </main>
    )
  if (!data)
    return (
      <main className="dash">
        <p className="dash-empty" role="status">
          Working out the numbers…
        </p>
      </main>
    )

  const stageName = (key: string) => data.stages.find((s) => s.key === key)?.name ?? key
  const flowStages = data.flow.series.map((s) => s.stageKey)
  const bands: Band[] = data.flow.series.map((s, i) => ({
    key: s.stageKey,
    name: stageName(s.stageKey),
    color: bandColor(i, data.flow.series.length),
    counts: s.counts,
  }))
  const working = data.stages.filter((s) => s.category === 'in_progress' || s.category === 'todo')
  const ageingStages = working.filter(
    (s) => data.ageing.some((a) => a.stageKey === s.key) || s.category === 'in_progress',
  )
  const now = new Date(data.computedAt).getTime()
  const from = new Date(`${data.throughput[0]?.week ?? data.week}T00:00:00Z`).getTime()
  const seed = `${data.team.id}:${localDay(now)}`
  const remaining = count ?? Math.min(30, Math.max(1, data.remainingOpen))
  const when = forecastWhen(data.forecastBasis, remaining, seed)
  const howMany = forecastHowMany(data.forecastBasis, weeks, seed)
  const inProgress = data.stages.filter((s) => s.category === 'in_progress')
  const maxLoad = Math.max(1, ...data.workload.flatMap((w) => Object.values(w.counts)))
  const workload = [...data.workload].sort((a, b) =>
    a.assigneeId === null
      ? 1
      : b.assigneeId === null
        ? -1
        : (names.get(a.assigneeId) ?? '').localeCompare(names.get(b.assigneeId) ?? ''),
  )

  return (
    <main className="dash" aria-labelledby="dash-title">
      <header className="dash-head">
        <TeamTile id={data.team.id} name={data.team.name} size={28} />
        <div>
          <h1 id="dash-title">{data.team.name} dashboard</h1>
          <p className="muted">
            Last 8 weeks · worked out at{' '}
            {new Date(data.computedAt).toLocaleTimeString('en-GB', {
              hour: '2-digit',
              minute: '2-digit',
            })}
          </p>
        </div>
        <div className="dash-actions">
          <label className="muted">
            Team{' '}
            <select value={teamId} onChange={(e) => onTeamChange(e.target.value)}>
              {teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="button" onClick={load}>
            <RefreshCw size={14} aria-hidden="true" /> Refresh
          </button>
          <button type="button" className="button" onClick={onOpenAllTeams}>
            <LayoutGrid size={14} aria-hidden="true" /> All teams
          </button>
        </div>
      </header>

      <section className="kpis" aria-label="Headline numbers">
        <Kpi label="Open items" value={String(data.headline.open)} />
        <Kpi label="Finished this week" value={String(data.headline.finishedThisWeek)} />
        <Kpi
          label="85% finish within"
          value={data.headline.cycle85 === null ? '–' : `${Math.ceil(data.headline.cycle85)} d`}
          note="cycle time, last 8 weeks"
        />
        <Kpi
          label="Past stage target"
          value={String(data.headline.pastTarget)}
          bad={data.headline.pastTarget > 0}
        />
      </section>

      <div className="dash-grid">
        <Card
          wide
          title="Cumulative flow"
          note="Items in each stage, day by day. A band that keeps getting wider is a queue building up."
        >
          <div className="legend" aria-hidden="true">
            {bands.map((b) => (
              <span key={b.key}>
                <i style={{ background: b.color }} />
                {b.name}
              </span>
            ))}
          </div>
          <FlowChart
            days={data.flow.days}
            bands={bands}
            label={`Cumulative flow for ${data.team.name} over the last ${data.flow.days.length} days.`}
          />
          <DataTable
            headers={['Day', ...flowStages.map(stageName)]}
            rows={data.flow.days.map((day, d) => [
              shortDate(day),
              ...data.flow.series.map((s) => s.counts[d] ?? 0),
            ])}
          />
        </Card>

        <Card
          title="Time in stage against target"
          note="Each dot is an open item. Red dots have waited longer than the stage's target (dashed line)."
        >
          <DotColumns
            columns={ageingStages.map((s) => s.name)}
            targets={ageingStages.map((s) =>
              s.targetHours === null ? null : Math.round((s.targetHours / 24) * 10) / 10,
            )}
            unit="d"
            label={`Open items by stage and days in stage. ${data.headline.pastTarget} are past target.`}
            dots={data.ageing.flatMap((a) => {
              const column = ageingStages.findIndex((s) => s.key === a.stageKey)
              if (column < 0) return []
              return [
                {
                  key: a.key,
                  column,
                  value: Math.round((a.waitingHours / 24) * 10) / 10,
                  bad: a.pastTarget,
                  tip: (
                    <>
                      <strong>{a.key}</strong>
                      <span>{a.title}</span>
                      <span>
                        {Math.round((a.waitingHours / 24) * 10) / 10} d in {stageName(a.stageKey)}
                        {a.pastTarget ? ' · past target' : ''}
                      </span>
                      <span>{a.ageDays} d since started</span>
                    </>
                  ),
                },
              ]
            })}
          />
          <DataTable
            headers={['Item', 'Stage', 'Days in stage', 'Days since started', 'Past target']}
            rows={[...data.ageing]
              .sort((a, b) => b.waitingHours - a.waitingHours)
              .map((a) => [
                a.key,
                stageName(a.stageKey),
                Math.round((a.waitingHours / 24) * 10) / 10,
                a.ageDays,
                a.pastTarget ? 'Yes' : 'No',
              ])}
          />
        </Card>

        <Card
          title="Cycle time spread"
          note="Each dot is a finished item. 85% finish under the dashed line: that is the number to promise."
        >
          <TimeScatter
            from={from}
            to={now}
            unit="d"
            line={data.headline.cycle85}
            lineLabel={data.headline.cycle85 === null ? '' : `85%: ${data.headline.cycle85} d`}
            label={`Cycle times of ${data.cycle.length} finished items. 85th percentile ${data.headline.cycle85 ?? 'not available'} days.`}
            dots={data.cycle.map((c) => ({
              key: c.key,
              at: new Date(c.finishedAt).getTime(),
              value: c.days,
              tip: (
                <>
                  <strong>{c.key}</strong>
                  <span>{c.title}</span>
                  <span>
                    {c.days} d · finished{' '}
                    {new Date(c.finishedAt).toLocaleDateString('en-GB', {
                      day: 'numeric',
                      month: 'short',
                    })}
                  </span>
                </>
              ),
            }))}
          />
          <DataTable
            headers={['Item', 'Finished', 'Cycle time (days)']}
            rows={[...data.cycle]
              .sort((a, b) => b.days - a.days)
              .map((c) => [c.key, c.finishedAt.slice(0, 10), c.days])}
          />
        </Card>

        <Card
          title="Finished per week"
          note="Throughput. The current week is still in progress (lighter)."
        >
          <Columns
            labels={data.throughput.map((w) => shortDate(w.week))}
            values={data.throughput.map((w) => w.count)}
            strong={(i) => i < data.throughput.length - 1}
            format={(v) => `${v} finished`}
            label={`Items finished per week: ${data.throughput.map((w) => w.count).join(', ')}.`}
          />
          <DataTable
            headers={['Week starting', 'Finished']}
            rows={data.throughput.map((w) => [w.week, w.count])}
          />
        </Card>

        <Card
          title="Forecast"
          note="From the last 12 complete weeks, run 10,000 times. No estimates needed."
        >
          {when && howMany ? (
            <>
              <div className="forecast-q">
                <label>
                  When will{' '}
                  <input
                    type="number"
                    min={1}
                    max={999}
                    value={remaining}
                    onChange={(e) =>
                      setCount(Math.max(1, Math.min(999, Number(e.target.value) || 1)))
                    }
                    aria-label="Number of items"
                  />{' '}
                  items be done?
                </label>
                <p className="forecast-a">
                  <b>{weekLabel(when.p85)}</b> with 85% confidence · 50%: {weekLabel(when.p50)} ·
                  95%: {weekLabel(when.p95)}
                </p>
              </div>
              <Columns
                height={130}
                labels={when.spread.map((_, i) => `W${i + 1}`)}
                values={when.spread.map((share) => Math.round(share * 100))}
                strong={(i) => i + 1 <= when.p85}
                format={(v) => `${v}% of runs finish this week`}
                label={`Forecast: 50% chance within ${when.p50} weeks, 85% within ${when.p85}, 95% within ${when.p95}.`}
              />
              <div className="forecast-q">
                <label>
                  How many in the next{' '}
                  <input
                    type="number"
                    min={1}
                    max={52}
                    value={weeks}
                    onChange={(e) =>
                      setWeeks(Math.max(1, Math.min(52, Number(e.target.value) || 1)))
                    }
                    aria-label="Number of weeks"
                  />{' '}
                  weeks?
                </label>
                <p className="forecast-a">
                  At least <b>{howMany.p85}</b> with 85% confidence · 95%: {howMany.p95} · 50%:{' '}
                  {howMany.p50}
                </p>
              </div>
            </>
          ) : (
            <p className="dash-empty">
              Not enough history yet. The forecast needs 4 complete weeks with finished items.
            </p>
          )}
        </Card>

        <Card
          wide
          title="Workload"
          note="Open items per person in each working stage. Load, not speed."
        >
          <div className="heat" role="table" aria-label="Open items per person and stage">
            <div
              role="row"
              className="heat-row heat-head"
              style={{
                gridTemplateColumns: `180px repeat(${inProgress.length}, minmax(0, 1fr)) 64px`,
              }}
            >
              <span role="columnheader">Person</span>
              {inProgress.map((s) => (
                <span role="columnheader" key={s.key}>
                  {s.name}
                </span>
              ))}
              <span role="columnheader">Total</span>
            </div>
            {workload.map((w) => {
              const name = w.assigneeId === null ? null : (names.get(w.assigneeId) ?? w.assigneeId)
              const total = Object.values(w.counts).reduce((sum, v) => sum + v, 0)
              return (
                <div
                  role="row"
                  key={w.assigneeId ?? 'none'}
                  className="heat-row"
                  style={{
                    gridTemplateColumns: `180px repeat(${inProgress.length}, minmax(0, 1fr)) 64px`,
                  }}
                >
                  <span role="rowheader" className="person">
                    <Avatar name={name} id={w.assigneeId} />
                    <span>{name ?? 'Unassigned'}</span>
                  </span>
                  {inProgress.map((s) => {
                    const v = w.counts[s.key] ?? 0
                    const level = v === 0 ? 0 : Math.min(5, Math.ceil((v / maxLoad) * 5))
                    return (
                      <span role="cell" key={s.key} className={`heat-cell heat-${level}`}>
                        {v}
                      </span>
                    )
                  })}
                  <span role="cell" className="heat-total">
                    {total}
                  </span>
                </div>
              )
            })}
          </div>
          <p className="muted dash-foot">
            Tip: click a dot or open an item from the tables to see why it is waiting.{' '}
            {data.ageing[0] && (
              <button
                type="button"
                className="link-button"
                onClick={() =>
                  onOpenItem(
                    data.ageing.reduce((a, b) => (b.waitingHours > a.waitingHours ? b : a)).key,
                  )
                }
              >
                Open the longest-waiting item
              </button>
            )}
          </p>
        </Card>
      </div>
      {team === undefined && <p className="muted">This team is not in your team list.</p>}
    </main>
  )
}

function weekLabel(weeks: number): string {
  const end = new Date(Date.now() + weeks * 7 * DAY)
  return `${weeks} week${weeks === 1 ? '' : 's'} (by ${end.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })})`
}

export function Kpi({
  label,
  value,
  note,
  bad,
}: {
  label: string
  value: string
  note?: string
  bad?: boolean
}) {
  return (
    <div className="kpi card">
      <span className="kpi-label">{label}</span>
      <span className={bad ? 'kpi-value kpi-bad' : 'kpi-value'}>{value}</span>
      {note && <span className="kpi-note">{note}</span>}
    </div>
  )
}

export function Card({
  title,
  note,
  wide,
  children,
}: {
  title: string
  note: string
  wide?: boolean
  children: React.ReactNode
}) {
  return (
    <section className={wide ? 'card dash-card dash-wide' : 'card dash-card'} aria-label={title}>
      <h2>{title}</h2>
      <p className="muted dash-note">{note}</p>
      {children}
    </section>
  )
}
