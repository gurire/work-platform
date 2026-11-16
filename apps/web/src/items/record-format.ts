import type { RecordField, RecordValue } from '@wm/shared'

/** A record value as a person reads it. */
export function formatValue(
  field: RecordField | undefined,
  value: RecordValue | undefined,
): string {
  if (value === null || value === undefined || value === '') return '—'
  if (field?.kind === 'number' && typeof value === 'number') return value.toLocaleString()
  if (field?.kind === 'choice' && typeof value === 'string') {
    return value.charAt(0).toUpperCase() + value.slice(1)
  }
  return String(value)
}

/** Turns what was typed into the value to send: numbers become numbers, blanks become null. */
export function parseInput(field: RecordField, raw: string): RecordValue {
  const text = raw.trim()
  if (text === '') return null
  if (field.kind === 'number') {
    const number = Number(text)
    return Number.isFinite(number) ? number : text
  }
  return text
}
