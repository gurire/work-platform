/**
 * Light and dark mode for the Midnight UI (specs/design-system.md, rule 2).
 * Dark is the default. "system" follows the computer. The choice is kept in this browser
 * until profiles store it on the server.
 */
import { useEffect, useState } from 'react'

export type ThemeChoice = 'dark' | 'light' | 'system'
export type Theme = 'dark' | 'light'

const KEY = 'wp.theme'

export function parseChoice(value: string | null | undefined): ThemeChoice {
  return value === 'light' || value === 'system' || value === 'dark' ? value : 'dark'
}

export function resolveTheme(choice: ThemeChoice, systemPrefersDark: boolean): Theme {
  if (choice === 'system') return systemPrefersDark ? 'dark' : 'light'
  return choice
}

export function loadChoice(): ThemeChoice {
  try {
    return parseChoice(localStorage.getItem(KEY))
  } catch {
    return 'dark'
  }
}

export function saveChoice(choice: ThemeChoice): void {
  try {
    localStorage.setItem(KEY, choice)
  } catch {
    // Private windows may block storage; the choice then lasts for this visit only.
  }
}

function systemDark(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-color-scheme: dark)').matches
    : true
}

/** The current theme and a setter; follows the computer live when the choice is "system". */
export function useTheme(): {
  choice: ThemeChoice
  theme: Theme
  setChoice: (c: ThemeChoice) => void
} {
  const [choice, setChoiceState] = useState<ThemeChoice>(loadChoice)
  const [prefersDark, setPrefersDark] = useState<boolean>(systemDark)

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const query = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = (e: MediaQueryListEvent) => setPrefersDark(e.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])

  const setChoice = (next: ThemeChoice) => {
    saveChoice(next)
    setChoiceState(next)
  }
  return { choice, theme: resolveTheme(choice, prefersDark), setChoice }
}
