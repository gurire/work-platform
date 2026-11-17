import { App, Stack } from 'aws-cdk-lib'
import { Match, Template } from 'aws-cdk-lib/assertions'
import { describe, expect, it } from 'vitest'
import { AccessStack } from '../lib/access-stack.js'
import { AppStage } from '../lib/app-stage.js'
import { ENVIRONMENTS } from '../lib/config.js'

function foundation(name: 'dev' | 'prod') {
  const app = new App()
  const stage = new AppStage(app, name, { config: ENVIRONMENTS[name] })
  const stack = stage.node.findChild('Foundation') as Stack
  return Template.fromStack(stack)
}

describe('foundation stack', () => {
  it('blocks public access and tags every resource with its env', () => {
    for (const name of ['dev', 'prod'] as const) {
      const t = foundation(name)
      t.hasResourceProperties('AWS::S3::Bucket', {
        PublicAccessBlockConfiguration: {
          BlockPublicAcls: true,
          BlockPublicPolicy: true,
          IgnorePublicAcls: true,
          RestrictPublicBuckets: true,
        },
        Tags: Match.arrayWith([{ Key: 'env', Value: name }]),
      })
    }
  })

  it('retains prod data and lets dev data be deleted', () => {
    expect(JSON.stringify(foundation('prod').findResources('AWS::S3::Bucket'))).toContain(
      '"Retain"',
    )
    foundation('dev').resourceCountIs('Custom::S3AutoDeleteObjects', 1)
  })
})

function auth(name: 'dev' | 'prod') {
  const app = new App()
  const stage = new AppStage(app, name, { config: ENVIRONMENTS[name] })
  return Template.fromStack(stage.node.findChild('Auth') as Stack)
}

describe('auth stack (specs/sign-in.md)', () => {
  it('is invite only, needs an authenticator app, and has no SMS', () => {
    for (const name of ['dev', 'prod'] as const) {
      auth(name).hasResourceProperties('AWS::Cognito::UserPool', {
        UserPoolName: `wm-${name}-users`,
        AdminCreateUserConfig: Match.objectLike({ AllowAdminCreateUserOnly: true }),
        MfaConfiguration: 'ON',
        EnabledMfas: ['SOFTWARE_TOKEN_MFA'],
        Policies: { PasswordPolicy: Match.objectLike({ MinimumLength: 12 }) },
      })
    }
  })

  it('gives the browser a public client with the code flow only, and no secret', () => {
    const t = auth('dev')
    t.hasResourceProperties('AWS::Cognito::UserPoolClient', {
      GenerateSecret: false,
      AllowedOAuthFlows: ['code'],
      CallbackURLs: ['http://localhost:5173/'],
      PreventUserExistenceErrors: 'ENABLED',
    })
  })

  it('keeps prod accounts if the stack is deleted, and lets dev go', () => {
    const prod = JSON.stringify(auth('prod').findResources('AWS::Cognito::UserPool'))
    expect(prod).toContain('"Retain"')
    expect(prod).toContain('"DeletionProtection":"ACTIVE"')
    expect(JSON.stringify(auth('dev').findResources('AWS::Cognito::UserPool'))).toContain(
      '"Delete"',
    )
  })
})

describe('access stack', () => {
  const t = Template.fromStack(new AccessStack(new App(), 'Access'))

  it('only trusts this repo’s GitHub environments for deploys', () => {
    t.hasResourceProperties('AWS::IAM::Role', {
      RoleName: 'wm-github-deploy',
      AssumeRolePolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Condition: Match.objectLike({
              StringLike: {
                'token.actions.githubusercontent.com:sub': [
                  'repo:gurire/work-platform:environment:development',
                  'repo:gurire/work-platform:environment:production',
                ],
              },
            }),
          }),
        ]),
      },
    })
  })

  it('gives the Claude role view-only access', () => {
    t.hasResourceProperties('AWS::IAM::Role', {
      RoleName: 'wm-claude-dev-view',
      ManagedPolicyArns: Match.arrayWith([
        Match.objectLike({
          'Fn::Join': Match.arrayWith([
            Match.arrayWith([':iam::aws:policy/job-function/ViewOnlyAccess']),
          ]),
        }),
      ]),
    })
  })
})
