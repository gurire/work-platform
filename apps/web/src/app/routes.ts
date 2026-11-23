/**
 * Addresses of the Midnight app. They live under #/m/ while the old screens still answer the
 * other addresses; once the new pages are complete the /m prefix goes.
 */
export type MRoute =
  | { page: 'home' }
  | { page: 'inbox' }
  | { page: 'project'; id: string }
  | { page: 'team'; id: string }
  | { page: 'item'; key: string }
  | { page: 'plan' }
  | { page: 'dashboard' }
  | { page: 'requests' }
  | { page: 'settings'; teamId?: string }
  | { page: 'kit' }
  | { page: 'not-found'; path: string }

export const PREFIX = '#/m'

export function isMidnightHash(hash: string): boolean {
  return hash === PREFIX || hash.startsWith(`${PREFIX}/`)
}

const ITEM_KEY = /^[A-Z]{2,6}-\d+$/

export function parseMRoute(hash: string): MRoute {
  const path = hash.startsWith(PREFIX) ? hash.slice(PREFIX.length) : hash.replace(/^#/, '')
  const parts = path.split('/').filter(Boolean).map(decodeURIComponent)
  const [first, second] = parts
  if (!first || first === 'home') return { page: 'home' }
  if (parts.length === 1) {
    if (
      first === 'inbox' ||
      first === 'plan' ||
      first === 'dashboard' ||
      first === 'requests' ||
      first === 'kit'
    ) {
      return { page: first }
    }
    if (first === 'settings') return { page: 'settings' }
  }
  if (parts.length === 2 && second) {
    if (first === 'projects') return { page: 'project', id: second }
    if (first === 'teams') return { page: 'team', id: second }
    if (first === 'items' && ITEM_KEY.test(second)) return { page: 'item', key: second }
    if (first === 'settings') return { page: 'settings', teamId: second }
  }
  return { page: 'not-found', path }
}

export function hrefFor(route: MRoute): string {
  switch (route.page) {
    case 'home':
      return `${PREFIX}/home`
    case 'project':
      return `${PREFIX}/projects/${encodeURIComponent(route.id)}`
    case 'team':
      return `${PREFIX}/teams/${encodeURIComponent(route.id)}`
    case 'item':
      return `${PREFIX}/items/${route.key}`
    case 'settings':
      return route.teamId
        ? `${PREFIX}/settings/${encodeURIComponent(route.teamId)}`
        : `${PREFIX}/settings`
    case 'not-found':
      return `${PREFIX}/home`
    default:
      return `${PREFIX}/${route.page}`
  }
}
