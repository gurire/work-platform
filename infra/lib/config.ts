/**
 * Dev and prod are two copies of the same app in ONE AWS account (ADR 0002).
 * Every resource carries an `env` tag and a `wm-<env>-` name prefix so IAM
 * policies, budgets and humans can tell them apart.
 */
export type EnvName = 'dev' | 'prod'

export interface EnvConfig {
  readonly name: EnvName
  /** Prefix for physical resource names, e.g. "wm-dev". */
  readonly prefix: string
  /** Dev data is disposable; prod data is retained when a stack is deleted. */
  readonly retainData: boolean
  /**
   * Addresses of the web app, for sign-in redirects (specs/sign-in.md). Each must end in "/".
   * Prod's real address is set when hosting is built; until then it is a placeholder that
   * cannot receive sign-ins, so prod sign-in cannot be misused.
   */
  readonly appUrls: readonly string[]
  /** Prefix for the Cognito sign-in domain; must be unique in the region. */
  readonly authDomainPrefix: string
  /** Who gets downtime alerts: the owner and a named deputy (WP-BRIEF-002). Set before go-live. */
  readonly alertEmails: readonly string[]
}

export const ENVIRONMENTS: Record<EnvName, EnvConfig> = {
  dev: {
    name: 'dev',
    prefix: 'wm-dev',
    retainData: false,
    appUrls: ['http://localhost:5173/'],
    authDomainPrefix: 'gurire-wm-dev',
    alertEmails: [],
  },
  prod: {
    name: 'prod',
    prefix: 'wm-prod',
    retainData: true,
    appUrls: ['https://work-platform.invalid/'],
    authDomainPrefix: 'gurire-wm-prod',
    // Owner and deputy addresses go here before go-live (open decision in the brief).
    alertEmails: [],
  },
}

/** GitHub repository allowed to deploy through OIDC. */
export const GITHUB_REPO = 'gurire/work-platform'
