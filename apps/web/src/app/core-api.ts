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

/* Phase 3: working together */

export interface CommentView {
  id: string
  authorId: string
  body: string | null
  internal: boolean
  createdAt: string
  editedAt: string | null
  deletedAt: string | null
  canEdit: boolean
  canDelete: boolean
}

export interface ReviewRound {
  id: string
  number: number
  stageKey: string
  requestedBy: string
  openedAt: string
  state: 'open' | 'approved' | 'changes_requested' | 'withdrawn'
  reviewers: {
    userId: string
    verdict: 'approved' | 'changes_requested' | null
    comment: string | null
    at: string | null
  }[]
}

export interface Reviews {
  reviewStage: { stageKey: string; sendBackTo: string } | null
  approved: boolean
  canOpen: boolean
  canVerdict: boolean
  canWithdraw: boolean
  rounds: ReviewRound[]
}

export interface RunView {
  number: number
  startedAt: string
  startedBy: 'schedule' | 'manual'
  starterId: string | null
  startStage: string
  endedAt: string | null
  outcome: 'completed' | 'cancelled' | null
  fieldValues: {
    fields?: Record<string, unknown>
    dueOn?: string | null
    estimate?: number | null
    ownerId?: string | null
  } | null
  passes: { stageKey: string; ownerId: string | null; enteredAt: string; leftAt: string | null }[]
  comments: number
}

export interface ScheduleView {
  rule: import('@wm/shared').ScheduleRule
  text: string
  startStage: string
  ownerId: string | null
  nextAt: string
  waitingForOpenRun?: boolean
}

export interface Attachment {
  id: string
  name: string
  contentType: string
  size: number
  uploadedBy: string
  createdAt: string
}

export interface InboxEntry {
  id: string
  kind: string
  itemId: string
  itemKey: string
  itemTitle: string
  actorId: string | null
  excerpt: string | null
  createdAt: string
  read: boolean
}

export interface SearchResult {
  id: string
  key: string
  title: string
  teamId: string
  stageKey: string
  matched: 'title' | 'comment'
  snippet: string | null
}

export const workApi = {
  comments: (id: string) =>
    request<{ canComment: boolean; comments: CommentView[] }>(`/items/${enc(id)}/comments`),
  addComment: (id: string, body: string) =>
    request<{ comments: CommentView[] }>(
      `/items/${enc(id)}/comments`,
      json('POST', { body, internal: false }),
    ),
  deleteComment: (commentId: string) =>
    request<unknown>(`/comments/${enc(commentId)}`, { method: 'DELETE' }),
  reviews: (id: string) => request<Reviews>(`/items/${enc(id)}/reviews`),
  openReview: (id: string, reviewers: string[]) =>
    request<Reviews>(`/items/${enc(id)}/reviews`, json('POST', { reviewers })),
  verdict: (roundId: string, verdict: 'approved' | 'changes_requested', comment: string) =>
    request<Reviews>(
      `/reviews/${enc(roundId)}/verdict`,
      json('POST', comment.trim() ? { verdict, comment } : { verdict }),
    ),
  description: (id: string) =>
    request<{ description: string | null }>(`/core/items/${enc(id)}/description`).then(
      (b) => b.description,
    ),
  setDescription: (id: string, description: string) =>
    request<unknown>(`/core/items/${enc(id)}/description`, json('PUT', { description })),
  runs: (id: string) =>
    request<{ schedule: ScheduleView | null; runs: RunView[] }>(`/core/items/${enc(id)}/runs`),
  setSchedule: (
    id: string,
    rule: import('@wm/shared').ScheduleRule | null,
    startStage?: string,
    ownerId?: string | null,
  ) =>
    request<unknown>(
      `/core/items/${enc(id)}/schedule`,
      json('PUT', rule ? { rule, startStage, ownerId: ownerId ?? null } : { rule: null }),
    ),
  startRun: (id: string) =>
    request<{ number: number }>(`/core/items/${enc(id)}/runs`, json('POST', {})),
  attachments: (id: string) =>
    request<{ attachments: Attachment[] }>(`/core/items/${enc(id)}/attachments`).then(
      (b) => b.attachments,
    ),
  upload: async (id: string, file: File) => {
    const identity: Record<string, string> = auth
      ? { authorization: `Bearer ${(await idToken(auth)) ?? ''}` }
      : { 'x-dev-user': devUser() }
    const res = await fetch(
      `/api/core/items/${enc(id)}/attachments?name=${enc(file.name)}&type=${enc(file.type || 'application/octet-stream')}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/octet-stream', ...identity },
        body: file,
      },
    )
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string }
      throw new Error(
        body.error === 'file_type_not_allowed'
          ? 'only pictures, documents, PDFs and spreadsheets can be attached'
          : body.error === 'file_too_large'
            ? 'files can be up to 25 MB'
            : (body.error ?? `upload failed (${res.status})`),
      )
    }
  },
  download: async (attachment: Attachment) => {
    const identity: Record<string, string> = auth
      ? { authorization: `Bearer ${(await idToken(auth)) ?? ''}` }
      : { 'x-dev-user': devUser() }
    const res = await fetch(`/api/core/attachments/${enc(attachment.id)}/content`, {
      headers: identity,
    })
    if (!res.ok) throw new Error('the file could not be downloaded')
    const url = URL.createObjectURL(await res.blob())
    const a = document.createElement('a')
    a.href = url
    a.download = attachment.name
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 10_000)
  },
  removeAttachment: (attachmentId: string) =>
    request<unknown>(`/core/attachments/${enc(attachmentId)}`, { method: 'DELETE' }),
  inbox: () => request<{ unread: number; entries: InboxEntry[] }>('/inbox'),
  markRead: (ids?: string[]) => request<unknown>('/inbox/read', json('POST', ids ? { ids } : {})),
  search: (q: string) =>
    request<{ results: SearchResult[] }>(`/core/search?q=${enc(q)}`).then((b) => b.results),
}

/* Phase 4: views, intake and live updates */

export interface CalendarData {
  items: {
    id: string
    key: string
    title: string
    teamId: string
    dueOn: string
    stageType: import('@wm/shared').StageType
    assigneeId: string | null
    projectId: string | null
  }[]
  milestones: { id: string; name: string; dueOn: string; projectId: string; projectName: string }[]
}

export interface WorkloadData {
  weekStarts: string[]
  people: {
    id: string
    name: string
    teams: string[]
    unit: string
    capacity: number
    weeks: { load: number; items: number }[]
  }[]
}

export interface DashboardData {
  tiles: { open: number; inReview: number; doneThisWeek: number; stuck: number }
  projects: { id: string; name: string; colour: number; progress: Progress }[]
  people: { id: string; name: string; waiting: number; doing: number; review: number }[]
  stuck: {
    id: string
    key: string
    title: string
    teamId: string
    stageKey: string
    assigneeId: string | null
    days: number
  }[]
}

export interface FormQuestion {
  key: string
  label: string
  type: 'short_text' | 'long_text' | 'date' | 'pick_one'
  required: boolean
  options?: string[]
}

export interface IntakeForm {
  id: string
  teamId: string
  teamName: string
  name: string
  intro: string | null
  questions: FormQuestion[]
  startStage: string
}

export interface RequestView {
  id: string
  formId: string
  formName: string
  teamId: string
  requesterId: string
  title: string
  answers: { label: string; value: string }[]
  status: 'new' | 'needs_info' | 'accepted' | 'declined'
  note: string | null
  itemKey: string | null
  createdAt: string
  updatedAt: string
}

const q = (params: Record<string, string | number | undefined>) =>
  Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${k}=${enc(String(v))}`)
    .join('&')

export const viewsApi = {
  calendar: (from: string, to: string, teamId?: string) =>
    request<CalendarData>(`/core/calendar?${q({ from, to, teamId })}`),
  workload: (teamId?: string, weeks = 4) =>
    request<WorkloadData>(`/core/workload?${q({ teamId, weeks })}`),
  dashboard: (teamId?: string) => request<DashboardData>(`/core/dashboard?${q({ teamId })}`),
  forms: () => request<{ forms: IntakeForm[] }>('/core/forms').then((b) => b.forms),
  createForm: (
    teamId: string,
    body: {
      name: string
      intro?: string
      questions: Omit<FormQuestion, 'key'>[]
      startStage: string
    },
  ) => request<{ id: string }>(`/core/teams/${enc(teamId)}/forms`, json('POST', body)),
  submit: (formId: string, title: string, answers: Record<string, string>) =>
    request<{ id: string }>(
      `/core/forms/${enc(formId)}/requests`,
      json('POST', { title, answers }),
    ),
  teamRequests: (teamId: string) =>
    request<{ requests: RequestView[] }>(`/core/teams/${enc(teamId)}/requests`).then(
      (b) => b.requests,
    ),
  myRequests: () =>
    request<{ requests: RequestView[] }>('/core/me/requests').then((b) => b.requests),
  accept: (id: string, projectId: string | null) =>
    request<{ itemKey: string }>(`/core/requests/${enc(id)}/accept`, json('POST', { projectId })),
  ask: (id: string, note: string) =>
    request<unknown>(`/core/requests/${enc(id)}/ask`, json('POST', { note })),
  decline: (id: string, note: string) =>
    request<unknown>(`/core/requests/${enc(id)}/decline`, json('POST', { note })),
}

/** The address of the live channel, with this person's sign-in. */
export async function liveUrl(): Promise<string> {
  const base = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/live`
  if (auth) return `${base}?token=${enc((await idToken(auth)) ?? '')}`
  return `${base}?user=${enc(devUser())}`
}
