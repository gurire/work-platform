import { useEffect, useMemo, useRef, useState } from 'react'

export interface Command {
  readonly id: string
  readonly label: string
  readonly group: string
  readonly shortcut?: string
  readonly run: () => void
}

interface Props {
  title: string
  commands: readonly Command[]
  /** Builds extra commands from what the user typed, e.g. "Go to ENG-42". */
  dynamic?: (query: string) => readonly Command[]
  onClose: () => void
}

export function CommandPalette({ title, commands, dynamic, onClose }: Props) {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)

  const results = useMemo(() => {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
    const matches = commands.filter((command) => {
      const text = `${command.group} ${command.label}`.toLowerCase()
      return terms.every((term) => text.includes(term))
    })
    return [...(dynamic?.(query.trim()) ?? []), ...matches].slice(0, 50)
  }, [commands, dynamic, query])

  useEffect(() => inputRef.current?.focus(), [])
  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const index = Math.min(active, Math.max(results.length - 1, 0))

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActive((index + 1) % Math.max(results.length, 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActive((index - 1 + results.length) % Math.max(results.length, 1))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      const command = results[index]
      if (command) {
        onClose()
        command.run()
      }
    } else if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
    }
    event.stopPropagation()
  }

  return (
    <div className="palette-backdrop" onMouseDown={onClose}>
      <div
        className="palette"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <input
          ref={inputRef}
          className="palette-input"
          role="combobox"
          aria-expanded="true"
          aria-controls="palette-list"
          aria-activedescendant={results[index] ? `cmd-${results[index].id}` : undefined}
          placeholder={title}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
            setActive(0)
          }}
        />
        <ul id="palette-list" ref={listRef} className="palette-list" role="listbox">
          {results.length === 0 && <li className="palette-empty">No matching commands</li>}
          {results.map((command, i) => (
            <li
              key={command.id}
              id={`cmd-${command.id}`}
              role="option"
              aria-selected={i === index}
              className={i === index ? 'palette-item palette-item-active' : 'palette-item'}
              onMouseMove={() => setActive(i)}
              onClick={() => {
                onClose()
                command.run()
              }}
            >
              <span className="palette-group">{command.group}</span>
              <span className="palette-label">{command.label}</span>
              {command.shortcut && <kbd>{command.shortcut}</kbd>}
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
