/**
 * Small SVG charts for the dashboards, drawn by hand so they share the app's tokens, work in
 * both themes and stay light. Every chart has a label for screen readers, a hover tooltip and
 * a "Show as table" view (specs/dashboards.md; WCAG 1.1.1, 1.4.1).
 */
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'

/** The width of an element, kept up to date as it resizes. */
function useWidth(): [React.RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(480)
  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    setWidth(element.clientWidth)
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.round(entry.contentRect.width))
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  return [ref, width]
}

/** Round numbers for an axis: about four steps from zero to at least `max`. */
export function ticks(max: number, count = 4): number[] {
  if (max <= 0) return [0, 1]
  const raw = max / count
  const power = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * power).find((s) => s >= raw) ?? raw
  const top = Math.ceil(max / step) * step
  return Array.from(
    { length: Math.round(top / step) + 1 },
    (_, i) => Math.round(i * step * 100) / 100,
  )
}

/** The same small sideways shift for the same key, so dots don't jump between visits. */
function jitter(key: string): number {
  let h = 0
  for (const char of key) h = (h * 31 + char.charCodeAt(0)) >>> 0
  return ((h % 1000) / 1000 - 0.5) * 0.6
}

const PAD = { top: 10, right: 12, bottom: 24, left: 34 }

interface Tip {
  readonly x: number
  readonly y: number
  readonly content: ReactNode
}

function Tooltip({ tip, width }: { tip: Tip | null; width: number }) {
  if (!tip) return null
  const left = Math.min(Math.max(tip.x + 12, 4), width - 190)
  return (
    <div className="chart-tip" style={{ left, top: Math.max(tip.y - 12, 0) }} role="presentation">
      {tip.content}
    </div>
  )
}

function YAxis({
  values,
  scale,
  width,
  unit,
}: {
  values: number[]
  scale: (v: number) => number
  width: number
  unit?: string
}) {
  return (
    <g className="chart-axis">
      {values.map((v) => (
        <g key={v}>
          <line
            x1={PAD.left}
            x2={width - PAD.right}
            y1={scale(v)}
            y2={scale(v)}
            className="chart-grid"
          />
          <text x={PAD.left - 6} y={scale(v)} dy="0.32em" textAnchor="end">
            {v}
            {unit && v === values.at(-1) ? ` ${unit}` : ''}
          </text>
        </g>
      ))}
    </g>
  )
}

export function DataTable({
  headers,
  rows,
}: {
  headers: readonly string[]
  rows: ReadonlyArray<ReadonlyArray<string | number>>
}) {
  return (
    <details className="chart-table">
      <summary>Show as table</summary>
      <div className="chart-table-scroll">
        <table>
          <thead>
            <tr>
              {headers.map((h) => (
                <th key={h} scope="col">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i}>
                {row.map((cell, j) => (
                  <td key={j} className={typeof cell === 'number' ? 'num' : undefined}>
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  )
}

export interface Band {
  readonly key: string
  readonly name: string
  readonly color: string
  readonly counts: readonly number[]
}

/** Cumulative flow: bands stacked with the last stage at the bottom. */
export function FlowChart({
  days,
  bands,
  label,
  height = 220,
}: {
  days: readonly string[]
  bands: readonly Band[]
  label: string
  height?: number
}) {
  const [ref, width] = useWidth()
  const [tip, setTip] = useState<Tip | null>(null)
  const [hover, setHover] = useState<number | null>(null)
  const n = days.length
  // Bottom of the stack is the last stage (done), so the bands read "in or past".
  const stack = [...bands].reverse()
  const totals = days.map((_, d) => stack.reduce((sum, band) => sum + (band.counts[d] ?? 0), 0))
  const yTicks = ticks(Math.max(1, ...totals))
  const top = yTicks.at(-1) ?? 1
  const x = (d: number) => PAD.left + (n <= 1 ? 0 : (d / (n - 1)) * (width - PAD.left - PAD.right))
  const y = (v: number) => height - PAD.bottom - (v / top) * (height - PAD.top - PAD.bottom)
  const lower = days.map(() => 0)
  const paths = stack.map((band) => {
    const base = [...lower]
    const upper = days.map((_, d) => (lower[d] = (lower[d] ?? 0) + (band.counts[d] ?? 0)))
    const topLine = upper.map((v, d) => `${x(d)},${y(v)}`).join(' L')
    const bottomLine = base
      .map((v, d) => `${x(d)},${y(v)}`)
      .reverse()
      .join(' L')
    return { band, d: `M${topLine} L${bottomLine} Z` }
  })
  const monthTicks = days.flatMap((day, d) => (d % 7 === 0 ? [{ d, label: shortDate(day) }] : []))
  return (
    <div className="chart" ref={ref}>
      <svg
        width={width}
        height={height}
        role="img"
        aria-label={label}
        onMouseMove={(event) => {
          const box = event.currentTarget.getBoundingClientRect()
          const px = event.clientX - box.left
          const d = Math.round(((px - PAD.left) / (width - PAD.left - PAD.right)) * (n - 1))
          if (d < 0 || d >= n) return setTip(null)
          setHover(d)
          setTip({
            x: px,
            y: event.clientY - box.top,
            content: (
              <>
                <strong>{shortDate(days[d] ?? '')}</strong>
                {bands.map((band) => (
                  <span key={band.key} className="tip-row">
                    <i style={{ background: band.color }} />
                    {band.name}
                    <b>{band.counts[d] ?? 0}</b>
                  </span>
                ))}
              </>
            ),
          })
        }}
        onMouseLeave={() => {
          setTip(null)
          setHover(null)
        }}
      >
        <YAxis values={yTicks} scale={y} width={width} />
        {paths.map(({ band, d }) => (
          <path
            key={band.key}
            d={d}
            fill={band.color}
            stroke="var(--surface-raised)"
            strokeWidth={1}
          />
        ))}
        {hover !== null && (
          <line
            className="chart-cross"
            x1={x(hover)}
            x2={x(hover)}
            y1={PAD.top}
            y2={height - PAD.bottom}
          />
        )}
        <g className="chart-axis">
          {monthTicks.map((t) => (
            <text key={t.d} x={x(t.d)} y={height - 6} textAnchor="middle">
              {t.label}
            </text>
          ))}
        </g>
      </svg>
      <Tooltip tip={tip} width={width} />
    </div>
  )
}

export interface Dot {
  readonly key: string
  readonly column: number
  readonly value: number
  readonly bad: boolean
  readonly tip: ReactNode
}

/** Dots in columns (one per stage), with a dashed target line per column. */
export function DotColumns({
  columns,
  targets,
  dots,
  label,
  unit,
  height = 220,
}: {
  columns: readonly string[]
  targets: readonly (number | null)[]
  dots: readonly Dot[]
  label: string
  unit: string
  height?: number
}) {
  const [ref, width] = useWidth()
  const [tip, setTip] = useState<Tip | null>(null)
  const max = Math.max(1, ...dots.map((dot) => dot.value), ...targets.map((t) => t ?? 0))
  const yTicks = ticks(max)
  const top = yTicks.at(-1) ?? 1
  const colW = (width - PAD.left - PAD.right) / Math.max(1, columns.length)
  const cx = (c: number) => PAD.left + colW * (c + 0.5)
  const y = (v: number) => height - PAD.bottom - (v / top) * (height - PAD.top - PAD.bottom)
  return (
    <div className="chart" ref={ref}>
      <svg
        width={width}
        height={height}
        role="img"
        aria-label={label}
        onMouseLeave={() => setTip(null)}
      >
        <YAxis values={yTicks} scale={y} width={width} unit={unit} />
        {targets.map((target, c) =>
          target === null ? null : (
            <line
              key={c}
              className="chart-target"
              x1={cx(c) - colW * 0.4}
              x2={cx(c) + colW * 0.4}
              y1={y(target)}
              y2={y(target)}
            />
          ),
        )}
        {dots.map((dot) => (
          <circle
            key={dot.key}
            cx={cx(dot.column) + jitter(dot.key) * colW}
            cy={y(dot.value)}
            r={4.5}
            className={dot.bad ? 'dot dot-bad' : 'dot'}
            onMouseEnter={(event) => {
              const box = (
                event.currentTarget.ownerSVGElement as SVGSVGElement
              ).getBoundingClientRect()
              setTip({ x: event.clientX - box.left, y: event.clientY - box.top, content: dot.tip })
            }}
          />
        ))}
        <g className="chart-axis">
          {columns.map((name, c) => (
            <text key={name} x={cx(c)} y={height - 6} textAnchor="middle">
              {name.length > 14 ? `${name.slice(0, 13)}…` : name}
            </text>
          ))}
        </g>
      </svg>
      <Tooltip tip={tip} width={width} />
    </div>
  )
}

export interface TimeDot {
  readonly key: string
  readonly at: number
  readonly value: number
  readonly tip: ReactNode
}

/** Dots over time with one dashed reference line (the 85th percentile). */
export function TimeScatter({
  from,
  to,
  dots,
  line,
  lineLabel,
  label,
  unit,
  height = 220,
}: {
  from: number
  to: number
  dots: readonly TimeDot[]
  line: number | null
  lineLabel: string
  label: string
  unit: string
  height?: number
}) {
  const [ref, width] = useWidth()
  const [tip, setTip] = useState<Tip | null>(null)
  const yTicks = ticks(Math.max(1, line ?? 0, ...dots.map((d) => d.value)))
  const top = yTicks.at(-1) ?? 1
  const x = (t: number) =>
    PAD.left + ((t - from) / Math.max(1, to - from)) * (width - PAD.left - PAD.right)
  const y = (v: number) => height - PAD.bottom - (v / top) * (height - PAD.top - PAD.bottom)
  const weekTicks: number[] = []
  for (let t = from; t <= to; t += 14 * 86_400_000) weekTicks.push(t)
  return (
    <div className="chart" ref={ref}>
      <svg
        width={width}
        height={height}
        role="img"
        aria-label={label}
        onMouseLeave={() => setTip(null)}
      >
        <YAxis values={yTicks} scale={y} width={width} unit={unit} />
        {line !== null && (
          <g>
            <line
              className="chart-target"
              x1={PAD.left}
              x2={width - PAD.right}
              y1={y(line)}
              y2={y(line)}
            />
            <text
              className="chart-line-label"
              x={width - PAD.right}
              y={y(line) - 5}
              textAnchor="end"
            >
              {lineLabel}
            </text>
          </g>
        )}
        {dots.map((dot) => (
          <circle
            key={dot.key}
            cx={x(dot.at)}
            cy={y(dot.value)}
            r={3.5}
            className="dot"
            onMouseEnter={(event) => {
              const box = (
                event.currentTarget.ownerSVGElement as SVGSVGElement
              ).getBoundingClientRect()
              setTip({ x: event.clientX - box.left, y: event.clientY - box.top, content: dot.tip })
            }}
          />
        ))}
        <g className="chart-axis">
          {weekTicks.map((t) => (
            <text key={t} x={x(t)} y={height - 6} textAnchor="middle">
              {shortDate(new Date(t).toISOString().slice(0, 10))}
            </text>
          ))}
        </g>
      </svg>
      <Tooltip tip={tip} width={width} />
    </div>
  )
}

/** Simple columns. `strong` marks which bars carry the point (the rest are lighter). */
export function Columns({
  labels,
  values,
  strong,
  label,
  format = String,
  height = 180,
}: {
  labels: readonly string[]
  values: readonly number[]
  strong?: (index: number) => boolean
  label: string
  format?: (value: number) => string
  height?: number
}) {
  const [ref, width] = useWidth()
  const [tip, setTip] = useState<Tip | null>(null)
  const yTicks = ticks(Math.max(1, ...values))
  const top = yTicks.at(-1) ?? 1
  const slot = (width - PAD.left - PAD.right) / Math.max(1, values.length)
  const bar = Math.min(24, slot * 0.7)
  const y = (v: number) => height - PAD.bottom - (v / top) * (height - PAD.top - PAD.bottom)
  return (
    <div className="chart" ref={ref}>
      <svg
        width={width}
        height={height}
        role="img"
        aria-label={label}
        onMouseLeave={() => setTip(null)}
      >
        <YAxis values={yTicks} scale={y} width={width} />
        {values.map((value, i) => {
          const cx = PAD.left + slot * (i + 0.5)
          const h = Math.max(0, y(0) - y(value))
          const r = Math.min(4, h / 2, bar / 2)
          const x0 = cx - bar / 2
          const y0 = y(value)
          return (
            <g key={i}>
              <rect
                x={cx - slot / 2}
                y={PAD.top}
                width={slot}
                height={height - PAD.top - PAD.bottom}
                fill="transparent"
                onMouseEnter={(event) => {
                  const box = (
                    event.currentTarget.ownerSVGElement as SVGSVGElement
                  ).getBoundingClientRect()
                  setTip({
                    x: event.clientX - box.left,
                    y: event.clientY - box.top,
                    content: (
                      <>
                        <strong>{labels[i]}</strong>
                        <span>{format(value)}</span>
                      </>
                    ),
                  })
                }}
              />
              {h > 0 && (
                <path
                  className={strong && !strong(i) ? 'bar bar-soft' : 'bar'}
                  d={`M${x0},${y(0)} V${y0 + r} Q${x0},${y0} ${x0 + r},${y0} H${x0 + bar - r} Q${x0 + bar},${y0} ${x0 + bar},${y0 + r} V${y(0)} Z`}
                  pointerEvents="none"
                />
              )}
            </g>
          )
        })}
        <g className="chart-axis">
          {labels.map((text, i) =>
            labels.length > 10 && i % 2 === 1 ? null : (
              <text key={i} x={PAD.left + slot * (i + 0.5)} y={height - 6} textAnchor="middle">
                {text}
              </text>
            ),
          )}
        </g>
      </svg>
      <Tooltip tip={tip} width={width} />
    </div>
  )
}

/** "12 Nov" from YYYY-MM-DD. */
export function shortDate(day: string): string {
  const date = new Date(`${day}T00:00:00Z`)
  return Number.isNaN(date.getTime())
    ? day
    : date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })
}
