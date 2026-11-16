/** Measures the time from an input event to (approximately) the next paint. */
type Listener = () => void

export interface PerfStats {
  readonly label: string
  readonly last: number
  readonly p50: number
  readonly p95: number
  readonly count: number
}

const samples = new Map<string, number[]>()
const listeners = new Set<Listener>()
let snapshot: readonly PerfStats[] = []

function percentile(sorted: readonly number[], p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0
}

function record(label: string, ms: number): void {
  const list = samples.get(label) ?? []
  list.push(ms)
  if (list.length > 200) list.shift()
  samples.set(label, list)
  snapshot = [...samples.entries()].map(([name, values]) => {
    const sorted = [...values].sort((a, b) => a - b)
    return {
      label: name,
      last: values[values.length - 1] ?? 0,
      p50: percentile(sorted, 0.5),
      p95: percentile(sorted, 0.95),
      count: values.length,
    }
  })
  listeners.forEach((listener) => listener())
}

/** Call inside an event handler, after the state change. `start` is event.timeStamp. */
export function measureInteraction(label: string, start: number): void {
  requestAnimationFrame(() => {
    const channel = new MessageChannel()
    channel.port1.onmessage = () => record(label, performance.now() - start)
    channel.port2.postMessage(null)
  })
}

export const perfStore = {
  subscribe(listener: Listener): () => void {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
  get: (): readonly PerfStats[] => snapshot,
}
