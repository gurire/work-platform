// Fails if any production dependency uses a licence that is risky for a proprietary,
// self-hosted product (strong copyleft, network copyleft or source-available).
// See docs/adr/0005-licences.md. Run with: pnpm check:licenses
import { execSync } from 'node:child_process'

const BLOCKED = [
  /\bAGPL/i,
  /\bGPL/i,
  /\bLGPL/i,
  /\bSSPL/i,
  /\bBUSL/i,
  /Commons-Clause/i,
  /\bEUPL/i,
  /\bOSL/i,
]
// LGPL is blocked by default and needs an explicit exception after review.
const ALLOWED_PACKAGES = new Set([])

const raw = execSync('pnpm licenses list --prod --json', { encoding: 'utf8' })
const byLicence = JSON.parse(raw)
const problems = []
let count = 0
for (const [licence, packages] of Object.entries(byLicence)) {
  for (const pkg of packages) {
    count++
    if (ALLOWED_PACKAGES.has(pkg.name)) continue
    if (licence === 'Unknown' || BLOCKED.some((re) => re.test(licence))) {
      problems.push(`${pkg.name}@${(pkg.versions ?? [pkg.version]).join(',')}: ${licence}`)
    }
  }
}

if (problems.length) {
  console.error(
    `Licence check failed for ${problems.length} package(s):\n  ${problems.join('\n  ')}`,
  )
  process.exit(1)
}
console.log(`Licence check passed for ${count} production package(s).`)
