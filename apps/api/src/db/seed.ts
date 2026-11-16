import { generateSampleWorkItems, SAMPLE_USERS } from '@wm/shared'
import type { Db, Queryable } from './db.js'

/**
 * Made-up data for local development only. Never real company, client or Jira data.
 * Teams ENG, WEB, API and OPS are open; SEC is private.
 */
const PIPELINE_STAGES = [
  ['analysis', 'Analysis', 'todo'],
  ['sourcing', 'Sourcing', 'in_progress'],
  ['enrichment', 'Enrichment', 'in_progress'],
  ['processing', 'Processing', 'in_progress'],
  ['validation', 'Validation', 'in_progress'],
  ['client_review', 'Client review', 'in_progress'],
  ['published', 'Published', 'done'],
  ['dropped', 'Dropped', 'cancelled'],
] as const

const DATASETS = [
  'Rainfall by district',
  'School enrolment by block',
  'Road length by category',
  'Health centres by district',
  'Crop yield estimates',
  'Household water connections',
  'Bank branches by district',
  'Livestock census summary',
  'Market prices',
  'Vehicle registrations by fuel',
]

const SOURCES = [
  'Meteorological department',
  'Education department',
  'Roads department',
  'Health department',
  'Agriculture department',
]

const DATASET_FIELDS = [
  { key: 'source', label: 'Source', kind: 'text', required: true },
  {
    key: 'frequency',
    label: 'Frequency',
    kind: 'choice',
    required: false,
    options: ['monthly', 'quarterly', 'yearly'],
  },
  { key: 'rows', label: 'Rows', kind: 'number', required: false },
  { key: 'refreshed', label: 'Last refreshed', kind: 'date', required: false },
  { key: 'url', label: 'Link', kind: 'link', required: false },
]

export async function seedDevData(db: Db, itemCount = 2000, pipelineCount = 300): Promise<void> {
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

  // DATA is a made-up pipeline team: its own stages, and a hand-over clears the owner.
  await db.query(
    "INSERT INTO teams (id, key, name, is_private, hand_off_clears_owner) VALUES ('DATA', 'DATA', 'Data Pipeline', false, true)",
  )
  await db.query("DELETE FROM stages WHERE team_id = 'DATA'")
  for (const [position, [key, name, category]] of PIPELINE_STAGES.entries()) {
    await db.query(
      "INSERT INTO stages (team_id, key, name, category, position) VALUES ('DATA', $1, $2, $3, $4)",
      [key, name, category, position + 1],
    )
  }
  // Validation needs two checks and a coverage value before an item can go to client review.
  await db.exec(`INSERT INTO stage_steps (team_id, stage_key, label, position) VALUES
    ('DATA', 'validation', 'Totals checked against the source', 1),
    ('DATA', 'validation', 'Units and column names confirmed', 2)`)
  await db.exec(`INSERT INTO stage_required_fields (team_id, stage_key, field_key, label) VALUES
    ('DATA', 'validation', 'coverage', 'Coverage')`)
  await db.exec(`INSERT INTO team_members (team_id, user_id, role) VALUES
    ('DATA', 'user-7', 'admin'), ('DATA', 'user-3', 'member'), ('DATA', 'user-4', 'member'),
    ('DATA', 'user-9', 'reviewer')`)
  // Validation is also a review stage: changes requested send the item back to Processing.
  await db.exec(
    "UPDATE stages SET review_send_back_to = 'processing' WHERE team_id = 'DATA' AND key = 'validation'",
  )

  // Records (specs/records.md): one Dataset record per dataset, looked after by DATA.
  await db.query(
    "INSERT INTO record_types (key, name, fields) VALUES ('dataset', 'Dataset', $1::jsonb)",
    [JSON.stringify(DATASET_FIELDS)],
  )
  const frequencies = ['monthly', 'quarterly', 'yearly'] as const
  for (const [index, name] of DATASETS.entries()) {
    const values = {
      source: SOURCES[index % SOURCES.length] ?? 'Department',
      frequency: frequencies[index % frequencies.length] ?? 'yearly',
      rows: 1000 + index * 731,
      refreshed: `2026-${String((index % 9) + 1).padStart(2, '0')}-15`,
      url: `https://example.org/data/${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    }
    await db.query(
      "INSERT INTO records (id, type_key, team_id, title, values, created_by) VALUES ($1, 'dataset', 'DATA', $2, $3::jsonb, 'user-7')",
      [`rec-dataset-${index + 1}`, name, JSON.stringify(values)],
    )
    await db.query(
      "INSERT INTO record_events (record_id, actor_id, action) VALUES ($1, 'user-7', 'created')",
      [`rec-dataset-${index + 1}`],
    )
  }
  // A record in the private SEC team, which only SEC members can see.
  await db.query(
    "INSERT INTO records (id, type_key, team_id, title, values, created_by) VALUES ('rec-sec-1', 'dataset', 'SEC', 'Access logs', $1::jsonb, 'user-2')",
    [JSON.stringify({ source: 'Internal systems', frequency: 'monthly' })],
  )

  const items = generateSampleWorkItems(itemCount)
  await db.exec('BEGIN')
  const owners = ['user-7', 'user-3', 'user-4', null]
  for (let i = 0; i < pipelineCount; i++) {
    const [key, , category] = PIPELINE_STAGES[i % PIPELINE_STAGES.length] ?? PIPELINE_STAGES[0]
    const owner = owners[i % owners.length] ?? null
    await insertItem(db, {
      id: `data-item-${i + 1}`,
      key: `DATA-${i + 1}`,
      kind: 'deliverable',
      title: `${DATASETS[i % DATASETS.length]}, ${2015 + (i % 10)} refresh`,
      statusId: key,
      statusCategory: category,
      teamId: 'DATA',
      assigneeId: owner,
      createdBy: 'user-7',
      fields:
        i % 2 === 0
          ? { priority: i % 5, coverage: `${2015 + (i % 10)} to 2025` }
          : { priority: i % 5 },
    })
  }
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
  // Each DATA item is about the dataset in its title.
  await db.exec(`UPDATE work_items
    SET record_id = 'rec-dataset-' || ((substring(key from 6)::int - 1) % ${DATASETS.length} + 1)
    WHERE team_id = 'DATA'`)
  await db.exec("UPDATE work_items SET record_id = 'rec-sec-1' WHERE id = 'item-sec-1'")
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

export async function insertItem(db: Queryable, item: NewItem): Promise<void> {
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
  await db.query('INSERT INTO stage_history (item_id, stage_key, owner_id) VALUES ($1, $2, $3)', [
    item.id,
    item.statusId,
    item.assigneeId,
  ])
}
