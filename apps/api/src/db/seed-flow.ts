/**
 * Sample stage history for the dashboards (specs/dashboards.md). Generated, never real data:
 * every item gets a believable path through its team's stages over the last three months.
 */
import type { Db } from './db.js'

const DAY = 86_400_000

/** How long open items have typically waited, in days, so teams look different. */
const TEAM_PACE: Record<string, number> = { ENG: 5.5, WEB: 6.5, API: 8, OPS: 9, SEC: 6 }

interface StageRow {
  team_id: string
  key: string
  name: string
  category: string
  position: number
}

interface OpenRow {
  id: string
  team_id: string
  status_id: string
  seq: string | number
  entered_at: Date | string
}

/** A repeatable random stream per item, so every seed run gives the same pictures. */
function randomFor(seed: string): () => number {
  let h = 2166136261
  for (const char of seed) h = Math.imul(h ^ char.charCodeAt(0), 16777619) >>> 0
  return () => {
    h = (Math.imul(h ^ (h >>> 15), 2246822507) + 0x9e3779b9) >>> 0
    h ^= h >>> 13
    return (h >>> 0) / 4294967296
  }
}

function isReviewish(stage: StageRow): boolean {
  return /review|validation/i.test(stage.name)
}

export async function seedFlowHistory(db: Db, now = Date.now()): Promise<void> {
  const stages = await db.query<StageRow>(
    'SELECT team_id, key, name, category, position FROM stages ORDER BY team_id, position',
  )
  const byTeam = new Map<string, StageRow[]>()
  for (const stage of stages)
    byTeam.set(stage.team_id, [...(byTeam.get(stage.team_id) ?? []), stage])
  const open = await db.query<OpenRow>(
    `SELECT w.id, w.team_id, w.status_id, h.seq, h.entered_at FROM work_items w
     JOIN stage_history h ON h.item_id = w.id AND h.left_at IS NULL`,
  )

  const ins = {
    item: [] as string[],
    stage: [] as string[],
    entered: [] as string[],
    left: [] as string[],
  }
  const upd = { seq: [] as string[], entered: [] as string[] }

  for (const row of open) {
    const team = byTeam.get(row.team_id) ?? []
    const current = team.find((stage) => stage.key === row.status_id)
    if (!current) continue
    const rand = randomFor(row.id)
    const working = team.filter((s) => s.category === 'todo' || s.category === 'in_progress')

    let path: StageRow[]
    let lastEntered: number
    if (current.category === 'done') {
      // Finished at some point in the last nine weeks, after going through every working stage.
      path = [...working.filter((s, i) => i > 0 || rand() < 0.6), current]
      lastEntered = now - rand() * 91 * DAY
    } else if (current.category === 'cancelled') {
      path = [...working.slice(0, 1 + Math.floor(rand() * working.length)), current]
      lastEntered = now - rand() * 91 * DAY
    } else {
      path = working.filter((s) => s.position <= current.position)
      // DATA's waiting times were already spread for the board; keep them.
      lastEntered =
        current.category === 'todo'
          ? // Not started yet: arrived at any point in the last seven weeks.
            now - rand() * 49 * DAY
          : row.team_id === 'DATA'
            ? new Date(row.entered_at).getTime()
            : now -
              Math.pow(rand(), 1.6) *
                (TEAM_PACE[row.team_id] ?? 9) *
                (isReviewish(current) ? 0.4 : 1) *
                DAY
    }

    // Walk backwards from the last stage, giving each earlier stage a believable length.
    const recent = now - lastEntered < 21 * DAY
    const times: number[] = new Array<number>(path.length)
    times[path.length - 1] = lastEntered
    for (let i = path.length - 2; i >= 0; i--) {
      const stage = path[i]
      if (!stage) continue
      // Time in the backlog before work started varies a lot; work stages much less.
      let base =
        stage.category === 'todo' ? (i === 0 && current.category !== 'done' ? 12 : 2.5) : 1.6
      if (isReviewish(stage)) base = 2.6
      // Open work has often sat in earlier stages for a while.
      if (current.category === 'in_progress' && stage.category === 'in_progress')
        base *= 1 + rand() * 5
      // DATA's reviews have slowed down lately: the dashboards should show it.
      if (isReviewish(stage) && row.team_id === 'DATA' && recent) base *= 1.9
      times[i] = (times[i + 1] ?? lastEntered) - base * (0.3 + rand() * 1.4) * DAY
    }

    for (let i = 0; i < path.length - 1; i++) {
      ins.item.push(row.id)
      ins.stage.push(path[i]?.key ?? '')
      ins.entered.push(new Date(times[i] ?? now).toISOString())
      ins.left.push(new Date(times[i + 1] ?? now).toISOString())
    }
    upd.seq.push(String(row.seq))
    upd.entered.push(new Date(lastEntered).toISOString())
  }

  await db.query(
    `INSERT INTO stage_history (item_id, stage_key, entered_at, left_at)
     SELECT * FROM unnest($1::text[], $2::text[], $3::timestamptz[], $4::timestamptz[])`,
    [ins.item, ins.stage, ins.entered, ins.left],
  )
  await db.query(
    `UPDATE stage_history h SET entered_at = u.entered
     FROM unnest($1::bigint[], $2::timestamptz[]) AS u(seq, entered) WHERE h.seq = u.seq`,
    [upd.seq, upd.entered],
  )
}
