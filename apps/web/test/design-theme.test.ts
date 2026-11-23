import { describe, expect, it } from 'vitest'
import { parseChoice, resolveTheme } from '../src/design/theme'

describe('theme choice', () => {
  it('defaults to dark', () => {
    expect(parseChoice(null)).toBe('dark')
    expect(parseChoice('purple')).toBe('dark')
  })
  it('keeps a valid saved choice', () => {
    expect(parseChoice('light')).toBe('light')
    expect(parseChoice('system')).toBe('system')
  })
  it('follows the computer only for "system"', () => {
    expect(resolveTheme('system', false)).toBe('light')
    expect(resolveTheme('system', true)).toBe('dark')
    expect(resolveTheme('dark', false)).toBe('dark')
    expect(resolveTheme('light', true)).toBe('light')
  })
})
