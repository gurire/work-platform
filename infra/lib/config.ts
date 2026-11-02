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
}

export const ENVIRONMENTS: Record<EnvName, EnvConfig> = {
  dev: { name: 'dev', prefix: 'wm-dev', retainData: false },
  prod: { name: 'prod', prefix: 'wm-prod', retainData: true },
}

/** GitHub repository allowed to deploy through OIDC. */
export const GITHUB_REPO = 'gurire/work-platform'
