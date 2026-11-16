/**
 * PROTECTED TEST. specs/code-status.md, rules 2, 3 and 6, and the GitHub event mapping.
 * Human-owned once the spec is merged: do not edit to make code pass.
 */
import { describe, expect, it } from 'vitest'
import { describeCodeEvent, extractItemKeys, fromGitHub } from '../../src/index.js'

const repository = { full_name: 'acme/app' }
const pr = (extra: object = {}) => ({
  number: 31,
  html_url: 'https://github.com/acme/app/pull/31',
  title: 'Fix login timeout',
  head: { ref: 'eng-142-login-timeout' },
  draft: false,
  merged: false,
  ...extra,
})

describe('finding items (rule 2)', () => {
  it('finds keys in a branch or title in any letter case', () => {
    expect(extractItemKeys('eng-142-login-timeout', 'Fix login timeout')).toEqual(['ENG-142'])
    expect(extractItemKeys('feature/x', 'DATA-7 and ENG-9: tidy')).toEqual(['DATA-7', 'ENG-9'])
    expect(extractItemKeys('ENG-142', 'ENG-142 again')).toEqual(['ENG-142'])
  })

  it('ignores things that are not shaped like keys', () => {
    expect(extractItemKeys('x-1', null, undefined, '')).toEqual([]) // one-letter prefix
    expect(extractItemKeys('ENG-12345678')).toEqual([]) // more than 7 digits
    expect(extractItemKeys('ENG142 eng_142 ENG-')).toEqual([])
    expect(extractItemKeys('2026-11')).toEqual([]) // must start with a letter
  })

  it('stops at 10 items', () => {
    const many = Array.from({ length: 15 }, (_, i) => `ENG-${i + 1}`).join(' ')
    expect(extractItemKeys(many)).toHaveLength(10)
  })
})

describe('GitHub events (rule 3)', () => {
  it('example 1: an opened pull request', () => {
    expect(
      fromGitHub('pull_request', { action: 'opened', pull_request: pr(), repository }),
    ).toEqual([
      {
        kind: 'pr_opened',
        repo: 'acme/app',
        prNumber: 31,
        prUrl: 'https://github.com/acme/app/pull/31',
        prTitle: 'Fix login timeout',
        branch: 'eng-142-login-timeout',
      },
    ])
  })

  it('draft pull requests do not count as opened until ready', () => {
    expect(
      fromGitHub('pull_request', {
        action: 'opened',
        pull_request: pr({ draft: true }),
        repository,
      }),
    ).toEqual([])
    expect(
      fromGitHub('pull_request', { action: 'ready_for_review', pull_request: pr(), repository })[0]
        ?.kind,
    ).toBe('pr_opened')
  })

  it('example 4: merged, and closed without merging', () => {
    const merged = { action: 'closed', pull_request: pr({ merged: true }), repository }
    const closed = { action: 'closed', pull_request: pr(), repository }
    expect(fromGitHub('pull_request', merged)[0]?.kind).toBe('pr_merged')
    expect(fromGitHub('pull_request', closed)[0]?.kind).toBe('pr_closed')
  })

  it('examples 2 and 3: completed check suites', () => {
    const suite = (conclusion: string) => ({
      action: 'completed',
      check_suite: {
        conclusion,
        head_branch: 'eng-142-login-timeout',
        pull_requests: [{ number: 31, head: { ref: 'eng-142-login-timeout' } }],
      },
      repository,
    })
    expect(fromGitHub('check_suite', suite('failure'))[0]).toMatchObject({
      kind: 'checks_failed',
      prNumber: 31,
      branch: 'eng-142-login-timeout',
    })
    expect(fromGitHub('check_suite', suite('success'))[0]?.kind).toBe('checks_passed')
    expect(fromGitHub('check_suite', suite('neutral'))).toEqual([])
  })

  it('anything else, or anything malformed, gives no events', () => {
    expect(fromGitHub('push', { repository })).toEqual([])
    expect(fromGitHub('pull_request', { action: 'opened', repository })).toEqual([])
    expect(fromGitHub('pull_request', null)).toEqual([])
    expect(fromGitHub('pull_request', { action: 'opened', pull_request: pr() })).toEqual([])
    expect(
      fromGitHub('pull_request', { action: 'labeled', pull_request: pr(), repository }),
    ).toEqual([])
  })
})

describe('reasons (rule 6)', () => {
  it('says what happened', () => {
    expect(describeCodeEvent({ kind: 'pr_merged', prNumber: 31 })).toBe('Pull request #31 merged')
    expect(describeCodeEvent({ kind: 'checks_failed', prNumber: 31 })).toBe('Checks failed on #31')
  })
})
