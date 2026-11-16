/**
 * Code events. Implements specs/code-status.md, rules 2 and 3: which items an event is about,
 * and how a GitHub webhook maps to a code event. Pure functions; signatures are checked by the
 * API before anything here runs.
 */

export const CODE_EVENT_KINDS = [
  'pr_opened',
  'checks_passed',
  'checks_failed',
  'pr_merged',
  'pr_closed',
] as const
export type CodeEventKind = (typeof CODE_EVENT_KINDS)[number]

export interface CodeEvent {
  readonly kind: CodeEventKind
  readonly repo: string
  readonly prNumber: number
  readonly prUrl: string | null
  readonly prTitle: string | null
  readonly branch: string | null
}

export const MAX_ITEMS_PER_EVENT = 10

/** Item keys such as ENG-142 in a branch name or title, in any letter case (rule 2). */
export function extractItemKeys(...texts: readonly (string | null | undefined)[]): string[] {
  const keys = new Set<string>()
  for (const text of texts) {
    if (!text) continue
    for (const match of text.matchAll(
      /(?<![A-Za-z0-9])([A-Za-z][A-Za-z0-9]{1,9})-(\d{1,7})(?![0-9])/g,
    )) {
      keys.add(`${(match[1] ?? '').toUpperCase()}-${match[2] ?? ''}`)
      if (keys.size >= MAX_ITEMS_PER_EVENT) return [...keys]
    }
  }
  return [...keys]
}

/** Why an automatic move happened, as shown on the item (rule 6). */
export function describeCodeEvent(event: Pick<CodeEvent, 'kind' | 'prNumber'>): string {
  const pr = `#${event.prNumber}`
  switch (event.kind) {
    case 'pr_opened':
      return `Pull request ${pr} opened`
    case 'checks_passed':
      return `Checks passed on ${pr}`
    case 'checks_failed':
      return `Checks failed on ${pr}`
    case 'pr_merged':
      return `Pull request ${pr} merged`
    case 'pr_closed':
      return `Pull request ${pr} closed without merging`
  }
}

type Json = Record<string, unknown>
const obj = (value: unknown): Json | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Json) : null
const str = (value: unknown): string | null => (typeof value === 'string' ? value : null)
const num = (value: unknown): number | null =>
  typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null

/**
 * Turns a GitHub webhook (the `X-GitHub-Event` name and its JSON body) into code events.
 * Anything not understood gives no events; it is never an error.
 */
export function fromGitHub(eventName: string, payload: unknown): CodeEvent[] {
  const body = obj(payload)
  const repo = str(obj(body?.['repository'])?.['full_name'])
  if (!body || !repo) return []

  if (eventName === 'pull_request') {
    const pr = obj(body['pull_request'])
    const prNumber = num(pr?.['number'])
    if (!pr || prNumber === null) return []
    const action = str(body['action'])
    let kind: CodeEventKind | null = null
    if (action === 'opened' || action === 'reopened' || action === 'ready_for_review') {
      kind = pr['draft'] === true ? null : 'pr_opened'
    } else if (action === 'closed') {
      kind = pr['merged'] === true ? 'pr_merged' : 'pr_closed'
    }
    if (!kind) return []
    return [
      {
        kind,
        repo,
        prNumber,
        prUrl: str(pr['html_url']),
        prTitle: str(pr['title']),
        branch: str(obj(pr['head'])?.['ref']),
      },
    ]
  }

  if (eventName === 'check_suite') {
    const suite = obj(body['check_suite'])
    if (!suite || str(body['action']) !== 'completed') return []
    const conclusion = str(suite['conclusion'])
    let kind: CodeEventKind | null = null
    if (conclusion === 'success') kind = 'checks_passed'
    else if (conclusion === 'failure' || conclusion === 'timed_out' || conclusion === 'cancelled') {
      kind = 'checks_failed'
    }
    if (!kind) return []
    const prs = Array.isArray(suite['pull_requests']) ? suite['pull_requests'] : []
    const events: CodeEvent[] = []
    for (const entry of prs.slice(0, MAX_ITEMS_PER_EVENT)) {
      const pr = obj(entry)
      const prNumber = num(pr?.['number'])
      if (!pr || prNumber === null) continue
      events.push({
        kind,
        repo,
        prNumber,
        prUrl: null,
        prTitle: null,
        branch: str(obj(pr['head'])?.['ref']) ?? str(suite['head_branch']),
      })
    }
    return events
  }

  return []
}
