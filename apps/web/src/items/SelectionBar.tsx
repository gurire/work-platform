/**
 * Actions on several selected items at once (redesign step 3). Every change still goes through
 * the server's permission check; refusals are reverted and reported in one message.
 */
import { SAMPLE_PRIORITIES, type Stage } from '@wm/shared'
import { X } from 'lucide-react'
import type { ApiUser } from './api'

interface Props {
  count: number
  /** The stages of the selected items' team, or null when they come from several teams. */
  stages: readonly Stage[] | null
  users: readonly ApiUser[]
  onMove: (stageKey: string) => void
  onAssign: (userId: string | null) => void
  onPriority: (level: number) => void
  onClear: () => void
}

export function SelectionBar({
  count,
  stages,
  users,
  onMove,
  onAssign,
  onPriority,
  onClear,
}: Props) {
  return (
    <div className="selection-bar" role="region" aria-label="Selected items">
      <b>{count} selected</b>
      <select
        aria-label="Move selected items to a stage"
        value=""
        disabled={!stages}
        title={stages ? undefined : 'Pick items from one team to move them together'}
        onChange={(e) => e.target.value && onMove(e.target.value)}
      >
        <option value="">Move to…</option>
        {stages &&
          [...stages]
            .sort((a, b) => a.position - b.position)
            .map((s) => (
              <option key={s.key} value={s.key}>
                {s.name}
              </option>
            ))}
      </select>
      <select
        aria-label="Set the owner of selected items"
        value=""
        onChange={(e) =>
          e.target.value && onAssign(e.target.value === '~none' ? null : e.target.value)
        }
      >
        <option value="">Owner…</option>
        <option value="~none">Unassigned</option>
        {users.map((u) => (
          <option key={u.id} value={u.id}>
            {u.name}
          </option>
        ))}
      </select>
      <select
        aria-label="Set the priority of selected items"
        value=""
        onChange={(e) => e.target.value !== '' && onPriority(Number(e.target.value))}
      >
        <option value="">Priority…</option>
        {[4, 3, 2, 1, 0].map((level) => (
          <option key={level} value={level}>
            {SAMPLE_PRIORITIES[level] ?? 'None'}
          </option>
        ))}
      </select>
      <button type="button" className="button" onClick={onClear}>
        <X size={14} aria-hidden="true" /> Clear <kbd>Esc</kbd>
      </button>
    </div>
  )
}
