import { generateSampleWorkItems, SAMPLE_USERS } from '@wm/shared'
import type { Db } from './db.js'

/**
 * Made-up data for local development only. Never real company, client or Jira data.
 * Teams ENG, WEB, API and OPS are open; SEC is private.
 */
export async function seedDevData(db: Db, itemCount = 2000): Promise<void> {
  const existing = await db.query<{ count: string }>('SELECT count(*) AS count FROM users')
  if (Number(existing[0]?.count ?? 0) > 0) return

  const teams = [
    { id: 'ENG', name: 'Engineering', isPrivate: false },
    { id: 'WEB', name: 'Web', isPrivate: false },
    { id: 'API', name: 'API', isPrivate: false },
    { id: 'OPS', name: 'Operations', isPrivate: false },
    { id: 'SEC', name: 'Security', isPrivate: true },
  ]
  for (const team of teams) {
    await db.query('INSERT INTO teams (id, key, name, is_private) VALUES ($1, $1, $2, $3)', [
      team.id,
      team.name,
      team.isPrivate,
    ])
  }

  // user-1 is the org admin, user-12 a viewer, the rest members spread over the open teams.
  for (const [index, user] of SAMPLE_USERS.entries()) {
    const orgRole =
      index === 0 ? 'org_admin' : index === SAMPLE_USERS.length - 1 ? 'viewer' : 'member'
    await db.query('INSERT INTO users (id, name, org_role) VALUES ($1, $2, $3)', [
      user.id,
      user.name,
      orgRole,
    ])
    if (orgRole !== 'member') continue
    const team = teams[index % 4]
    if (!team) continue
    await db.query('INSERT INTO team_members (team_id, user_id, role) VALUES ($1, $2, $3)', [
      team.id,
      user.id,
      index <= 4 ? 'admin' : 'member',
    ])
  }
  await db.query(
    "INSERT INTO team_members (team_id, user_id, role) VALUES ('SEC', 'user-2', 'admin')",
  )

  const items = generateSampleWorkItems(itemCount)
  await db.exec('BEGIN')
  for (const item of items) {
    await insertItem(db, { ...item, createdBy: item.assigneeId })
  }
  await insertItem(db, {
    ...(items[0] as (typeof items)[number]),
    id: 'item-sec-1',
    key: 'SEC-1',
    teamId: 'SEC',
    title: 'Rotate signing keys',
    assigneeId: 'user-2',
    createdBy: 'user-2',
  })
  await db.exec('COMMIT')
}

export interface NewItem {
  readonly id: string
  readonly key: string
  readonly kind: string
  readonly title: string
  readonly statusId: string
  readonly statusCategory: string
  readonly teamId: string
  readonly assigneeId: string | null
  readonly createdBy: string | null
  readonly fields: Readonly<Record<string, unknown>>
}

export async function insertItem(db: Db, item: NewItem): Promise<void> {
  await db.query(
    `INSERT INTO work_items
       (id, key, kind, title, status_id, status_category, team_id, assignee_id, created_by, fields)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)`,
    [
      item.id,
      item.key,
      item.kind,
      item.title,
      item.statusId,
      item.statusCategory,
      item.teamId,
      item.assigneeId,
      item.createdBy,
      JSON.stringify(item.fields),
    ],
  )
}
