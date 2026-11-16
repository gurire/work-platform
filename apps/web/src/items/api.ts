import type { Stage, StageTransition, WorkItem } from '@wm/shared'
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
  readonly missing: readonly string[]
  readonly allowedMoves: readonly string[]
  readonly canForce: boolean
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
function explain(status: number, body: { error?: string; missing?: string[] }): string {
  switch (body.error) {
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
        headers: { 'content-type': 'application/json', 'x-dev-user': getUser(), ...init.headers },
      })
    } catch {
      throw new Error('the server could not be reached')
    }
    if (!response.ok) {
      let body: { error?: string; missing?: string[] } = {}
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
