import { App } from 'aws-cdk-lib'
import { AccessStack } from '../lib/access-stack.js'
import { AppStage } from '../lib/app-stage.js'
import { ENVIRONMENTS } from '../lib/config.js'

const app = new App()

// Account and region come from your AWS profile (CDK_DEFAULT_*). With no profile,
// synth still works and produces account-agnostic templates.
const env = {
  account: process.env['CDK_DEFAULT_ACCOUNT'],
  region: process.env['CDK_DEFAULT_REGION'],
}

new AccessStack(app, 'Access', { stackName: 'wm-access', env })
new AppStage(app, 'Dev', { config: ENVIRONMENTS.dev, env })
new AppStage(app, 'Prod', { config: ENVIRONMENTS.prod, env })

app.synth()
