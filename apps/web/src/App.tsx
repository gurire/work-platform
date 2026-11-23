import { useEffect, useState } from 'react'
import { ItemsScreen } from './items/ItemsScreen'
import { authConfig, finishSignIn, isSignedIn, startSignIn } from './auth/auth'
import { SignIn } from './auth/SignIn'
import { AppShell } from './app/AppShell'
import { isMidnightHash } from './app/routes'
import './items/items.css'
import './shell/shell.css'

const auth = authConfig()

/** Without Cognito settings the app opens straight away with development sign-in. */
export function App() {
  const [state, setState] = useState<'checking' | 'signed-out' | 'signed-in'>(
    auth ? 'checking' : 'signed-in',
  )
  const [message, setMessage] = useState<string | null>(null)
  // The new Midnight app answers #/m/… addresses while the old screens are replaced.
  const [midnight, setMidnight] = useState(() => isMidnightHash(window.location.hash))

  useEffect(() => {
    const onHash = () => setMidnight(isMidnightHash(window.location.hash))
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  useEffect(() => {
    if (!auth) return
    void finishSignIn(auth).then((error) => {
      setMessage(error)
      setState(isSignedIn() ? 'signed-in' : 'signed-out')
    })
  }, [])

  if (state === 'checking') return null
  if (state === 'signed-out' && auth) {
    // The main screen sets the theme; before it opens, follow the saved choice or the computer.
    const saved = (() => {
      try {
        return localStorage.getItem('wm.theme')
      } catch {
        return null
      }
    })()
    document.documentElement.dataset.theme =
      saved === 'light' || saved === 'dark'
        ? saved
        : window.matchMedia('(prefers-color-scheme: dark)').matches
          ? 'dark'
          : 'light'
    return <SignIn message={message} onSignIn={() => void startSignIn(auth)} />
  }
  return midnight ? <AppShell /> : <ItemsScreen />
}
