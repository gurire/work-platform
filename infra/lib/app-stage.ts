import { Stage, Tags, type StageProps } from 'aws-cdk-lib'
import type { Construct } from 'constructs'
import type { EnvConfig } from './config.js'
import { FoundationStack } from './foundation-stack.js'
import { AuthStack } from './auth-stack.js'
import { HostingStack } from './hosting-stack.js'

export interface AppStageProps extends StageProps {
  readonly config: EnvConfig
}

/** One complete copy of the platform. Instantiated once for dev and once for prod. */
export class AppStage extends Stage {
  constructor(scope: Construct, id: string, props: AppStageProps) {
    super(scope, id, props)
    const { config } = props

    const foundation = new FoundationStack(this, 'Foundation', {
      stackName: `${config.prefix}-foundation`,
      config,
    })

    const auth = new AuthStack(this, 'Auth', {
      stackName: `${config.prefix}-auth`,
      config,
    })

    new HostingStack(this, 'Hosting', {
      stackName: `${config.prefix}-hosting`,
      config,
      attachmentsBucket: foundation.attachmentsBucket,
      userPoolId: auth.userPool.userPoolId,
      userPoolClientId: auth.webClient.userPoolClientId,
    })

    Tags.of(this).add('env', config.name)
    Tags.of(this).add('app', 'work-platform')
  }
}
