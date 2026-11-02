import { afterAll, describe, expect, it } from 'vitest'
import { buildApp } from '../src/app.js'

describe('api', () => {
  const app = buildApp()
  afterAll(() => app.close())

  it('reports health', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ status: 'ok' })
  })

  it('lists work item kinds from the shared model', async () => {
    const res = await app.inject({ method: 'GET', url: '/meta/work-item-kinds' })
    expect(res.json().kinds).toContain('incident')
  })
})
