/** Shown when Cognito is set up and nobody is signed in (specs/sign-in.md). */
import { LogIn } from 'lucide-react'

export function SignIn({ message, onSignIn }: { message: string | null; onSignIn: () => void }) {
  return (
    <main className="signin" aria-labelledby="signin-title">
      <div className="signin-card card">
        <span className="brand-mark signin-mark" aria-hidden="true">
          W
        </span>
        <h1 id="signin-title">Work Platform</h1>
        <p className="muted">Sign in with your work email. You will need your authenticator app.</p>
        {message && (
          <p className="signin-error" role="alert">
            {message}
          </p>
        )}
        <button
          type="button"
          className="button button-primary signin-button"
          onClick={onSignIn}
          autoFocus
        >
          <LogIn size={16} aria-hidden="true" /> Sign in
        </button>
        <p className="muted signin-note">
          Accounts are by invitation. Ask an org admin if you need one.
        </p>
      </div>
    </main>
  )
}
