/**
 * The real token check, using AWS's own verifier (aws-jwt-verify, Apache-2.0). It downloads
 * the pool's public keys once and checks signature, issuer, audience, expiry and token use.
 */
import { CognitoJwtVerifier } from 'aws-jwt-verify'
import type { IdTokenVerifier } from './auth.js'

export function cognitoVerifier(userPoolId: string, clientId: string): IdTokenVerifier {
  const verifier = CognitoJwtVerifier.create({ userPoolId, clientId, tokenUse: 'id' })
  return async (token) => {
    const payload = await verifier.verify(token)
    const email = payload['email']
    const verified = payload['email_verified']
    return {
      sub: payload.sub,
      email: typeof email === 'string' ? email : undefined,
      emailVerified: String(verified) === 'true',
    }
  }
}
