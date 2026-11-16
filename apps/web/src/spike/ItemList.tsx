import { memo, useEffect, useRef, useSyncExternalStore } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { SAMPLE_PRIORITIES, SAMPLE_STATUSES, SAMPLE_USERS } from '@wm/shared'
import type { ItemStore } from './store'

export type Density = 'compact' | 'default' | 'comfortable'
export const ROW_HEIGHT: Record<Density, number> = { compact: 28, default: 34, comfortable: 42 }

const userName = new Map(SAMPLE_USERS.map((u) => [u.id, u.name]))
const statusName = new Map(SAMPLE_STATUSES.map((s) => [s.id, s.name]))

interface RowProps {
  store: ItemStore
  id: string
  index: number
  active: boolean
  top: number
  height: number
  onSelect: (index: number) => void
}

/** Each row subscribes to its own item, so an edit re-renders one row, not the list. */
const Row = memo(function Row({ store, id, index, active, top, height, onSelect }: RowProps) {
  const item = useSyncExternalStore(
    (listener) => store.subscribeItem(id, listener),
    () => store.getItem(id),
  )
  if (!item) return null
  const priority = Number(item.fields.priority ?? 0)
  return (
    <div
      id={`row-${id}`}
      role="row"
      aria-rowindex={index + 1}
      aria-selected={active}
      className={active ? 'row row-active' : 'row'}
      style={{ transform: `translateY(${top}px)`, height }}
      onClick={() => onSelect(index)}
    >
      <span role="gridcell" className="cell cell-key">
        {item.key}
      </span>
      <span role="gridcell" className="cell cell-title">
        {item.title}
      </span>
      <span role="gridcell" className="cell cell-kind">
        {item.kind}
      </span>
      <span role="gridcell" className={`cell cell-status status-${item.statusCategory}`}>
        <span className="status-dot" aria-hidden="true" />
        {statusName.get(item.statusId) ?? item.statusId}
      </span>
      <span role="gridcell" className="cell cell-priority">
        {SAMPLE_PRIORITIES[priority] ?? 'None'}
      </span>
      <span role="gridcell" className="cell cell-assignee">
        {item.assigneeId ? (userName.get(item.assigneeId) ?? item.assigneeId) : 'Unassigned'}
      </span>
    </div>
  )
})

interface ItemListProps {
  store: ItemStore
  ids: readonly string[]
  cursor: number
  density: Density
  onSelect: (index: number) => void
  onRenderedRows: (count: number) => void
}

export function ItemList({ store, ids, cursor, density, onSelect, onRenderedRows }: ItemListProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const height = ROW_HEIGHT[density]
  const virtualizer = useVirtualizer({
    count: ids.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => height,
    overscan: 8,
  })

  useEffect(() => {
    virtualizer.measure()
  }, [height, virtualizer])

  useEffect(() => {
    if (ids.length > 0) virtualizer.scrollToIndex(cursor, { align: 'auto' })
  }, [cursor, ids, virtualizer])

  const rows = virtualizer.getVirtualItems()
  useEffect(() => onRenderedRows(rows.length), [rows.length, onRenderedRows])
  const activeId = ids[cursor]

  return (
    <div
      ref={scrollRef}
      className="list-scroll"
      role="grid"
      tabIndex={0}
      aria-label="Work items"
      aria-rowcount={ids.length}
      aria-activedescendant={activeId ? `row-${activeId}` : undefined}
    >
      <div className="list-inner" role="rowgroup" style={{ height: virtualizer.getTotalSize() }}>
        {rows.map((row) => {
          const id = ids[row.index]
          if (!id) return null
          return (
            <Row
              key={id}
              store={store}
              id={id}
              index={row.index}
              active={row.index === cursor}
              top={row.start}
              height={height}
              onSelect={onSelect}
            />
          )
        })}
      </div>
    </div>
  )
}
