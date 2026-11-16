// Sends a signed, made-up GitHub event to the local API, to try status that follows the code
// (specs/code-status.md) without a real GitHub connection.
//
//   pnpm code-event opened ENG-12        pull request #<n> opened on branch eng-12-...
//   pnpm code-event failed ENG-12        checks failed on it
//   pnpm code-event passed ENG-12        checks passed on it
//   pnpm code-event merged ENG-12        merged
//   pnpm code-event closed ENG-12        closed without merging
//
// Uses the development secret unless WM_CODE_WEBHOOK_SECRET is set. Never point it at a
// server other than your own machine.
import { createHmac } from 'node:crypto'

const [action, key, prArg] = process.argv.slice(2)
const actions = ['opened', 'failed', 'passed', 'merged', 'closed']
if (!actions.includes(action ?? '') || !/^[A-Za-z][A-Za-z0-9]{1,9}-\d{1,7}$/.test(key ?? '')) {
  console.error(`Usage: pnpm code-event <${actions.join('|')}> <ITEM-KEY> [pull request number]`)
  process.exit(1)
}
const number = Number(prArg ?? (Number(key.split('-')[1]) % 900) + 100)
const branch = `${key.toLowerCase()}-sample-change`
const repository = { full_name: 'example/work-platform-sample' }
const pullRequest = {
  number,
  html_url: `https://github.com/example/work-platform-sample/pull/${number}`,
  title: `${key.toUpperCase()}: sample change`,
  head: { ref: branch },
  draft: false,
  merged: action === 'merged',
}
const isChecks = action === 'failed' || action === 'passed'
const event = isChecks ? 'check_suite' : 'pull_request'
const payload = isChecks
  ? {
      action: 'completed',
      check_suite: {
        conclusion: action === 'passed' ? 'success' : 'failure',
        head_branch: branch,
        pull_requests: [{ number, head: { ref: branch } }],
      },
      repository,
    }
  : {
      action: action === 'opened' ? 'opened' : 'closed',
      pull_request: pullRequest,
      repository,
    }

const body = JSON.stringify(payload)
const secret = process.env.WM_CODE_WEBHOOK_SECRET ?? 'dev-only-code-webhook-secret'
const signature = `sha256=${createHmac('sha256', secret).update(body, 'utf8').digest('hex')}`
const url = `http://127.0.0.1:${process.env.PORT ?? 3000}/integrations/github`

const response = await fetch(url, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'x-github-event': event,
    'x-hub-signature-256': signature,
  },
  body,
}).catch(() => null)
if (!response) {
  console.error('The API is not running. Start it with pnpm dev first.')
  process.exit(1)
}
const result = await response.json()
if (!response.ok) {
  console.error(`Refused (${response.status}):`, result)
  process.exit(1)
}
if (result.results.length === 0) console.log(`No item called ${key.toUpperCase()} was found.`)
for (const r of result.results) {
  console.log(`${r.item}: ${r.outcome.replace('_', ' ')}${r.detail ? ` (${r.detail})` : ''}`)
}
