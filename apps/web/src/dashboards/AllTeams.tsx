/**
 * The cross-team view (specs/dashboards.md, section 6). Only teams the viewer can see.
 */
import { useCallback, useEffect, useState } from 'react'
import type { HealthStatus, StageKind, Trend } from '@wm/shared'
import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  CircleCheck,
  OctagonAlert,
  RefreshCw,
  TriangleAlert,
} from 'lucide-react'
import type { Api, TeamsDashboard } from '../items/api'
import { TeamTile } from '../ui/kit'
import { Card, Kpi } from './TeamDashboard'

const STATUS: Record<HealthStatus, { label: string; Icon: typeof CircleCheck; className: string }> =
  {
    on_track: { label: 'On track', Icon: CircleCheck, className: 'status-good' },
    watch: { label: 'Watch', Icon: TriangleAlert, className: 'status-warn' },
    at_risk: { label: 'At risk', Icon: OctagonAlert, className: 'status-bad' },
  }

const KIND_NAMES: Record<StageKind, string> = {
  waiting: 'Waiting',
  working: 'Working',
  review: 'Review',
  release: 'Release',
}

/** Is this trend good news? Cycle time going up is bad; finishing more is good. */
function TrendMark({ trend, upIsGood, what }: { trend: Trend; upIsGood: boolean; what: string }) {
  const Icon = trend === 'up' ? ArrowUpRight : trend === 'down' ? ArrowDownRight : ArrowRight
  const good = trend === 'level' ? null : (trend === 'up') === upIsGood
  const word = trend === 'level' ? 'level' : trend === 'up' ? 'up' : 'down'
  return (
    <span className={good === null ? 'trend' : good ? 'trend trend-good' : 'trend trend-bad'}>
      <Icon size={14} aria-hidden="true" />
      <span className="sr-only">
        {what} {word} on the period before
      </span>
    </span>
  )
}

function heatLevel(percent: number | null | undefined): number {
  if (percent === null || percent === undefined) return -1
  if (percent <= 100) return 0
  return Math.min(4, Math.ceil((percent - 100) / 40))
}

export function AllTeams({ api, onOpenTeam }: { api: Api; onOpenTeam: (teamId: string) => void }) {
  const [data, setData] = useState<TeamsDashboard | null>(null)
  const [error, setError] = useState<string | null>(null)
  const load = useCallback(() => {
    setError(null)
    api
      .dashboards()
      .then(setData, (e: unknown) => setError(e instanceof Error ? e.message : 'could not load'))
  }, [api])
  useEffect(load, [load])

  if (error)
    return (
      <main className="dash">
        <p className="dash-empty">Could not load: {error}</p>
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

  const atRisk = data.teams.filter((t) => t.status === 'at_risk').length
  const past = data.teams.reduce((sum, t) => sum + t.pastTarget, 0)
  const done = Math.round(data.teams.reduce((sum, t) => sum + t.donePerWeek, 0))
  const open = data.teams.reduce((sum, t) => sum + t.open, 0)
  const kinds = data.kinds.filter((kind) =>
    data.teams.some((t) => t.stuck[kind] !== null && t.stuck[kind] !== undefined),
  )

  return (
    <main className="dash" aria-labelledby="all-title">
      <header className="dash-head">
        <div>
          <h1 id="all-title">All teams</h1>
          <p className="muted">
            {data.teams.length} team{data.teams.length === 1 ? '' : 's'} you can see · worked out at{' '}
            {new Date(data.computedAt).toLocaleTimeString('en-GB', {
              hour: '2-digit',
              minute: '2-digit',
            })}
          </p>
        </div>
        <div className="dash-actions">
          <button type="button" className="button" onClick={load}>
            <RefreshCw size={14} aria-hidden="true" /> Refresh
          </button>
        </div>
      </header>

      <section className="kpis" aria-label="Headline numbers">
        <Kpi label="Teams at risk" value={String(atRisk)} bad={atRisk > 0} />
        <Kpi label="Open items" value={open.toLocaleString()} />
        <Kpi label="Finished per week" value={String(done)} note="average, last 4 weeks" />
        <Kpi label="Past stage target" value={String(past)} bad={past > 0} />
      </section>

      <div className="dash-grid">
        <Card
          wide
          title="Team health"
          note="One row per team. Arrows compare with the period before; red means it got worse."
        >
          <div className="health" role="table" aria-label="Team health">
            <div role="row" className="health-row health-head">
              <span role="columnheader">Team</span>
              <span role="columnheader">Status</span>
              <span role="columnheader">85% finish within</span>
              <span role="columnheader">Finished / week</span>
              <span role="columnheader">Past target</span>
              <span role="columnheader">Review rounds</span>
            </div>
            {data.teams.map((t) => {
              const s = STATUS[t.status]
              return (
                <div role="row" key={t.team.id} className="health-row">
                  <span role="rowheader">
                    <button
                      type="button"
                      className="team-link"
                      onClick={() => onOpenTeam(t.team.id)}
                    >
                      <TeamTile id={t.team.id} name={t.team.name} size={20} />
                      {t.team.name}
                    </button>
                  </span>
                  <span role="cell" className={`status ${s.className}`}>
                    <s.Icon size={15} aria-hidden="true" />
                    {s.label}
                  </span>
                  <span role="cell" className="num">
                    {t.cycle85 === null ? '–' : `${Math.ceil(t.cycle85)} d`}
                    <TrendMark trend={t.cycleTrend} upIsGood={false} what="Cycle time" />
                  </span>
                  <span role="cell" className="num">
                    {t.donePerWeek}
                    <TrendMark trend={t.doneTrend} upIsGood what="Finished per week" />
                  </span>
                  <span role="cell" className="num">
                    {t.pastTarget} <span className="muted">of {t.open}</span>
                  </span>
                  <span role="cell" className="num">
                    {t.reviewRounds ?? '–'}
                  </span>
                </div>
              )
            })}
          </div>
        </Card>

        <Card
          wide
          title="Where work is stuck"
          note="Typical time waiting in each kind of stage, as a share of that stage's target. Over 100% means past target; darker is further over."
        >
          {kinds.length === 0 ? (
            <p className="dash-empty">
              No stages have waiting targets yet. Team admins can set them on the board.
            </p>
          ) : (
            <div
              className="heat"
              role="table"
              aria-label="Median waiting time against target, by team and stage kind"
            >
              <div
                role="row"
                className="heat-row heat-head"
                style={{ gridTemplateColumns: `180px repeat(${kinds.length}, minmax(0, 1fr))` }}
              >
                <span role="columnheader">Team</span>
                {kinds.map((kind) => (
                  <span role="columnheader" key={kind}>
                    {KIND_NAMES[kind]}
                  </span>
                ))}
              </div>
              {data.teams.map((t) => (
                <div
                  role="row"
                  key={t.team.id}
                  className="heat-row"
                  style={{ gridTemplateColumns: `180px repeat(${kinds.length}, minmax(0, 1fr))` }}
                >
                  <span role="rowheader" className="person">
                    <TeamTile id={t.team.id} name={t.team.name} size={18} />
                    <span>{t.team.name}</span>
                  </span>
                  {kinds.map((kind) => {
                    const value = t.stuck[kind]
                    const level = heatLevel(value)
                    return (
                      <span
                        role="cell"
                        key={kind}
                        className={level < 0 ? 'heat-cell heat-none' : `heat-cell stuck-${level}`}
                      >
                        {value === null || value === undefined ? (
                          <span className="sr-only">No target</span>
                        ) : (
                          `${value}%`
                        )}
                      </span>
                    )
                  })}
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </main>
  )
}
