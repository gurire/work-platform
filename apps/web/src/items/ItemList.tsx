import { memo, useEffect, useRef, useSyncExternalStore } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { SAMPLE_PRIORITIES } from '@wm/shared'
import type { ItemStore } from './store'
import { Avatar, KindIcon, PriorityIcon, StageChip, type StageLook } from '../ui/kit'

export type Density = 'compact' | 'default' | 'comfortable'
export const ROW_HEIGHT: Record<Density, number> = { compact: 30, default: 36, comfortable: 44 }

interface RowProps {
  store: ItemStore
  id: string
  index: number
  active: boolean
  top: number
  height: number
  userNames: ReadonlyMap<string, string>
  stageLooks: ReadonlyMap<string, StageLook>
  onSelect: (index: number) => void
}

/** Each row subscribes to its own item, so an edit re-renders one row, not the list. */
const Row = memo(function Row({
  store,
  id,
  index,
  active,
  top,
  height,
  userNames,
  stageLooks,
  onSelect,
}: RowProps) {
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
        <KindIcon kind={item.kind} />
        {item.key}
      </span>
      <span role="gridcell" className="cell cell-title">
        {item.title}
      </span>
      <span role="gridcell" className="cell cell-status">
        <StageChip
          look={
            stageLooks.get(`${item.teamId}:${item.statusId}`) ?? {
              name: item.statusId,
              fraction: 0,
              state: 'open',
            }
          }
        />
      </span>
      <span role="gridcell" className="cell cell-priority">
        <PriorityIcon level={priority} />
        {SAMPLE_PRIORITIES[priority] ?? 'None'}
      </span>
      <span role="gridcell" className="cell cell-assignee">
        <span className="person">
          <Avatar
            name={item.assigneeId ? (userNames.get(item.assigneeId) ?? item.assigneeId) : null}
            id={item.assigneeId}
          />
          <span>
            {item.assigneeId ? (userNames.get(item.assigneeId) ?? item.assigneeId) : 'Unassigned'}
          </span>
        </span>
      </span>
    </div>
  )
})

interface ItemListProps {
  store: ItemStore
  ids: readonly string[]
  cursor: number
  density: Density
  userNames: ReadonlyMap<string, string>
  stageLooks: ReadonlyMap<string, StageLook>
  onSelect: (index: number) => void
  onRenderedRows: (count: number) => void
}

export function ItemList({
  store,
  ids,
  cursor,
  density,
  userNames,
  stageLooks,
  onSelect,
  onRenderedRows,
}: ItemListProps) {
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
              userNames={userNames}
              stageLooks={stageLooks}
              onSelect={onSelect}
            />
          )
        })}
      </div>
    </div>
  )
}
