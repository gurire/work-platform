import { Duration, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib'
import * as s3 from 'aws-cdk-lib/aws-s3'
import type { Construct } from 'constructs'
import type { EnvConfig } from './config.js'

export interface FoundationStackProps extends StackProps {
  readonly config: EnvConfig
}

/**
 * Per-environment foundation. Starts with the attachments bucket only, which costs
 * nothing until used. VPC, RDS Postgres and OpenSearch are added when the API needs
 * them, because they carry fixed monthly costs.
 */
export class FoundationStack extends Stack {
  readonly attachmentsBucket: s3.Bucket

  constructor(scope: Construct, id: string, props: FoundationStackProps) {
    super(scope, id, props)
    const { config } = props

    this.attachmentsBucket = new s3.Bucket(this, 'Attachments', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: config.retainData,
      lifecycleRules: [{ abortIncompleteMultipartUploadAfter: Duration.days(7) }],
      removalPolicy: config.retainData ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
      autoDeleteObjects: !config.retainData,
    })
  }
}
