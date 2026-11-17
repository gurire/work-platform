/**
 * Dashboards (specs/dashboards.md). Numbers are worked out when asked for, from the same
 * tables lists use, and only for teams the principal may view (section 2).
 */
import type { FastifyInstance } from 'fastify'
import {
  cumulativeFlow,
  days,
  decide,
  effectiveStageKind,
  healthStatus,
  itemTimes,
  localDay,
  median,
  percentile,
  recentWeeks,
  STAGE_KINDS,
  startOfLocalDay,
  throughputByWeek,
  trendOf,
  weekOf,
  type Principal,
  type Stage,
  type StageEntry,
  type StageKind,
  type TeamRef,
} from '@wm/shared'
import type { Db } from '../db/db.js'
import { resolvePrincipal } from '../principal.js'

const DAY = 86_400_000
const WINDOW_WEEKS = 8
const FORECAST_WEEKS = 12

interface DashStage {
  readonly key: string
  readonly name: string
  readonly category: Stage['category']
  readonly position: number
  readonly kind: StageKind | null
  readonly kindSet: boolean
  readonly targetHours: number | null
}

interface DashItem {
  readonly id: string
  readonly key: string
  readonly title: string
  readonly statusId: string
  readonly assigneeId: string | null
  readonly createdAt: number
  readonly history: StageEntry[]
  /** When the item last entered its current stage. */
  readonly enteredCurrent: number
  readonly started: number | null
  readonly finished: number | null
}

interface TeamData {
  readonly team: TeamRef & { readonly name: string }
  readonly stages: DashStage[]
  readonly items: DashItem[]
  readonly reviewRounds: ReadonlyMap<string, number>
}

const ms = (value: Date | string): number => new Date(value).getTime()

export function registerDashboardRoutes(
  app: FastifyInstance,
  { db, devAuth }: { db: Db; devAuth: boolean },
): void {
  async function visibleTeams(principal: Principal) {
    const rows = await db.query<{ id: string; name: string; is_private: boolean }>(
      'SELECT id, name, is_private FROM teams ORDER BY name',
    )
    return rows
      .map((row) => ({ id: row.id, name: row.name, isPrivate: row.is_private }))
      .filter((team) => decide(principal, 'item.view', { team }).allowed)
  }

  async function loadTeamData(team: TeamRef & { name: string }): Promise<TeamData> {
    const stageRows = await db.query<{
      key: string
      name: string
      category: Stage['category']
      position: number
      kind: StageKind | null
      target_hours: number | null
    }>(
      'SELECT key, name, category, position, kind, target_hours FROM stages WHERE team_id = $1 ORDER BY position',
      [team.id],
    )
    const stages: DashStage[] = stageRows.map((row) => ({
      key: row.key,
      name: row.name,
      category: row.category,
      position: row.position,
      kind: effectiveStageKind(row),
      kindSet: row.kind !== null,
      targetHours: row.target_hours,
    }))
    const categoryOf = (key: string) => stages.find((stage) => stage.key === key)?.category

    const itemRows = await db.query<{
      id: string
      key: string
      title: string
      status_id: string
      assignee_id: string | null
      created_at: Date | string
    }>(
      `SELECT id, key, title, status_id, assignee_id, created_at FROM work_items
       WHERE team_id = $1 AND deleted_at IS NULL`,
      [team.id],
    )
    const historyRows = await db.query<{
      item_id: string
      stage_key: string
      entered_at: Date | string
      left_at: Date | string | null
    }>(
      `SELECT h.item_id, h.stage_key, h.entered_at, h.left_at FROM stage_history h
       JOIN work_items w ON w.id = h.item_id
       WHERE w.team_id = $1 AND w.deleted_at IS NULL`,
      [team.id],
    )
    const histories = new Map<string, StageEntry[]>()
    const current = new Map<string, number>()
    for (const row of historyRows) {
      const entry = { stageKey: row.stage_key, enteredAt: ms(row.entered_at) }
      histories.set(row.item_id, [...(histories.get(row.item_id) ?? []), entry])
      if (row.left_at === null) current.set(row.item_id, entry.enteredAt)
    }
    const items: DashItem[] = itemRows.map((row) => {
      const history = histories.get(row.id) ?? []
      const times = itemTimes(history, categoryOf)
      return {
        id: row.id,
        key: row.key,
        title: row.title,
        statusId: row.status_id,
        assigneeId: row.assignee_id,
        createdAt: ms(row.created_at),
        history,
        enteredCurrent: current.get(row.id) ?? ms(row.created_at),
        started: times.started,
        finished: times.finished,
      }
    })
    const rounds = await db.query<{ item_id: string; n: string }>(
      `SELECT r.item_id, count(*) AS n FROM review_rounds r
       JOIN work_items w ON w.id = r.item_id
       WHERE w.team_id = $1 GROUP BY r.item_id`,
      [team.id],
    )
    return {
      team,
      stages,
      items,
      reviewRounds: new Map(rounds.map((row) => [row.item_id, Number(row.n)])),
    }
  }

  function openItems(data: TeamData) {
    const working = new Set(
      data.stages
        .filter((s) => s.category === 'todo' || s.category === 'in_progress')
        .map((s) => s.key),
    )
    return data.items.filter((item) => working.has(item.statusId))
  }

  function pastTarget(data: TeamData, item: DashItem, now: number): boolean {
    const stage = data.stages.find((s) => s.key === item.statusId)
    return stage?.targetHours != null && now - item.enteredCurrent > stage.targetHours * 3_600_000
  }

  function cycleTimes(data: TeamData, from: number, to: number): number[] {
    return data.items
      .filter((item) => item.finished !== null && item.started !== null)
      .filter((item) => (item.finished ?? 0) >= from && (item.finished ?? 0) < to)
      .map((item) => days(item.started ?? 0, item.finished ?? 0))
  }

  /** Spec section 3. */
  function teamDashboard(data: TeamData, now: number) {
    const weeks = recentWeeks(now, WINDOW_WEEKS + 1)
    const windowStart = startOfLocalDay(weeks[0] ?? localDay(now))
    const open = openItems(data)
    const finishedTimes = data.items.flatMap((item) =>
      item.finished === null ? [] : [item.finished],
    )
    const finished = data.items.filter(
      (item) =>
        item.finished !== null && item.started !== null && (item.finished ?? 0) >= windowStart,
    )
    const cycles = finished.map((item) => days(item.started ?? 0, item.finished ?? 0))

    // One point per local day from the window start to today, taken at the end of the day.
    const dayList: string[] = []
    for (let t = windowStart; t <= now; t += DAY) dayList.push(localDay(t + DAY / 2))
    const ends = dayList.map((day) => Math.min(now, startOfLocalDay(day) + DAY - 1))
    const flow = cumulativeFlow(
      data.items.map((item) => item.history),
      data.stages,
      ends,
    )

    // Throughput for the forecast: the last 12 complete weeks, so not the current one.
    const basisWeeks = recentWeeks(now, FORECAST_WEEKS + 1).slice(0, FORECAST_WEEKS)
    const workingStages = data.stages.filter((s) => s.category === 'in_progress')

    const people = new Map<string | null, Record<string, number>>()
    for (const item of open) {
      if (!workingStages.some((s) => s.key === item.statusId)) continue
      const row = people.get(item.assigneeId) ?? {}
      row[item.statusId] = (row[item.statusId] ?? 0) + 1
      people.set(item.assigneeId, row)
    }

    return {
      team: { id: data.team.id, name: data.team.name },
      computedAt: new Date(now).toISOString(),
      week: weekOf(now),
      stages: data.stages.map((s) => ({
        key: s.key,
        name: s.name,
        category: s.category,
        kind: s.kind,
        kindSet: s.kindSet,
        targetHours: s.targetHours,
      })),
      headline: {
        open: open.length,
        finishedThisWeek: throughputByWeek(finishedTimes, [weekOf(now)])[0] ?? 0,
        cycle85: percentile(cycles, 0.85),
        pastTarget: open.filter((item) => pastTarget(data, item, now)).length,
      },
      flow: { days: dayList, series: flow },
      ageing: open
        .filter((item) => item.started !== null)
        .map((item) => ({
          key: item.key,
          title: item.title,
          stageKey: item.statusId,
          ageDays: days(item.started ?? now, now),
          waitingHours: Math.round((now - item.enteredCurrent) / 3_600_000),
          pastTarget: pastTarget(data, item, now),
        })),
      cycle: finished.map((item) => ({
        key: item.key,
        title: item.title,
        finishedAt: new Date(item.finished ?? now).toISOString(),
        days: days(item.started ?? 0, item.finished ?? 0),
      })),
      throughput: weeks.map((week, i) => ({
        week,
        count: throughputByWeek(finishedTimes, weeks)[i] ?? 0,
      })),
      forecastBasis: throughputByWeek(finishedTimes, basisWeeks),
      remainingOpen: open.length,
      workload: [...people.entries()].map(([assigneeId, counts]) => ({ assigneeId, counts })),
    }
  }

  /** Spec section 6: one health row and the "where work is stuck" cells. */
  function healthRow(data: TeamData, now: number) {
    const open = openItems(data)
    const started = open.filter((item) => item.started !== null)
    const past = open.filter((item) => pastTarget(data, item, now)).length
    const sixWeeks = 42 * DAY
    const cycleNow = percentile(cycleTimes(data, now - sixWeeks, now + 1), 0.85)
    const cycleBefore = percentile(cycleTimes(data, now - 2 * sixWeeks, now - sixWeeks), 0.85)
    const finishedTimes = data.items.flatMap((item) =>
      item.finished === null ? [] : [item.finished],
    )
    const complete = recentWeeks(now, 9).slice(0, 8)
    const counts = throughputByWeek(finishedTimes, complete)
    const avg = (values: number[]) => values.reduce((sum, v) => sum + v, 0) / (values.length || 1)
    const doneNow = Math.round(avg(counts.slice(4)) * 10) / 10
    const doneBefore = Math.round(avg(counts.slice(0, 4)) * 10) / 10
    const recentFinished = data.items.filter(
      (item) => item.finished !== null && (item.finished ?? 0) >= now - sixWeeks,
    )
    const rounds = recentFinished.length
      ? Math.round(
          (recentFinished.reduce((sum, item) => sum + (data.reviewRounds.get(item.id) ?? 0), 0) /
            recentFinished.length) *
            10,
        ) / 10
      : null

    const stuck: Partial<Record<StageKind, number | null>> = {}
    for (const kind of STAGE_KINDS) {
      const targeted = data.stages.filter((s) => s.kind === kind && s.targetHours != null)
      if (targeted.length === 0) {
        stuck[kind] = null
        continue
      }
      const ratios = open.flatMap((item) => {
        const stage = targeted.find((s) => s.key === item.statusId)
        return stage?.targetHours
          ? [(now - item.enteredCurrent) / (stage.targetHours * 3_600_000)]
          : []
      })
      const m = median(ratios)
      stuck[kind] = m === null ? null : Math.round(m * 100)
    }

    return {
      team: { id: data.team.id, name: data.team.name },
      status: healthStatus({
        pastTarget: past,
        startedOpen: started.length,
        cycleNow,
        cycleBefore,
      }),
      cycle85: cycleNow,
      cycleTrend: trendOf(cycleNow, cycleBefore),
      donePerWeek: doneNow,
      doneTrend: trendOf(doneNow, doneBefore),
      pastTarget: past,
      open: open.length,
      reviewRounds: rounds,
      stuck,
    }
  }

  app.get<{ Params: { teamId: string } }>('/teams/:teamId/dashboard', async (request, reply) => {
    const principal = await resolvePrincipal(db, request, devAuth)
    if (!principal) return reply.code(401).send({ error: 'unauthenticated' })
    const team = (await visibleTeams(principal)).find((t) => t.id === request.params.teamId)
    if (!team) return reply.code(404).send({ error: 'not_found' })
    return teamDashboard(await loadTeamData(team), Date.now())
  })

  app.get('/dashboards/teams', async (request, reply) => {
    const principal = await resolvePrincipal(db, request, devAuth)
    if (!principal) return reply.code(401).send({ error: 'unauthenticated' })
    const now = Date.now()
    const rows = []
    for (const team of await visibleTeams(principal)) {
      rows.push(healthRow(await loadTeamData(team), now))
    }
    return { computedAt: new Date(now).toISOString(), kinds: STAGE_KINDS, teams: rows }
  })

  /** Set or clear a stage's kind (spec section 4, rule 4). Null goes back to the starting kind. */
  app.put<{ Params: { teamId: string; stageKey: string }; Body: { kind: StageKind | null } }>(
    '/teams/:teamId/stages/:stageKey/kind',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['kind'],
          properties: { kind: { anyOf: [{ type: 'null' }, { enum: [...STAGE_KINDS] }] } },
        },
      },
    },
    async (request, reply) => {
      const principal = await resolvePrincipal(db, request, devAuth)
      if (!principal) return reply.code(401).send({ error: 'unauthenticated' })
      const team = (await visibleTeams(principal)).find((t) => t.id === request.params.teamId)
      if (!team) return reply.code(404).send({ error: 'not_found' })
      if (!decide(principal, 'team.config.edit', { team }).allowed) {
        return reply.code(403).send({ error: 'forbidden' })
      }
      const stage = await db.query<{ category: Stage['category'] }>(
        'SELECT category FROM stages WHERE team_id = $1 AND key = $2',
        [team.id, request.params.stageKey],
      )
      const category = stage[0]?.category
      if (!category) return reply.code(404).send({ error: 'not_found' })
      if (category === 'done' || category === 'cancelled') {
        return reply.code(422).send({ error: 'end_stage_has_no_kind' })
      }
      await db.query('UPDATE stages SET kind = $3 WHERE team_id = $1 AND key = $2', [
        team.id,
        request.params.stageKey,
        request.body.kind,
      ])
      return { stageKey: request.params.stageKey, kind: request.body.kind }
    },
  )
}
