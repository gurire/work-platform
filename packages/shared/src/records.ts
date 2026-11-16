/**
 * Record field rules. Implements specs/records.md, rule 2. Pure functions shared by the API and
 * the web app, so a value the screen accepts is a value the server accepts.
 *
 * Do not change behaviour here without a change to the spec, approved by the owner.
 */

export const RECORD_FIELD_KINDS = ['text', 'number', 'date', 'link', 'choice'] as const
export type RecordFieldKind = (typeof RECORD_FIELD_KINDS)[number]

export interface RecordField {
  readonly key: string
  readonly label: string
  readonly kind: RecordFieldKind
  readonly required: boolean
  /** Only for `choice`. */
  readonly options?: readonly string[]
}

export interface RecordType {
  readonly key: string
  readonly name: string
  readonly fields: readonly RecordField[]
}

export type RecordValue = string | number | null
export type RecordValues = Readonly<Record<string, RecordValue>>

export type RecordValueError = 'unknown_field' | 'invalid_value' | 'required_missing'

export type RecordValuesCheck =
  | { readonly ok: true; readonly values: Record<string, RecordValue> }
  | { readonly ok: false; readonly error: RecordValueError; readonly field: string }

const MAX_TEXT = 2000

function isEmpty(value: RecordValue | undefined): boolean {
  return value === undefined || value === null || (typeof value === 'string' && value.trim() === '')
}

/** Is `value` (already known not to be empty) right for this field? */
export function fitsField(field: RecordField, value: RecordValue): boolean {
  switch (field.kind) {
    case 'text':
      return typeof value === 'string' && value.length <= MAX_TEXT
    case 'number':
      return typeof value === 'number' && Number.isFinite(value)
    case 'date': {
      if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
      const date = new Date(`${value}T00:00:00Z`)
      return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value)
    }
    case 'link':
      return typeof value === 'string' && /^https?:\/\/\S+$/.test(value) && value.length <= MAX_TEXT
    case 'choice':
      return typeof value === 'string' && (field.options ?? []).includes(value)
    default:
      return false
  }
}

/**
 * Checks values for a record (rule 2). `current` holds the record's values before this change;
 * leave it empty when creating. Empty values are stored as null. The result is the full set of
 * values after the change.
 */
export function checkRecordValues(
  type: RecordType,
  changes: RecordValues,
  current: RecordValues = {},
): RecordValuesCheck {
  const byKey = new Map(type.fields.map((field) => [field.key, field]))
  const next: Record<string, RecordValue> = { ...current }
  for (const [key, raw] of Object.entries(changes)) {
    const field = byKey.get(key)
    if (!field) return { ok: false, error: 'unknown_field', field: key }
    const value = typeof raw === 'string' ? raw.trim() : raw
    if (isEmpty(value)) {
      next[key] = null
      continue
    }
    if (!fitsField(field, value as RecordValue))
      return { ok: false, error: 'invalid_value', field: key }
    next[key] = value as RecordValue
  }
  for (const field of type.fields) {
    if (field.required && isEmpty(next[field.key])) {
      return { ok: false, error: 'required_missing', field: field.key }
    }
  }
  return { ok: true, values: next }
}

/** Which fields changed, with old and new values, for the record's history (rule 3). */
export function recordChanges(
  before: RecordValues,
  after: RecordValues,
): { field: string; from: RecordValue; to: RecordValue }[] {
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()
  return keys
    .filter((key) => (before[key] ?? null) !== (after[key] ?? null))
    .map((key) => ({ field: key, from: before[key] ?? null, to: after[key] ?? null }))
}
