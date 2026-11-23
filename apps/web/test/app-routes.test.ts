import { describe, expect, it } from 'vitest'
import { hrefFor, isMidnightHash, parseMRoute, type MRoute } from '../src/app/routes'

describe('Midnight addresses', () => {
  it('only claims #/m addresses', () => {
    expect(isMidnightHash('#/m')).toBe(true)
    expect(isMidnightHash('#/m/home')).toBe(true)
    expect(isMidnightHash('#/me')).toBe(false)
    expect(isMidnightHash('#/items/DATA-1')).toBe(false)
  })

  it('opens My work by default', () => {
    expect(parseMRoute('#/m')).toEqual({ page: 'home' })
    expect(parseMRoute('#/m/')).toEqual({ page: 'home' })
  })

  it('round-trips every page', () => {
    const routes: MRoute[] = [
      { page: 'home' },
      { page: 'inbox' },
      { page: 'project', id: 'census-refresh' },
      { page: 'team', id: 'data' },
      { page: 'item', key: 'DATA-14' },
      { page: 'plan' },
      { page: 'dashboard' },
      { page: 'requests' },
      { page: 'settings' },
      { page: 'settings', teamId: 'data' },
      { page: 'kit' },
    ]
    for (const r of routes) expect(parseMRoute(hrefFor(r))).toEqual(r)
  })

  it('refuses malformed item keys and unknown pages', () => {
    expect(parseMRoute('#/m/items/data-14').page).toBe('not-found')
    expect(parseMRoute('#/m/nowhere').page).toBe('not-found')
  })
})
