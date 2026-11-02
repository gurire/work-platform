import { Stage, Tags, type StageProps } from 'aws-cdk-lib'
import type { Construct } from 'constructs'
import type { EnvConfig } from './config.js'
import { FoundationStack } from './foundation-stack.js'

export interface AppStageProps extends StageProps {
  readonly config: EnvConfig
}

/** One complete copy of the platform. Instantiated once for dev and once for prod. */
export class AppStage extends Stage {
  constructor(scope: Construct, id: string, props: AppStageProps) {
    super(scope, id, props)
    const { config } = props

    new FoundationStack(this, 'Foundation', {
      stackName: `${config.prefix}-foundation`,
      config,
    })

    Tags.of(this).add('env', config.name)
    Tags.of(this).add('app', 'work-platform')
  }
}
