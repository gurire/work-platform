/**
 * Deterministic, made-up work items for performance tests and UI spikes.
 * Never use real company, client or Jira data in sessions (see CLAUDE.md).
 */
import type { StatusCategory, WorkItem, WorkItemKind } from './work-item.js'

export interface SampleStatus {
  readonly id: string
  readonly name: string
  readonly category: StatusCategory
}

export interface SampleUser {
  readonly id: string
  readonly name: string
}

export const SAMPLE_STATUSES: readonly SampleStatus[] = [
  { id: 'backlog', name: 'Backlog', category: 'todo' },
  { id: 'todo', name: 'Todo', category: 'todo' },
  { id: 'in_progress', name: 'In Progress', category: 'in_progress' },
  { id: 'in_review', name: 'In Review', category: 'in_progress' },
  { id: 'done', name: 'Done', category: 'done' },
  { id: 'cancelled', name: 'Cancelled', category: 'cancelled' },
]

export const SAMPLE_USERS: readonly SampleUser[] = [
  'Asha Rao',
  'Ben Ortiz',
  'Chen Wei',
  'Dara Singh',
  'Elif Kaya',
  'Farid Noor',
  'Grace Lim',
  'Hugo Maas',
  'Ines Costa',
  'Jonas Berg',
  'Kavya Iyer',
  'Liam Shaw',
].map((name, i) => ({ id: `user-${i + 1}`, name }))

export const SAMPLE_PRIORITIES = ['None', 'Low', 'Medium', 'High', 'Urgent'] as const

const KINDS: readonly WorkItemKind[] = ['story', 'task', 'task', 'bug', 'bug', 'story', 'epic']
const VERBS = ['Fix', 'Add', 'Refactor', 'Investigate', 'Remove', 'Speed up', 'Document', 'Test']
const NOUNS = [
  'login flow',
  'export job',
  'search index',
  'billing webhook',
  'notification digest',
  'audit log',
  'file upload',
  'rate limiter',
  'cache layer',
  'onboarding form',
  'report builder',
  'sync queue',
]
const CONTEXTS = [
  'on mobile',
  'for large teams',
  'after deploy',
  'in dark mode',
  'under load',
  'for guests',
  'in the API',
  'on slow networks',
]
const TEAMS = ['ENG', 'WEB', 'API', 'OPS']
const BASE_TIME = Date.UTC(2026, 0, 1)
const DAY_MS = 86_400_000

/** Small seeded PRNG (mulberry32) so the same seed always gives the same data. */
function prng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function generateSampleWorkItems(count: number, seed = 1): WorkItem[] {
  const rand = prng(seed)
  const pick = <T>(list: readonly T[]): T => list[Math.floor(rand() * list.length)] as T
  const items: WorkItem[] = []
  for (let i = 0; i < count; i++) {
    const team = TEAMS[i % TEAMS.length] as string
    const status = pick(SAMPLE_STATUSES)
    const created = BASE_TIME + Math.floor(rand() * 300) * DAY_MS
    items.push({
      id: `item-${i + 1}`,
      key: `${team}-${Math.floor(i / TEAMS.length) + 1}`,
      kind: pick(KINDS),
      title: `${pick(VERBS)} ${pick(NOUNS)} ${pick(CONTEXTS)}`,
      statusId: status.id,
      statusCategory: status.category,
      parentId: null,
      teamId: team,
      clientId: null,
      assigneeId: rand() < 0.15 ? null : pick(SAMPLE_USERS).id,
      createdAt: new Date(created).toISOString(),
      updatedAt: new Date(created + Math.floor(rand() * 20) * DAY_MS).toISOString(),
      fields: { priority: Math.floor(rand() * SAMPLE_PRIORITIES.length) },
    })
  }
  return items
}
