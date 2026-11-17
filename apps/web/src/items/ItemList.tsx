import { memo, useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { SAMPLE_PRIORITIES } from '@wm/shared'
import { ChevronDown, ChevronRight } from 'lucide-react'
import type { ItemStore } from './store'
import { Avatar, KindIcon, PriorityIcon, StageChip, TeamTile, type StageLook } from '../ui/kit'
import { gridTemplate, type ColumnId, type ListRow } from './list-view'
import { shortDate } from './item-model'

export type Density = 'compact' | 'default' | 'comfortable'
export const ROW_HEIGHT: Record<Density, number> = { compact: 30, default: 36, comfortable: 44 }

interface RowProps {
  store: ItemStore
  id: string
  index: number
  active: boolean
  selected: boolean
  top: number
  height: number
  template: string
  columns: readonly ColumnId[]
  userNames: ReadonlyMap<string, string>
  teamNames: ReadonlyMap<string, string>
  stageLooks: ReadonlyMap<string, StageLook>
  onSelect: (index: number) => void
  onToggle: (id: string, index: number, range: boolean) => void
}

/** Each row subscribes to its own item, so an edit re-renders one row, not the list. */
const Row = memo(function Row({
  store,
  id,
  index,
  active,
  selected,
  top,
  height,
  template,
  columns,
  userNames,
  teamNames,
  stageLooks,
  onSelect,
  onToggle,
}: RowProps) {
  const item = useSyncExternalStore(
    (listener) => store.subscribeItem(id, listener),
    () => store.getItem(id),
  )
  if (!item) return null
  const priority = Number(item.fields.priority ?? 0)
  const owner = item.assigneeId ? (userNames.get(item.assigneeId) ?? item.assigneeId) : null
  const cells: Record<ColumnId, React.ReactNode> = {
    stage: (
      <StageChip
        look={
          stageLooks.get(`${item.teamId}:${item.statusId}`) ?? {
            name: item.statusId,
            fraction: 0,
            state: 'open',
          }
        }
      />
    ),
    priority: (
      <>
        <PriorityIcon level={priority} />
        {SAMPLE_PRIORITIES[priority] ?? 'None'}
      </>
    ),
    owner: (
      <span className="person">
        <Avatar name={owner} id={item.assigneeId} />
        <span>{owner ?? 'Unassigned'}</span>
      </span>
    ),
    team: (
      <span className="person">
        <TeamTile id={item.teamId} name={teamNames.get(item.teamId) ?? item.teamId} size={16} />
        <span>{teamNames.get(item.teamId) ?? item.teamId}</span>
      </span>
    ),
    created: shortDate(item.createdAt),
    updated: shortDate(item.updatedAt),
  }
  return (
    <div
      id={`row-${id}`}
      role="row"
      aria-selected={active}
      className={`row${active ? ' row-active' : ''}${selected ? ' row-selected' : ''}`}
      style={{ transform: `translateY(${top}px)`, height, gridTemplateColumns: template }}
      onClick={() => onSelect(index)}
    >
      <span role="gridcell" className="cell cell-check">
        <input
          type="checkbox"
          checked={selected}
          aria-label={`Select ${item.key}`}
          onClick={(event) => {
            event.stopPropagation()
            onToggle(id, index, event.shiftKey)
          }}
          onChange={() => {}}
        />
      </span>
      <span role="gridcell" className="cell cell-key">
        <KindIcon kind={item.kind} />
        {item.key}
      </span>
      <span role="gridcell" className="cell cell-title">
        {item.title}
      </span>
      {columns.map((column) => (
        <span key={column} role="gridcell" className={`cell cell-${column}`}>
          {cells[column]}
        </span>
      ))}
    </div>
  )
})

interface ItemListProps {
  store: ItemStore
  rows: readonly ListRow[]
  /** The cursor's place in the item order (not counting group headings). */
  cursor: number
  activeId: string | undefined
  itemCount: number
  density: Density
  columns: readonly ColumnId[]
  selected: ReadonlySet<string>
  userNames: ReadonlyMap<string, string>
  teamNames: ReadonlyMap<string, string>
  stageLooks: ReadonlyMap<string, StageLook>
  onSelect: (index: number) => void
  onToggle: (id: string, index: number, range: boolean) => void
  onToggleGroup: (key: string) => void
  onRenderedRows: (count: number) => void
}

export function ItemList({
  store,
  rows,
  cursor,
  activeId,
  itemCount,
  density,
  columns,
  selected,
  userNames,
  teamNames,
  stageLooks,
  onSelect,
  onToggle,
  onToggleGroup,
  onRenderedRows,
}: ItemListProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const height = ROW_HEIGHT[density]
  const template = gridTemplate(columns)
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => height,
    overscan: 8,
  })
  // Where each item sits among the drawn lines, so the cursor can be scrolled into view.
  const lineOf = useMemo(() => {
    const map: number[] = []
    rows.forEach((row, line) => {
      if (row.type === 'item') map[row.index] = line
    })
    return map
  }, [rows])

  useEffect(() => {
    virtualizer.measure()
  }, [height, virtualizer])

  useEffect(() => {
    const line = lineOf[cursor]
    if (line !== undefined) virtualizer.scrollToIndex(line, { align: 'auto' })
  }, [cursor, lineOf, virtualizer])

  const virtualRows = virtualizer.getVirtualItems()
  useEffect(() => onRenderedRows(virtualRows.length), [virtualRows.length, onRenderedRows])

  return (
    <div
      ref={scrollRef}
      className="list-scroll"
      role="grid"
      tabIndex={0}
      aria-label="Work items"
      aria-rowcount={itemCount}
      aria-multiselectable="true"
      aria-activedescendant={activeId ? `row-${activeId}` : undefined}
    >
      <div className="list-inner" role="rowgroup" style={{ height: virtualizer.getTotalSize() }}>
        {virtualRows.map((virtual) => {
          const row = rows[virtual.index]
          if (!row) return null
          if (row.type === 'group') {
            return (
              <div
                key={`g-${row.key}`}
                role="row"
                className="row row-group"
                style={{ transform: `translateY(${virtual.start}px)`, height }}
              >
                <span role="gridcell" className="group-cell">
                  <button
                    type="button"
                    className="group-toggle"
                    aria-expanded={!row.collapsed}
                    onClick={() => onToggleGroup(row.key)}
                  >
                    {row.collapsed ? (
                      <ChevronRight size={14} aria-hidden="true" />
                    ) : (
                      <ChevronDown size={14} aria-hidden="true" />
                    )}
                    <span className="group-label">{row.label}</span>
                    <span className="group-count">{row.count}</span>
                  </button>
                </span>
              </div>
            )
          }
          return (
            <Row
              key={row.id}
              store={store}
              id={row.id}
              index={row.index}
              active={row.index === cursor}
              selected={selected.has(row.id)}
              top={virtual.start}
              height={height}
              template={template}
              columns={columns}
              userNames={userNames}
              teamNames={teamNames}
              stageLooks={stageLooks}
              onSelect={onSelect}
              onToggle={onToggle}
            />
          )
        })}
      </div>
    </div>
  )
}
