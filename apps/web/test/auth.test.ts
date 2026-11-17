import { describe, expect, it } from 'vitest'
import { authorizeUrl, base64Url, logoutUrl, pkceChallenge, tokensFrom } from '../src/auth/auth'

const config = {
  domain: 'https://gurire-wm-dev.auth.ap-south-1.amazoncognito.com',
  clientId: 'client123',
  redirectUri: 'http://localhost:5173/',
}

describe('sign-in helpers (specs/sign-in.md, section 3)', () => {
  it('makes the PKCE challenge from the RFC 7636 example', async () => {
    // Appendix B of RFC 7636.
    expect(await pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    )
    expect(base64Url(new Uint8Array([251, 255]))).toBe('-_8')
  })

  it('asks Cognito for the code flow with S256 and no secret', () => {
    const url = new URL(authorizeUrl(config, 'st', 'ch'))
    expect(url.origin + url.pathname).toBe(`${config.domain}/oauth2/authorize`)
    expect(Object.fromEntries(url.searchParams)).toEqual({
      response_type: 'code',
      client_id: 'client123',
      redirect_uri: 'http://localhost:5173/',
      scope: 'openid email profile',
      state: 'st',
      code_challenge_method: 'S256',
      code_challenge: 'ch',
    })
    expect(logoutUrl(config)).toContain('/logout?client_id=client123&logout_uri=')
  })

  it('keeps the old refresh token when a refresh does not send a new one', () => {
    const t = tokensFrom({ id_token: 'id2', expires_in: 3600 }, 1000, 'refresh1')
    expect(t).toEqual({ idToken: 'id2', refreshToken: 'refresh1', expiresAt: 3_601_000 })
    expect(() => tokensFrom({}, 0)).toThrow()
  })
})
