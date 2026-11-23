/**
 * The Midnight app's calls to the API. Development sign-in uses the same saved user as the
 * old screens; with Cognito configured, calls carry the ID token.
 */
import type { DoneOutcome, FieldType, PriorityName, StageType, TypeCounts } from '@wm/shared'
import { authConfig, idToken, startSignIn } from '../auth/auth'

export interface CoreStage {
  key: string
  name: string
  position: number
  type: StageType
  doneOutcome: DoneOutcome | null
  itemLimit: number | null
  targetHours: number | null
  sendBackTo: string | null
}

export interface CoreTeam {
  id: string
  key: string
  name: string
  estimateUnit: 'hours' | 'points'
  weeklyCapacity: number
  canConfigure: boolean
  canCreate: boolean
  members: { userId: string; role: string }[]
  stages: CoreStage[]
  transitions: { from: string; to: string }[]
}

export interface CoreItem {
  id: string
  key: string
  title: string
  teamId: string
  stageKey: string
  stageType: StageType
  doneOutcome: DoneOutcome | null
  assigneeId: string | null
  priority: PriorityName
  dueOn: string | null
  estimate: number | null
  labels: string[]
  projectId: string | null
  milestoneId: string | null
  parentId: string | null
  subItems: { total: number; done: number }
  fields: Record<string, unknown>
  updatedAt: string
}

export interface Progress {
  counts: TypeCounts
  done: number
  total: number
  percent: number
}

export interface CoreProject {
  id: string
  name: string
  colour: number
  ownerId: string
  startsOn: string | null
  endsOn: string | null
  archived: boolean
  progress?: Progress
}

export interface Milestone {
  id: string
  name: string
  dueOn: string | null
  doneOn: string | null
  left: number
  total: number
}

export interface CoreField {
  id: string
  key: string
  label: string
  type: FieldType
  options: string[]
  scope: 'library' | 'team'
  enabled: boolean
}

export interface Person {
  id: string
  name: string
}

export interface Workflow {
  allowedMoves: string[]
  missing: string[]
  canForce: boolean
}

const USER_KEY = 'wm-dev-user'

export function devUser(): string {
  try {
    return localStorage.getItem(USER_KEY) ?? 'user-1'
  } catch {
    return 'user-1'
  }
}

const auth = authConfig()

const MESSAGES: Record<string, string> = {
  stage_not_empty: 'move the items out of this stage before changing its type',
  stage_types_missing: 'a team needs at least one Waiting, Doing and Done stage',
  parent_is_sub_item: 'a sub-item cannot have sub-items of its own',
  parent_other_team: 'a sub-item must be in the same team as its parent',
  parent_other_project: 'a sub-item must be in the same project as its parent',
  milestone_not_in_project: 'pick a milestone from this item’s project',
  sub_item_follows_parent: 'a sub-item always stays in its parent’s project',
  too_many_fields: 'a team can have at most 25 fields of its own',
  too_many_stages: 'a team can have at most 30 stages',
  field_exists: 'a field with that name already exists',
  options_required: 'add at least one option',
  not_allowed: 'that move is not allowed from this stage',
  requirements_missing: 'finish the stage’s requirements first',
  forbidden: 'you do not have permission to do that',
  not_found: 'that could not be found',
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let identity: Record<string, string> = { 'x-dev-user': devUser() }
  if (auth) {
    const token = await idToken(auth)
    if (!token) {
      void startSignIn(auth)
      throw new Error('you are not signed in')
    }
    identity = { authorization: `Bearer ${token}` }
  }
  let response: Response
  try {
    response = await fetch(`/api${path}`, {
      ...init,
      headers: {
        ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...identity,
      },
    })
  } catch {
    throw new Error('the server could not be reached')
  }
  if (!response.ok) {
    let body: { error?: string; missing?: string[] } = {}
    try {
      body = (await response.json()) as typeof body
    } catch {
      // No readable body.
    }
    const base =
      (body.error && MESSAGES[body.error]) ?? body.error ?? `the server answered ${response.status}`
    throw new Error(body.missing?.length ? `${base}: ${body.missing.join(', ')}` : base)
  }
  return (await response.json()) as T
}

const json = (method: string, body: unknown): RequestInit => ({
  method,
  body: JSON.stringify(body),
})
const enc = encodeURIComponent

export const coreApi = {
  me: () => request<{ id: string; name: string }>('/me'),
  people: () => request<{ people: Person[] }>('/people').then((b) => b.people),
  teams: () => request<{ teams: CoreTeam[] }>('/core/teams').then((b) => b.teams),
  teamItems: (teamId: string) =>
    request<{ items: CoreItem[] }>(`/core/teams/${enc(teamId)}/items`).then((b) => b.items),
  item: (idOrKey: string) =>
    request<{ item: CoreItem; subItems: CoreItem[] }>(`/core/items/${enc(idOrKey)}`),
  myItems: () => request<{ items: CoreItem[] }>('/core/me/items').then((b) => b.items),
  projects: () => request<{ projects: CoreProject[] }>('/core/projects').then((b) => b.projects),
  project: (id: string) =>
    request<{
      project: CoreProject & { canEdit: boolean }
      progress: Progress
      milestones: Milestone[]
      items: CoreItem[]
    }>(`/core/projects/${enc(id)}`),
  createProject: (name: string, colour: number) =>
    request<{ project: CoreProject }>('/core/projects', json('POST', { name, colour })),
  addMilestone: (projectId: string, name: string, dueOn: string | null) =>
    request<{ id: string }>(
      `/core/projects/${enc(projectId)}/milestones`,
      json('POST', { name, dueOn }),
    ),
  createItem: (body: {
    teamId: string
    title: string
    stageKey?: string
    projectId?: string | null
    parentId?: string | null
  }) => request<{ item: CoreItem }>('/core/items', json('POST', body)).then((b) => b.item),
  plan: (
    id: string,
    body: {
      projectId?: string | null
      milestoneId?: string | null
      dueOn?: string | null
      estimate?: number | null
      labels?: string[]
    },
  ) =>
    request<{ item: CoreItem }>(`/core/items/${enc(id)}/plan`, json('PATCH', body)).then(
      (b) => b.item,
    ),
  editItem: (
    id: string,
    body: { title?: string; statusId?: string; assigneeId?: string | null; priority?: number },
  ) => request<unknown>(`/items/${enc(id)}`, json('PATCH', body)),
  workflow: (id: string) => request<Workflow>(`/items/${enc(id)}/workflow`),
  addStage: (teamId: string, name: string, type: StageType) =>
    request<{ key: string }>(`/core/teams/${enc(teamId)}/stages`, json('POST', { name, type })),
  editStage: (
    teamId: string,
    key: string,
    body: { name?: string; type?: StageType; doneOutcome?: DoneOutcome },
  ) => request<unknown>(`/core/teams/${enc(teamId)}/stages/${enc(key)}`, json('PATCH', body)),
  setTransitions: (teamId: string, transitions: { from: string; to: string }[]) =>
    request<unknown>(`/core/teams/${enc(teamId)}/transitions`, json('PUT', { transitions })),
  fields: (teamId: string) =>
    request<{ fields: CoreField[] }>(`/core/teams/${enc(teamId)}/fields`).then((b) => b.fields),
  setField: (teamId: string, fieldId: string, enabled: boolean) =>
    request<unknown>(`/core/teams/${enc(teamId)}/fields/${enc(fieldId)}`, json('PUT', { enabled })),
  addField: (teamId: string, label: string, type: FieldType, options: string[]) =>
    request<unknown>(`/core/teams/${enc(teamId)}/fields`, json('POST', { label, type, options })),
}
