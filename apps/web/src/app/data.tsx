import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { coreApi, type CoreProject, type CoreTeam, type Person } from './core-api'

interface AppData {
  me: Person | null
  people: Person[]
  teams: CoreTeam[]
  projects: CoreProject[]
  error: string | null
  loading: boolean
  refresh: () => void
}

const Ctx = createContext<AppData>({
  me: null,
  people: [],
  teams: [],
  projects: [],
  error: null,
  loading: true,
  refresh: () => {},
})

/** Teams, projects and people, loaded once and shared by every page. */
export function DataProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<Omit<AppData, 'refresh'>>({
    me: null,
    people: [],
    teams: [],
    projects: [],
    error: null,
    loading: true,
  })
  const refresh = useCallback(() => {
    void Promise.all([coreApi.me(), coreApi.people(), coreApi.teams(), coreApi.projects()])
      .then(([me, people, teams, projects]) =>
        setState({
          me: { id: me.id, name: me.name },
          people,
          teams,
          projects,
          error: null,
          loading: false,
        }),
      )
      .catch((e: unknown) =>
        setState((s) => ({
          ...s,
          error: e instanceof Error ? e.message : String(e),
          loading: false,
        })),
      )
  }, [])
  useEffect(refresh, [refresh])
  return <Ctx.Provider value={{ ...state, refresh }}>{children}</Ctx.Provider>
}

export function useAppData(): AppData {
  return useContext(Ctx)
}

/** Loads something for a page and reloads when `key` changes. */
export function useLoad<T>(
  load: () => Promise<T>,
  key: string,
): { data: T | null; error: string | null; reload: () => void } {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    let live = true
    setError(null)
    load()
      .then((d) => live && setData(d))
      .catch((e: unknown) => live && setError(e instanceof Error ? e.message : String(e)))
    return () => {
      live = false
    }
  }, [key, tick])
  return { data, error, reload: () => setTick((t) => t + 1) }
}

export function nameOf(people: Person[], id: string | null): string | null {
  if (!id) return null
  return people.find((p) => p.id === id)?.name ?? id
}
