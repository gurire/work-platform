import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib'
import * as cognito from 'aws-cdk-lib/aws-cognito'
import type { Construct } from 'constructs'
import type { EnvConfig } from './config.js'

export interface AuthStackProps extends StackProps {
  readonly config: EnvConfig
}

/**
 * Sign-in (specs/sign-in.md): one invite-only Cognito user pool per environment, two-step
 * sign-in with an authenticator app, and a public web client using the code flow with PKCE.
 * The Lite plan has no monthly charge for the first 10,000 users.
 */
export class AuthStack extends Stack {
  readonly userPool: cognito.UserPool
  readonly webClient: cognito.UserPoolClient

  constructor(scope: Construct, id: string, props: AuthStackProps) {
    super(scope, id, props)
    const { config } = props

    this.userPool = new cognito.UserPool(this, 'Users', {
      userPoolName: `${config.prefix}-users`,
      featurePlan: cognito.FeaturePlan.LITE,
      selfSignUpEnabled: false,
      signInAliases: { email: true },
      signInCaseSensitive: false,
      autoVerify: { email: true },
      standardAttributes: { email: { required: true, mutable: true } },
      mfa: cognito.Mfa.REQUIRED,
      mfaSecondFactor: { sms: false, otp: true },
      passwordPolicy: {
        minLength: 12,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: false,
        tempPasswordValidity: Duration.days(3),
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      userInvitation: {
        emailSubject: 'You are invited to the Work Platform',
        emailBody:
          'You have been invited to the Work Platform. Sign in with {username} and the temporary password {####}. You will set your own password and an authenticator app.',
      },
      deletionProtection: config.retainData,
      removalPolicy: config.retainData ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
    })

    this.webClient = this.userPool.addClient('Web', {
      userPoolClientName: `${config.prefix}-web`,
      generateSecret: false,
      authFlows: { userSrp: true },
      preventUserExistenceErrors: true,
      supportedIdentityProviders: [cognito.UserPoolClientIdentityProvider.COGNITO],
      oAuth: {
        flows: { authorizationCodeGrant: true },
        scopes: [cognito.OAuthScope.OPENID, cognito.OAuthScope.EMAIL, cognito.OAuthScope.PROFILE],
        callbackUrls: [...config.appUrls],
        logoutUrls: [...config.appUrls],
      },
      idTokenValidity: Duration.hours(1),
      accessTokenValidity: Duration.hours(1),
      refreshTokenValidity: Duration.hours(12),
      enableTokenRevocation: true,
    })

    const domain = this.userPool.addDomain('Domain', {
      cognitoDomain: { domainPrefix: config.authDomainPrefix },
    })

    new CfnOutput(this, 'UserPoolId', { value: this.userPool.userPoolId })
    new CfnOutput(this, 'WebClientId', { value: this.webClient.userPoolClientId })
    new CfnOutput(this, 'SignInDomain', { value: domain.baseUrl() })
  }
}
