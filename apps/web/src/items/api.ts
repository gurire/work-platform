import type {
  InboxKind,
  RecordType,
  RecordValue,
  RoundState,
  Stage,
  StageTransition,
  Verdict,
  WorkItem,
} from '@wm/shared'
import type { HistoryEntry } from './item-model'
import type { ItemPatch } from './store'

export interface ApiUser {
  readonly id: string
  readonly name: string
}

export interface ApiTeam {
  readonly id: string
  readonly name: string
  readonly isPrivate: boolean
  readonly handOffClearsOwner: boolean
  readonly stages: readonly Stage[]
  readonly transitions: readonly StageTransition[]
  readonly reviewStages: readonly { stageKey: string; sendBackTo: string }[]
  readonly stageLimits: readonly {
    stageKey: string
    itemLimit: number | null
    targetHours: number | null
  }[]
}

export interface WorkflowStep {
  readonly id: string
  readonly label: string
  readonly ticked: boolean
  readonly tickedBy: string | null
  readonly tickedAt: string | null
}

export interface Workflow {
  readonly stageKey: string
  readonly steps: readonly WorkflowStep[]
  readonly requiredFields: readonly { key: string; label: string; filled: boolean }[]
  readonly review: { sendBackTo: string; approved: boolean } | null
  readonly missing: readonly string[]
  readonly allowedMoves: readonly string[]
  readonly canForce: boolean
}

export interface ReviewRound {
  readonly id: string
  readonly number: number
  readonly stageKey: string
  readonly requestedBy: string
  readonly openedAt: string
  readonly state: RoundState
  readonly closedAt: string | null
  readonly closedBy: string | null
  readonly reviewers: readonly {
    userId: string
    verdict: Verdict | null
    comment: string | null
    at: string | null
  }[]
  readonly history: readonly {
    userId: string
    verdict: Verdict
    comment: string | null
    at: string
  }[]
}

export interface Reviews {
  readonly reviewStage: { stageKey: string; sendBackTo: string } | null
  readonly approved: boolean
  readonly canOpen: boolean
  readonly canVerdict: boolean
  readonly canWithdraw: boolean
  readonly rounds: readonly ReviewRound[]
}

export interface RecordSummary {
  readonly id: string
  readonly typeKey: string
  readonly teamId: string
  readonly title: string
  readonly values: Readonly<Record<string, RecordValue>>
  readonly archived: boolean
  readonly createdAt: string
  readonly updatedAt: string
}

export interface RecordDetail {
  readonly record: RecordSummary
  readonly type: RecordType | null
  readonly canEdit: boolean
  readonly canArchive: boolean
  readonly items: readonly {
    id: string
    key: string
    title: string
    statusId: string
    teamId: string
  }[]
  readonly history: readonly {
    actorId: string | null
    action: 'created' | 'edited' | 'archived'
    changes: readonly { field: string; from: RecordValue; to: RecordValue }[]
    at: string
  }[]
}

export interface ItemRecord {
  readonly record: RecordSummary | null
  readonly type: RecordType | null
  readonly canLink: boolean
}

export interface ItemCode {
  readonly pullRequests: readonly {
    repo: string
    number: number
    url: string | null
    title: string | null
    state: 'open' | 'merged' | 'closed'
    checks: 'passing' | 'failing' | null
    updatedAt: string
  }[]
  readonly events: readonly {
    repo: string
    number: number
    kind: string
    outcome: 'moved' | 'not_moved' | 'no_rule'
    detail: string | null
    at: string
  }[]
}

export interface CommentView {
  readonly id: string
  readonly authorId: string
  readonly body: string | null
  readonly internal: boolean
  readonly createdAt: string
  readonly editedAt: string | null
  readonly deletedAt: string | null
  readonly deletedBy: string | null
  readonly canEdit: boolean
  readonly canDelete: boolean
}

export interface Comments {
  readonly canComment: boolean
  readonly comments: readonly CommentView[]
  readonly notNotified?: readonly { id: string; name: string }[]
}

export interface InboxEntry {
  readonly id: string
  readonly kind: InboxKind
  readonly itemId: string
  readonly itemKey: string
  readonly itemTitle: string
  readonly actorId: string | null
  readonly excerpt: string | null
  readonly createdAt: string
  readonly read: boolean
}

export interface Me extends ApiUser {
  readonly orgRole: 'org_admin' | 'member' | 'viewer'
  readonly teams: Readonly<Record<string, 'admin' | 'member'>>
}

const REASONS: Record<number, string> = {
  400: 'the server did not accept that value',
  401: 'you are not signed in',
  403: 'you can only change items in your own teams',
  404: 'that item is no longer available to you',
}

/** Turns a refusal into a sentence a person can act on. */
function explain(
  status: number,
  body: { error?: string; missing?: string[]; field?: string },
): string {
  switch (body.error) {
    case 'end_stage':
      return 'done and cancelled stages cannot have limits'
    case 'invalid_limit':
      return 'a limit must be a whole number from 1 to 999'
    case 'invalid_target':
      return 'a target must be a whole number of hours from 1 to 8760'
    case 'empty_comment':
      return 'write something first'
    case 'deleted':
      return 'that comment was deleted'
    case 'invalid_value':
      return `the value for ${body.field ?? 'a field'} does not fit it`
    case 'required_missing':
      return `${body.field ?? 'a required field'} is required`
    case 'unknown_record':
      return 'that record is not available'
    case 'archived':
      return 'that record is archived'
    case 'self_review':
      return 'nobody can review their own work: not whoever asks for the review, nor the stage owner'
    case 'not_a_reviewer':
      return 'one of those people cannot review items in this team'
    case 'round_open':
      return 'a review round is already open for this item'
    case 'round_closed':
      return 'that review round has already closed'
    case 'comment_required':
      return 'say what needs to change'
    case 'not_review_stage':
      return 'this stage does not take reviews'
    case 'not_reviewer':
      return 'you are not a reviewer in this round'
    case 'already_approved':
      return 'this stage has already been approved'
    case 'send_back_invalid':
      return 'the stage to send items back to is not set up correctly; ask a team admin'
    case 'requirements_unmet':
      return `this stage still needs: ${(body.missing ?? []).join(', ')}`
    case 'not_allowed':
      return 'that stage cannot be reached from here'
    case 'reason_required':
      return 'that move needs a reason'
    case 'cannot_force':
      return 'only a team admin can force that move'
    default:
      return REASONS[status] ?? `the server rejected that (${status})`
  }
}

/**
 * Talks to the API through the Vite dev proxy (/api). `getUser` supplies the development
 * sign-in header; real sign-in replaces this later.
 */
export function createApi(getUser: () => string) {
  async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    let response: Response
    try {
      response = await fetch(`/api${path}`, {
        ...init,
        headers: {
          // Only say the body is JSON when there is one; an empty JSON body is refused.
          ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
          'x-dev-user': getUser(),
          ...init.headers,
        },
      })
    } catch {
      throw new Error('the server could not be reached')
    }
    if (!response.ok) {
      let body: { error?: string; missing?: string[]; field?: string } = {}
      try {
        body = (await response.json()) as typeof body
      } catch {
        // No readable body: fall back to the status code.
      }
      throw new Error(explain(response.status, body))
    }
    return (await response.json()) as T
  }

  return {
    me: () => request<Me>('/me'),
    users: () => request<{ users: ApiUser[] }>('/users').then((body) => body.users),
    teams: () => request<{ teams: ApiTeam[] }>('/teams').then((body) => body.teams),
    itemsPage: (after: string | null, limit = 200) =>
      request<{ items: WorkItem[]; nextAfter: string | null }>(
        `/items?limit=${limit}${after ? `&after=${after}` : ''}`,
      ),
    getItem: (idOrKey: string) =>
      request<{ item: WorkItem }>(`/items/${encodeURIComponent(idOrKey)}`).then((b) => b.item),
    workflow: (id: string) => request<Workflow>(`/items/${encodeURIComponent(id)}/workflow`),
    stageHistory: (id: string) =>
      request<{ history: HistoryEntry[] }>(`/items/${encodeURIComponent(id)}/stages`).then(
        (b) => b.history,
      ),
    tickStep: (id: string, stepId: string, ticked: boolean) =>
      request<Workflow>(`/items/${encodeURIComponent(id)}/steps/${encodeURIComponent(stepId)}`, {
        method: 'POST',
        body: JSON.stringify({ ticked }),
      }),
    /** A stage move that may need a reason (reopening) or be forced by a team admin. */
    moveItem: async (
      id: string,
      statusId: string,
      options: { reason?: string; force?: boolean } = {},
    ): Promise<WorkItem | null> => {
      const body = await request<{ item: WorkItem | null }>(`/items/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ statusId, ...options }),
      })
      return body.item
    },
    reviews: (id: string) => request<Reviews>(`/items/${encodeURIComponent(id)}/reviews`),
    openReview: (id: string, reviewers: readonly string[]) =>
      request<Reviews>(`/items/${encodeURIComponent(id)}/reviews`, {
        method: 'POST',
        body: JSON.stringify({ reviewers }),
      }),
    giveVerdict: (roundId: string, verdict: Verdict, comment: string) =>
      request<Reviews>(`/reviews/${encodeURIComponent(roundId)}/verdict`, {
        method: 'POST',
        body: JSON.stringify(comment.trim() ? { verdict, comment } : { verdict }),
      }),
    withdrawReview: (roundId: string) =>
      request<Reviews>(`/reviews/${encodeURIComponent(roundId)}/withdraw`, {
        method: 'POST',
        body: '{}',
      }),
    comments: (id: string) => request<Comments>(`/items/${encodeURIComponent(id)}/comments`),
    addComment: (id: string, body: string, internal: boolean) =>
      request<Comments>(`/items/${encodeURIComponent(id)}/comments`, {
        method: 'POST',
        body: JSON.stringify({ body, internal }),
      }),
    editComment: (commentId: string, body: string) =>
      request<Comments>(`/comments/${encodeURIComponent(commentId)}`, {
        method: 'PATCH',
        body: JSON.stringify({ body }),
      }),
    deleteComment: (commentId: string) =>
      request<Comments>(`/comments/${encodeURIComponent(commentId)}`, { method: 'DELETE' }),
    inbox: () => request<{ unread: number; entries: InboxEntry[] }>('/inbox'),
    markRead: (ids?: readonly string[]) =>
      request<{ ok: boolean }>('/inbox/read', {
        method: 'POST',
        body: JSON.stringify(ids ? { ids } : {}),
      }),
    code: (id: string) => request<ItemCode>(`/items/${encodeURIComponent(id)}/code`),
    board: (teamId: string) =>
      request<{ counts: Record<string, number>; enteredAt: Record<string, string> }>(
        `/teams/${encodeURIComponent(teamId)}/board`,
      ),
    setLimits: (
      teamId: string,
      stageKey: string,
      itemLimit: number | null,
      targetHours: number | null,
    ) =>
      request<{ stageKey: string; itemLimit: number | null; targetHours: number | null }>(
        `/teams/${encodeURIComponent(teamId)}/stages/${encodeURIComponent(stageKey)}/limits`,
        { method: 'PUT', body: JSON.stringify({ itemLimit, targetHours }) },
      ),
    itemRecord: (id: string) => request<ItemRecord>(`/items/${encodeURIComponent(id)}/record`),
    linkRecord: (id: string, recordId: string | null) =>
      request<{ item: WorkItem | null }>(`/items/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ recordId }),
      }),
    findRecords: (q: string) =>
      request<{ records: RecordSummary[] }>(`/records?q=${encodeURIComponent(q)}`).then(
        (body) => body.records,
      ),
    record: (id: string) => request<RecordDetail>(`/records/${encodeURIComponent(id)}`),
    updateRecord: (id: string, patch: { title?: string; values?: Record<string, RecordValue> }) =>
      request<RecordDetail>(`/records/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      }),
    archiveRecord: (id: string) =>
      request<RecordDetail>(`/records/${encodeURIComponent(id)}/archive`, {
        method: 'POST',
        body: '{}',
      }),
    /** Sends one change and returns the item as the server now has it. */
    saveItem: async (item: WorkItem, patch: ItemPatch): Promise<WorkItem | null> => {
      const body = await request<{ item: WorkItem | null }>(
        `/items/${encodeURIComponent(item.id)}`,
        { method: 'PATCH', body: JSON.stringify(patch) },
      )
      return body.item
    },
  }
}

export type Api = ReturnType<typeof createApi>
