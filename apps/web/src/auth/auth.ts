/// <reference types="vite/client" />
/**
 * Sign-in with Amazon Cognito managed login (specs/sign-in.md, section 3): the authorisation
 * code flow with PKCE, so the browser holds no client secret. Tokens live in session storage,
 * so closing the tab signs you out. Without Cognito settings the app uses development sign-in.
 */

export interface AuthConfig {
  /** e.g. https://gurire-wm-dev.auth.ap-south-1.amazoncognito.com */
  readonly domain: string
  readonly clientId: string
  /** Where Cognito sends people back; must be one of the client's callback URLs. */
  readonly redirectUri: string
}

interface Tokens {
  readonly idToken: string
  readonly refreshToken: string | null
  /** Milliseconds since 1970. */
  readonly expiresAt: number
}

const TOKENS_KEY = 'wm.auth.tokens'
const PENDING_KEY = 'wm.auth.pending'
/** Refresh a little before the ID token runs out. */
const REFRESH_EARLY_MS = 2 * 60_000

export function authConfig(): AuthConfig | null {
  const domain = import.meta.env['VITE_COGNITO_DOMAIN'] as string | undefined
  const clientId = import.meta.env['VITE_COGNITO_CLIENT_ID'] as string | undefined
  if (!domain || !clientId) return null
  return { domain: domain.replace(/\/$/, ''), clientId, redirectUri: `${window.location.origin}/` }
}

export function base64Url(bytes: Uint8Array): string {
  let text = ''
  for (const byte of bytes) text += String.fromCharCode(byte)
  return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function randomString(byteCount = 32): string {
  return base64Url(crypto.getRandomValues(new Uint8Array(byteCount)))
}

/** The PKCE challenge for a verifier: base64url(SHA-256(verifier)). */
export async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return base64Url(new Uint8Array(digest))
}

export function authorizeUrl(config: AuthConfig, state: string, challenge: string): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    scope: 'openid email profile',
    state,
    code_challenge_method: 'S256',
    code_challenge: challenge,
  })
  return `${config.domain}/oauth2/authorize?${params.toString()}`
}

export function logoutUrl(config: AuthConfig): string {
  const params = new URLSearchParams({ client_id: config.clientId, logout_uri: config.redirectUri })
  return `${config.domain}/logout?${params.toString()}`
}

/** Turn a token endpoint reply into what we keep. */
export function tokensFrom(
  body: { id_token?: string; refresh_token?: string; expires_in?: number },
  now: number,
  previousRefresh: string | null = null,
): Tokens {
  if (!body.id_token) throw new Error('Cognito did not return an ID token')
  return {
    idToken: body.id_token,
    refreshToken: body.refresh_token ?? previousRefresh,
    expiresAt: now + (body.expires_in ?? 3600) * 1000,
  }
}

function readTokens(): Tokens | null {
  try {
    const raw = sessionStorage.getItem(TOKENS_KEY)
    return raw ? (JSON.parse(raw) as Tokens) : null
  } catch {
    return null
  }
}

function writeTokens(tokens: Tokens | null): void {
  try {
    if (tokens) sessionStorage.setItem(TOKENS_KEY, JSON.stringify(tokens))
    else sessionStorage.removeItem(TOKENS_KEY)
  } catch {
    // Storage blocked: the session lasts only while the page is open.
  }
}

/** Go to Cognito's sign-in page, remembering where to come back to. */
export async function startSignIn(config: AuthConfig): Promise<void> {
  const verifier = randomString(48)
  const state = randomString(16)
  sessionStorage.setItem(
    PENDING_KEY,
    JSON.stringify({ verifier, state, hash: window.location.hash }),
  )
  window.location.assign(authorizeUrl(config, state, await pkceChallenge(verifier)))
}

async function tokenRequest(
  config: AuthConfig,
  form: Record<string, string>,
): Promise<Record<string, unknown>> {
  const response = await fetch(`${config.domain}/oauth2/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: config.clientId, ...form }).toString(),
  })
  if (!response.ok) throw new Error(`sign-in failed (${response.status})`)
  return (await response.json()) as Record<string, unknown>
}

/**
 * If Cognito just sent us back with a code, swap it for tokens and tidy the address bar.
 * Returns an error message to show, or null.
 */
export async function finishSignIn(config: AuthConfig): Promise<string | null> {
  const params = new URLSearchParams(window.location.search)
  const code = params.get('code')
  const error = params.get('error_description') ?? params.get('error')
  if (!code && !error) return null
  const pending = (() => {
    try {
      return JSON.parse(sessionStorage.getItem(PENDING_KEY) ?? 'null') as {
        verifier: string
        state: string
        hash: string
      } | null
    } catch {
      return null
    }
  })()
  sessionStorage.removeItem(PENDING_KEY)
  window.history.replaceState(null, '', `/${pending?.hash ?? ''}`)
  if (error) return error
  if (!pending || params.get('state') !== pending.state) {
    return 'The sign-in could not be checked. Please try again.'
  }
  try {
    const body = await tokenRequest(config, {
      grant_type: 'authorization_code',
      code: code ?? '',
      redirect_uri: config.redirectUri,
      code_verifier: pending.verifier,
    })
    writeTokens(tokensFrom(body, Date.now()))
    return null
  } catch (e) {
    return e instanceof Error ? e.message : 'sign-in failed'
  }
}

export function isSignedIn(): boolean {
  return readTokens() !== null
}

let refreshing: Promise<string | null> | null = null

/** A current ID token, refreshed quietly when close to expiry; null when signed out. */
export async function idToken(config: AuthConfig): Promise<string | null> {
  const tokens = readTokens()
  if (!tokens) return null
  if (tokens.expiresAt - Date.now() > REFRESH_EARLY_MS) return tokens.idToken
  if (!tokens.refreshToken) {
    writeTokens(null)
    return null
  }
  refreshing ??= tokenRequest(config, {
    grant_type: 'refresh_token',
    refresh_token: tokens.refreshToken,
  })
    .then((body) => {
      const next = tokensFrom(body, Date.now(), tokens.refreshToken)
      writeTokens(next)
      return next.idToken
    })
    .catch(() => {
      writeTokens(null)
      return null
    })
    .finally(() => {
      refreshing = null
    })
  return refreshing
}

/** End the session here and at Cognito. */
export function signOut(config: AuthConfig): void {
  writeTokens(null)
  window.location.assign(logoutUrl(config))
}

/** The signed-in person's email, from the ID token (display only; the API checks the token). */
export function tokenEmail(): string | null {
  const token = readTokens()?.idToken
  const payload = token?.split('.')[1]
  if (!payload) return null
  try {
    const json = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/'))) as {
      email?: string
    }
    return json.email ?? null
  } catch {
    return null
  }
}
