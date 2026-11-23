// specs/design-system.md section 9, checks 1 and 2: colours live only in tokens.css, and every
// text and background pair is readable in both modes.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = join(__dirname, '..', 'src')
const css = readFileSync(join(SRC, 'design', 'tokens.css'), 'utf8')

type RGBA = [number, number, number, number]

function block(theme: 'dark' | 'light'): Record<string, string> {
  const start = css.indexOf(`[data-theme='${theme}']`)
  const body = css.slice(css.indexOf('{', start) + 1, css.indexOf('\n}', start))
  const base = css.slice(css.indexOf('{') + 1, css.indexOf('\n}'))
  const out: Record<string, string> = {}
  for (const src of [base, body]) {
    for (const m of src.matchAll(/--([\w-]+):\s*([^;]+);/g))
      out[m[1] as string] = (m[2] as string).trim()
  }
  return out
}

function parse(value: string): RGBA {
  const hex = /^#([0-9a-f]{6})$/i.exec(value)
  if (hex) {
    const n = parseInt(hex[1] as string, 16)
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1]
  }
  const rgb = /^rgb\((\d+) (\d+) (\d+)(?: \/ (\d+)%)?\)$/.exec(value)
  if (rgb)
    return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3]), rgb[4] ? Number(rgb[4]) / 100 : 1]
  throw new Error(`Cannot read colour ${value}`)
}

function over(top: RGBA, under: RGBA): RGBA {
  const a = top[3]
  return [
    top[0] * a + under[0] * (1 - a),
    top[1] * a + under[1] * (1 - a),
    top[2] * a + under[2] * (1 - a),
    1,
  ]
}

function luminance([r, g, b]: RGBA): number {
  const f = (c: number) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}

function contrast(a: RGBA, b: RGBA): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
  return (hi + 0.05) / (lo + 0.05)
}

/** [text token, background token]; backgrounds that are see-through sit on --surface. */
const PAIRS: [string, string][] = [
  ['text', 'surface'],
  ['text', 'bg-base'],
  ['text', 'surface-2'],
  ['text-2', 'surface'],
  ['muted', 'surface'],
  ['muted', 'surface-2'],
  ['muted', 'bg-base'],
  ['accent-text', 'surface'],
  ['accent-text', 'accent-soft'],
  ['danger', 'surface'],
  ['danger', 'danger-soft'],
  ['warn-text', 'warn-bg'],
  ['avatar-text', 'avatar-bg'],
  ['tooltip-text', 'tooltip-bg'],
  ['waiting-fg', 'waiting-bg'],
  ['doing-fg', 'doing-bg'],
  ['review-fg', 'review-bg'],
  ['done-fg', 'done-bg'],
  ['urgent-fg', 'urgent-bg'],
  ['high-fg', 'high-bg'],
  ['on-accent', 'accent'],
]

describe('Midnight tokens', () => {
  for (const theme of ['dark', 'light'] as const) {
    const t = block(theme)
    it.each(PAIRS)(`${theme}: %s on %s meets 4.5 to 1`, (fg, bg) => {
      const surface = parse(t['surface'] as string)
      const back = over(parse(t[bg] as string), surface)
      const ratio = contrast(over(parse(t[fg] as string), back), back)
      expect(ratio).toBeGreaterThanOrEqual(4.5)
    })
  }

  it('defines the same token names in dark and light', () => {
    const names = (theme: 'dark' | 'light') => {
      const start = css.indexOf(`[data-theme='${theme}']`)
      const body = css.slice(start, css.indexOf('\n}', start))
      return [...body.matchAll(/--([\w-]+):/g)].map((m) => m[1]).sort()
    }
    expect(names('light')).toEqual(names('dark'))
  })
})

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? files(path) : [path]
  })
}

/** Folders that belong to the new Midnight UI. Old screens are removed as these replace them. */
const MIDNIGHT_DIRS = ['design', 'app']
  .map((d) => join(SRC, d))
  .filter((d) => {
    try {
      return statSync(d).isDirectory()
    } catch {
      return false
    }
  })

describe('no colour values outside tokens.css', () => {
  const offenders = MIDNIGHT_DIRS.flatMap(files)
    .filter((f) => !f.endsWith('tokens.css') && /\.(tsx?|css)$/.test(f))
    .flatMap((f) => {
      const text = readFileSync(f, 'utf8')
      const hits = text.match(/#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/g) ?? []
      return hits.map((h) => `${f.slice(SRC.length + 1)}: ${h}`)
    })

  it('finds none', () => {
    expect(offenders).toEqual([])
  })
})
