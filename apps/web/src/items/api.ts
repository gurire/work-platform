import type { WorkItem } from '@wm/shared'
import type { ItemPatch } from './store'

export interface ApiUser {
  readonly id: string
  readonly name: string
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
      throw new Error(REASONS[response.status] ?? `the server rejected that (${response.status})`)
    }
    return (await response.json()) as T
  }

  return {
    me: () => request<Me>('/me'),
    users: () => request<{ users: ApiUser[] }>('/users').then((body) => body.users),
    itemsPage: (after: string | null, limit = 200) =>
      request<{ items: WorkItem[]; nextAfter: string | null }>(
        `/items?limit=${limit}${after ? `&after=${after}` : ''}`,
      ),
    saveItem: async (item: WorkItem, patch: ItemPatch): Promise<void> => {
      await request(`/items/${encodeURIComponent(item.id)}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      })
    },
  }
}

export type Api = ReturnType<typeof createApi>
