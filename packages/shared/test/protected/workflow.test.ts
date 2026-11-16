/**
 * PROTECTED TEST. Generated from specs/workflow.md, section 3 (worked examples), approved
 * 16 Nov 2026. Human-owned: do not edit to make code pass. Example 12 (re-entry) and example 16
 * (viewer) are checked on the API surface and in the permission tests.
 */
import { describe, expect, it } from 'vitest'
import { allowedDestinations, checkMove, type MoveRequest, type Stage } from '../../src/index.js'

const stage = (key: string, category: Stage['category'], position: number): Stage => ({
  teamId: 'T',
  key,
  name: key,
  category,
  position,
})

const stages = [
  stage('analysis', 'todo', 1),
  stage('sourcing', 'in_progress', 2),
  stage('validation', 'in_progress', 3),
  stage('client_review', 'in_progress', 4),
  stage('published', 'done', 5),
  stage('dropped', 'cancelled', 6),
]

const move = (over: Partial<MoveRequest>) =>
  checkMove({
    stages,
    transitions: [],
    fromKey: 'validation',
    toKey: 'client_review',
    missing: [],
    force: false,
    canForce: false,
    ...over,
  })

describe('workflow worked examples (spec section 3)', () => {
  it('1: refuses a forward move with an unticked step, naming it', () => {
    expect(move({ missing: ['Units confirmed'] })).toEqual({
      ok: false,
      error: 'requirements_unmet',
      missing: ['Units confirmed'],
    })
  })

  it('2: refuses a forward move with an empty required field, naming it', () => {
    expect(move({ missing: ['Coverage'] })).toMatchObject({ ok: false, missing: ['Coverage'] })
  })

  it('3: allows the move when everything is met', () => {
    expect(move({})).toEqual({ ok: true, kind: 'move' })
  })

  it('4: allows moving back without requirements', () => {
    expect(move({ toKey: 'sourcing', missing: ['Totals checked'] })).toEqual({
      ok: true,
      kind: 'move',
    })
  })

  it('5: allows moving to a cancelled stage without requirements', () => {
    expect(move({ toKey: 'dropped', missing: ['Totals checked'] })).toEqual({
      ok: true,
      kind: 'move',
    })
  })

  it('6: refuses skipping to a stage that is not next or previous', () => {
    expect(move({ fromKey: 'analysis', toKey: 'validation' })).toEqual({
      ok: false,
      error: 'not_allowed',
    })
  })

  it('7: lets a team admin force past unmet requirements with a reason', () => {
    expect(
      move({ missing: ['Units confirmed'], force: true, canForce: true, reason: 'Client asked' }),
    ).toEqual({ ok: true, kind: 'forced' })
  })

  it('8: refuses a forced move without a reason', () => {
    expect(
      move({ missing: ['Units confirmed'], force: true, canForce: true, reason: '  ' }),
    ).toEqual({ ok: false, error: 'reason_required' })
  })

  it('9 and 10: refuses a forced move by someone who may not force (member, agent)', () => {
    expect(
      move({ missing: ['Units confirmed'], force: true, canForce: false, reason: 'Please' }),
    ).toEqual({ ok: false, error: 'cannot_force' })
  })

  it('11: forcing never skips allowed destinations', () => {
    expect(
      move({ fromKey: 'analysis', missing: ['x'], force: true, canForce: true, reason: 'Urgent' }),
    ).toEqual({ ok: false, error: 'not_allowed' })
  })

  it('13: reopens a done item with a reason, to the nearest earlier stage', () => {
    expect(allowedDestinations(stages, 'published', [])).toEqual(['client_review'])
    expect(move({ fromKey: 'published', reason: 'Source corrected' })).toEqual({
      ok: true,
      kind: 'reopen',
    })
  })

  it('14: refuses reopening without a reason', () => {
    expect(move({ fromKey: 'published' })).toEqual({ ok: false, error: 'reason_required' })
  })

  it('15: reopens a cancelled item to the nearest earlier stage that is not an end stage', () => {
    expect(allowedDestinations(stages, 'dropped', [])).toEqual(['client_review'])
    expect(move({ fromKey: 'dropped', reason: 'Source back online' })).toEqual({
      ok: true,
      kind: 'reopen',
    })
  })
})

describe('workflow rules', () => {
  it('default moves are next, previous and any end stage (rule 4)', () => {
    expect(allowedDestinations(stages, 'validation', []).sort()).toEqual(
      ['client_review', 'dropped', 'published', 'sourcing'].sort(),
    )
    expect(allowedDestinations(stages, 'analysis', []).sort()).toEqual(
      ['dropped', 'published', 'sourcing'].sort(),
    )
  })

  it('listed moves replace the default for that stage only', () => {
    const transitions = [{ from: 'analysis', to: 'validation' }]
    expect(allowedDestinations(stages, 'analysis', transitions)).toEqual(['validation'])
    expect(move({ fromKey: 'analysis', toKey: 'validation', transitions })).toEqual({
      ok: true,
      kind: 'move',
    })
    expect(allowedDestinations(stages, 'sourcing', transitions)).toContain('validation')
  })

  it('moving to a done stage needs the requirements (rule 2)', () => {
    expect(
      move({ fromKey: 'client_review', toKey: 'published', missing: ['Sign-off'] }),
    ).toMatchObject({
      ok: false,
      error: 'requirements_unmet',
    })
  })

  it('refuses unknown stages', () => {
    expect(move({ toKey: 'nowhere' })).toEqual({ ok: false, error: 'unknown_stage' })
  })
})
