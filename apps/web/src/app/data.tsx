import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import {
  coreApi,
  liveUrl,
  workApi,
  type CoreProject,
  type CoreTeam,
  type InboxEntry,
  type Person,
} from './core-api'

interface AppData {
  me: (Person & { teams: Record<string, string>; orgRole: string }) | null
  people: Person[]
  teams: CoreTeam[]
  projects: CoreProject[]
  error: string | null
  loading: boolean
  /** Goes up whenever someone changes something; pages reload when it does. */
  liveTick: number
  live: boolean
  unread: number
  popups: InboxEntry[]
  dismissPopup: (id: string) => void
  refresh: () => void
}

const Ctx = createContext<AppData>({
  me: null,
  people: [],
  teams: [],
  projects: [],
  error: null,
  loading: true,
  liveTick: 0,
  live: false,
  unread: 0,
  popups: [],
  dismissPopup: () => {},
  refresh: () => {},
})

/** Teams, projects and people, loaded once, kept fresh by the live channel, and shared. */
export function DataProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<
    Pick<AppData, 'me' | 'people' | 'teams' | 'projects' | 'error' | 'loading'>
  >({
    me: null,
    people: [],
    teams: [],
    projects: [],
    error: null,
    loading: true,
  })
  const [liveTick, setLiveTick] = useState(0)
  const [live, setLive] = useState(false)
  const [unread, setUnread] = useState(0)
  const [popups, setPopups] = useState<InboxEntry[]>([])
  const seen = useRef<Set<string> | null>(null)

  const refresh = useCallback(() => {
    void Promise.all([
      coreApi.me() as Promise<{
        id: string
        name: string
        teams: Record<string, string>
        orgRole: string
      }>,
      coreApi.people(),
      coreApi.teams(),
      coreApi.projects(),
    ])
      .then(([me, people, teams, projects]) =>
        setState({ me, people, teams, projects, error: null, loading: false }),
      )
      .catch((e: unknown) =>
        setState((s) => ({
          ...s,
          error: e instanceof Error ? e.message : String(e),
          loading: false,
        })),
      )
  }, [])

  // New inbox entries become pop-ups: in the app always, on the desktop when allowed and away.
  const checkInbox = useCallback(() => {
    workApi.inbox().then(
      ({ unread: count, entries }) => {
        setUnread(count)
        const fresh = entries.filter((e) => !e.read)
        if (seen.current === null) {
          seen.current = new Set(fresh.map((e) => e.id))
          return
        }
        const added = fresh.filter((e) => !seen.current?.has(e.id))
        for (const e of added) seen.current.add(e.id)
        if (added.length === 0) return
        setPopups((p) => [...added.slice(0, 3), ...p].slice(0, 4))
        if (
          typeof Notification !== 'undefined' &&
          Notification.permission === 'granted' &&
          document.hidden
        ) {
          for (const e of added.slice(0, 3))
            new Notification('Work Platform', { body: `${e.itemKey} ${e.itemTitle}`, tag: e.id })
        }
      },
      () => undefined,
    )
  }, [])

  useEffect(() => {
    refresh()
    checkInbox()
  }, [refresh, checkInbox])

  useEffect(() => {
    let socket: WebSocket | null = null
    let stopped = false
    let delay = 1000
    let timer: ReturnType<typeof setTimeout> | undefined
    const connect = async () => {
      if (stopped || typeof WebSocket === 'undefined') return
      try {
        socket = new WebSocket(await liveUrl())
      } catch {
        return
      }
      socket.onopen = () => {
        setLive(true)
        delay = 1000
      }
      socket.onmessage = (event) => {
        try {
          const message = JSON.parse(String(event.data)) as { type?: string }
          if (message.type !== 'changed') return
        } catch {
          return
        }
        setLiveTick((t) => t + 1)
        refresh()
        checkInbox()
      }
      socket.onclose = () => {
        setLive(false)
        // The page keeps working without the live link; reconnect with growing gaps (risk table).
        if (!stopped) timer = setTimeout(() => void connect(), (delay = Math.min(delay * 2, 30000)))
      }
    }
    void connect()
    return () => {
      stopped = true
      if (timer) clearTimeout(timer)
      socket?.close()
    }
  }, [refresh, checkInbox])

  const dismissPopup = useCallback(
    (id: string) => setPopups((p) => p.filter((x) => x.id !== id)),
    [],
  )
  return (
    <Ctx.Provider value={{ ...state, liveTick, live, unread, popups, dismissPopup, refresh }}>
      {children}
    </Ctx.Provider>
  )
}

export function useAppData(): AppData {
  return useContext(Ctx)
}

/** Loads something for a page; reloads when `key` changes and when anyone changes anything. */
export function useLoad<T>(
  load: () => Promise<T>,
  key: string,
): { data: T | null; error: string | null; reload: () => void } {
  const { liveTick } = useContext(Ctx)
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  const lastKey = useRef(key)
  useEffect(() => {
    let live = true
    setError(null)
    // A new page starts empty; a live refresh keeps showing the old data until the new arrives.
    if (lastKey.current !== key) setData(null)
    lastKey.current = key
    load()
      .then((d) => live && setData(d))
      .catch((e: unknown) => live && setError(e instanceof Error ? e.message : String(e)))
    return () => {
      live = false
    }
  }, [key, tick, liveTick])
  return { data, error, reload: () => setTick((t) => t + 1) }
}

export function nameOf(people: Person[], id: string | null): string | null {
  if (!id) return null
  return people.find((p) => p.id === id)?.name ?? id
}

/** Comment text for one-line previews: mentions shown as @Name. */
export function plainText(body: string): string {
  return body.replace(/@\[([^\]\n]{1,80})\]\([A-Za-z0-9_-]{1,64}\)/g, '@$1')
}
