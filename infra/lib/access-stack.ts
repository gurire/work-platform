import { Stack, Tags, type StackProps } from 'aws-cdk-lib'
import * as iam from 'aws-cdk-lib/aws-iam'
import type { Construct } from 'constructs'
import { GITHUB_REPO } from './config.js'

/**
 * Account-wide access, deployed once (not per environment):
 *
 * - GitHub Actions deploy role, assumable only by this repo's workflows running in the
 *   "development" or "production" GitHub environment. It can only assume the CDK
 *   bootstrap roles, so all changes go through CloudFormation.
 * - A view-only role for Claude Code and the AWS MCP on your PC. It can see resource
 *   configuration and read dev logs, but cannot read data or change anything.
 */
export class AccessStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props)

    const provider = new iam.OpenIdConnectProvider(this, 'GitHubOidc', {
      url: 'https://token.actions.githubusercontent.com',
      clientIds: ['sts.amazonaws.com'],
    })

    const deployRole = new iam.Role(this, 'GitHubDeployRole', {
      roleName: 'wm-github-deploy',
      description: `Assumed by GitHub Actions in ${GITHUB_REPO} to run cdk deploy`,
      assumedBy: new iam.WebIdentityPrincipal(provider.openIdConnectProviderArn, {
        StringEquals: { 'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com' },
        StringLike: {
          'token.actions.githubusercontent.com:sub': [
            `repo:${GITHUB_REPO}:environment:development`,
            `repo:${GITHUB_REPO}:environment:production`,
          ],
        },
      }),
    })
    deployRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['sts:AssumeRole'],
        resources: [`arn:aws:iam::${this.account}:role/cdk-*`],
      }),
    )

    const claudeRole = new iam.Role(this, 'ClaudeDevViewRole', {
      roleName: 'wm-claude-dev-view',
      description: 'View-only role for Claude Code and the AWS MCP on the developer PC',
      assumedBy: new iam.AccountPrincipal(this.account),
      managedPolicies: [iam.ManagedPolicy.fromAwsManagedPolicyName('job-function/ViewOnlyAccess')],
    })
    claudeRole.addToPolicy(
      new iam.PolicyStatement({
        actions: [
          'logs:GetLogEvents',
          'logs:FilterLogEvents',
          'logs:StartQuery',
          'logs:GetQueryResults',
        ],
        resources: [
          `arn:aws:logs:${this.region}:${this.account}:log-group:/wm/dev/*`,
          `arn:aws:logs:${this.region}:${this.account}:log-group:/wm/dev/*:*`,
        ],
      }),
    )

    Tags.of(this).add('app', 'work-platform')
    Tags.of(this).add('env', 'shared')
  }
}
