import { WORK_ITEM_KINDS } from '@wm/shared'

export function App() {
  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: 24 }}>
      <h1>Work Platform</h1>
      <p>Scaffold is running. Work item kinds in the shared model:</p>
      <ul>
        {WORK_ITEM_KINDS.map((kind) => (
          <li key={kind}>{kind}</li>
        ))}
      </ul>
    </main>
  )
}
