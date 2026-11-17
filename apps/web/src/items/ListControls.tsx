/**
 * Filter chips, grouping and columns for the list (redesign step 3).
 */
import { useEffect, useRef } from 'react'
import { SAMPLE_PRIORITIES, type Stage } from '@wm/shared'
import { Funnel, Rows3, X } from 'lucide-react'
import type { ApiUser } from './api'
import {
  COLUMNS,
  GROUP_LABELS,
  facetCount,
  toggle,
  type ColumnId,
  type Facets,
  type GroupBy,
} from './list-view'
import { Avatar } from '../ui/kit'

interface Option<T> {
  readonly value: T
  readonly label: string
  readonly icon?: React.ReactNode
}

/** A chip that opens a small checklist. Closes on Escape or a click outside. */
function ChipMenu<T>({
  label,
  options,
  chosen,
  onToggle,
  onClear,
}: {
  label: string
  options: readonly Option<T>[]
  chosen: readonly T[]
  onToggle: (value: T) => void
  onClear: () => void
}) {
  const ref = useRef<HTMLDetailsElement>(null)
  useEffect(() => {
    const close = (event: MouseEvent | KeyboardEvent) => {
      const details = ref.current
      if (!details?.open) return
      if (event instanceof KeyboardEvent) {
        if (event.key !== 'Escape') return
        // Close the menu only; Escape must not also clear the selection.
        event.stopPropagation()
        details.open = false
      } else if (!details.contains(event.target as Node)) details.open = false
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', close)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', close)
    }
  }, [])
  const names = options.filter((o) => chosen.includes(o.value)).map((o) => o.label)
  const active = names.length > 0
  return (
    <details className={active ? 'chip-menu chip-on' : 'chip-menu'} ref={ref}>
      <summary>
        <span>{label}</span>
        {active && (
          <b>
            {names[0]}
            {names.length > 1 ? ` +${names.length - 1}` : ''}
          </b>
        )}
      </summary>
      <div className="menu" role="group" aria-label={label}>
        {options.map((option) => (
          <label key={String(option.value)} className="menu-option">
            <input
              type="checkbox"
              checked={chosen.includes(option.value)}
              onChange={() => onToggle(option.value)}
            />
            {option.icon}
            <span>{option.label}</span>
          </label>
        ))}
        {active && (
          <button type="button" className="menu-clear" onClick={onClear}>
            Clear {label.toLowerCase()}
          </button>
        )}
      </div>
    </details>
  )
}

interface Props {
  facets: Facets
  onFacets: (facets: Facets) => void
  users: readonly ApiUser[]
  meId: string | null
  /** The team's stages when the list shows one team; stages only filter inside a team. */
  stages: readonly Stage[] | null
  kinds: readonly string[]
  groupBy: GroupBy
  onGroupBy: (by: GroupBy) => void
  columns: readonly ColumnId[]
  onColumns: (columns: readonly ColumnId[]) => void
  shown: number
  total: number
}

export function ListControls({
  facets,
  onFacets,
  users,
  meId,
  stages,
  kinds,
  groupBy,
  onGroupBy,
  columns,
  onColumns,
  shown,
  total,
}: Props) {
  const people: Option<string | null>[] = [
    ...(meId
      ? [
          {
            value: meId,
            label: 'Me',
            icon: (
              <Avatar name={users.find((u) => u.id === meId)?.name ?? 'Me'} id={meId} size={18} />
            ),
          },
        ]
      : []),
    ...users
      .filter((u) => u.id !== meId)
      .map((u) => ({
        value: u.id,
        label: u.name,
        icon: <Avatar name={u.name} id={u.id} size={18} />,
      })),
    { value: null, label: 'Unassigned', icon: <Avatar name={null} size={18} /> },
  ]
  const priorities = [4, 3, 2, 1, 0].map((level) => ({
    value: level,
    label: SAMPLE_PRIORITIES[level] ?? 'None',
  }))
  const any = facetCount(facets) > 0
  return (
    <div className="list-controls" role="toolbar" aria-label="Filters and view">
      <Funnel size={14} aria-hidden="true" className="muted" />
      <ChipMenu
        label="Owner"
        options={people}
        chosen={facets.owners ?? []}
        onToggle={(v) => onFacets({ ...facets, owners: toggle(facets.owners, v) })}
        onClear={() => onFacets({ ...facets, owners: [] })}
      />
      <ChipMenu
        label="Priority"
        options={priorities}
        chosen={facets.priorities ?? []}
        onToggle={(v) => onFacets({ ...facets, priorities: toggle(facets.priorities, v) })}
        onClear={() => onFacets({ ...facets, priorities: [] })}
      />
      <ChipMenu
        label="Kind"
        options={kinds.map((k) => ({ value: k, label: k[0]?.toUpperCase() + k.slice(1) }))}
        chosen={facets.kinds ?? []}
        onToggle={(v) => onFacets({ ...facets, kinds: toggle(facets.kinds, v) })}
        onClear={() => onFacets({ ...facets, kinds: [] })}
      />
      {stages && (
        <ChipMenu
          label="Stage"
          options={[...stages]
            .sort((a, b) => a.position - b.position)
            .map((s) => ({ value: s.key, label: s.name }))}
          chosen={facets.stages ?? []}
          onToggle={(v) => onFacets({ ...facets, stages: toggle(facets.stages, v) })}
          onClear={() => onFacets({ ...facets, stages: [] })}
        />
      )}
      {any && (
        <button type="button" className="chip-clear" onClick={() => onFacets({})}>
          <X size={13} aria-hidden="true" /> Clear filters
        </button>
      )}
      <span className="list-count muted" aria-live="polite">
        {shown === total
          ? `${total.toLocaleString()} items`
          : `${shown.toLocaleString()} of ${total.toLocaleString()} items`}
      </span>
      <label className="view-select">
        <Rows3 size={14} aria-hidden="true" />
        <span className="sr-only">Group by</span>
        <select
          value={groupBy}
          onChange={(e) => onGroupBy(e.target.value as GroupBy)}
          aria-label="Group by"
        >
          {(Object.keys(GROUP_LABELS) as GroupBy[]).map((by) => (
            <option key={by} value={by}>
              {by === 'none' ? GROUP_LABELS[by] : `Group: ${GROUP_LABELS[by]}`}
            </option>
          ))}
        </select>
      </label>
      <ChipMenu
        label="Columns"
        options={COLUMNS.map((c) => ({ value: c.id, label: c.label }))}
        chosen={columns}
        onToggle={(v) => onColumns(toggle(columns, v))}
        onClear={() => onColumns([])}
      />
    </div>
  )
}
