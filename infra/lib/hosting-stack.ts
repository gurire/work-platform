import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib'
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront'
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins'
import * as cw from 'aws-cdk-lib/aws-cloudwatch'
import * as cwActions from 'aws-cdk-lib/aws-cloudwatch-actions'
import * as ec2 from 'aws-cdk-lib/aws-ec2'
import { Platform } from 'aws-cdk-lib/aws-ecr-assets'
import * as ecs from 'aws-cdk-lib/aws-ecs'
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2'
import * as logs from 'aws-cdk-lib/aws-logs'
import * as rds from 'aws-cdk-lib/aws-rds'
import * as s3 from 'aws-cdk-lib/aws-s3'
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment'
import * as sns from 'aws-cdk-lib/aws-sns'
import * as subs from 'aws-cdk-lib/aws-sns-subscriptions'
import type { Construct } from 'constructs'
import type { EnvConfig } from './config.js'

/** The repository root, where the API Dockerfile build starts. */
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

export interface HostingStackProps extends StackProps {
  readonly config: EnvConfig
  readonly attachmentsBucket: s3.IBucket
  readonly userPoolId: string
  readonly userPoolClientId: string
}

/**
 * Runs the platform (WP-BRIEF-002, Tech stack): PostgreSQL on RDS, the API on ECS Fargate
 * behind a load balancer (it holds WebSockets), the web app on S3 + CloudFront, and alarms that
 * email when the site stops answering. Deployed only by GitHub Actions, never from a laptop.
 */
export class HostingStack extends Stack {
  constructor(scope: Construct, id: string, props: HostingStackProps) {
    super(scope, id, props)
    const { config } = props
    const keep = config.retainData

    // No NAT gateway (a fixed monthly cost): the API runs in public subnets with a public
    // address but only the load balancer may reach it; the database has no internet route.
    const vpc = new ec2.Vpc(this, 'Network', {
      maxAzs: 2,
      natGateways: 0,
      subnetConfiguration: [
        { name: 'public', subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 },
        { name: 'data', subnetType: ec2.SubnetType.PRIVATE_ISOLATED, cidrMask: 24 },
      ],
    })

    const db = new rds.DatabaseInstance(this, 'Database', {
      engine: rds.DatabaseInstanceEngine.postgres({ version: rds.PostgresEngineVersion.VER_16 }),
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T4G, ec2.InstanceSize.MICRO),
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      credentials: rds.Credentials.fromGeneratedSecret('workplatform'),
      databaseName: 'workplatform',
      allocatedStorage: 20,
      maxAllocatedStorage: 100,
      storageType: rds.StorageType.GP3,
      storageEncrypted: true,
      publiclyAccessible: false,
      multiAz: false,
      // Daily backups kept 14 days in prod (Quality and safety net); restore steps in docs/runbook.md.
      backupRetention: Duration.days(keep ? 14 : 1),
      deletionProtection: keep,
      removalPolicy: keep ? RemovalPolicy.SNAPSHOT : RemovalPolicy.DESTROY,
    })

    const cluster = new ecs.Cluster(this, 'Cluster', {
      vpc,
      containerInsightsV2: ecs.ContainerInsights.DISABLED,
    })
    const task = new ecs.FargateTaskDefinition(this, 'ApiTask', { cpu: 256, memoryLimitMiB: 512 })
    const dbSecret = db.secret
    if (!dbSecret) throw new Error('The database must have a generated secret')
    task.addContainer('api', {
      // CDK builds apps/api/Dockerfile and pushes it to its own bootstrap repository at deploy
      // time, using its publishing role, so the GitHub deploy role needs no extra rights.
      image: ecs.ContainerImage.fromAsset(REPO_ROOT, {
        file: 'apps/api/Dockerfile',
        platform: Platform.LINUX_AMD64,
      }),
      portMappings: [{ containerPort: 3000 }],
      environment: {
        NODE_ENV: 'production',
        HOST: '0.0.0.0',
        PORT: '3000',
        DATABASE_HOST: db.dbInstanceEndpointAddress,
        DATABASE_PORT: db.dbInstanceEndpointPort,
        DATABASE_NAME: 'workplatform',
        WM_FILES_BUCKET: props.attachmentsBucket.bucketName,
        COGNITO_USER_POOL_ID: props.userPoolId,
        COGNITO_CLIENT_ID: props.userPoolClientId,
      },
      secrets: {
        DATABASE_USER: ecs.Secret.fromSecretsManager(dbSecret, 'username'),
        DATABASE_PASSWORD: ecs.Secret.fromSecretsManager(dbSecret, 'password'),
      },
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: 'api',
        logRetention: logs.RetentionDays.ONE_MONTH,
      }),
    })
    props.attachmentsBucket.grantReadWrite(task.taskRole)

    const service = new ecs.FargateService(this, 'Api', {
      cluster,
      taskDefinition: task,
      desiredCount: 1,
      assignPublicIp: true,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      circuitBreaker: { rollback: true },
      minHealthyPercent: 100,
      maxHealthyPercent: 200,
    })
    db.connections.allowDefaultPortFrom(service, 'API to database')

    const lb = new elbv2.ApplicationLoadBalancer(this, 'LoadBalancer', {
      vpc,
      internetFacing: true,
      idleTimeout: Duration.seconds(300), // Live updates keep a WebSocket open.
    })
    const listener = lb.addListener('Http', { port: 80, open: true })
    const target = listener.addTargets('Api', {
      port: 3000,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targets: [service],
      healthCheck: { path: '/health', healthyHttpCodes: '200', interval: Duration.seconds(30) },
      deregistrationDelay: Duration.seconds(30),
    })

    // The web app: a private bucket served only through CloudFront.
    const web = new s3.Bucket(this, 'Web', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    })
    // /api/... goes to the API without the /api prefix, as the Vite dev server does.
    const stripApi = new cloudfront.Function(this, 'StripApi', {
      code: cloudfront.FunctionCode.fromInline(
        "function handler(event) { var r = event.request; r.uri = r.uri.replace(/^\\/api/, '') || '/'; return r; }",
      ),
      runtime: cloudfront.FunctionRuntime.JS_2_0,
    })
    const site = new cloudfront.Distribution(this, 'Site', {
      defaultRootObject: 'index.html',
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(web),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      },
      additionalBehaviors: {
        '/api/*': {
          origin: new origins.HttpOrigin(lb.loadBalancerDnsName, {
            protocolPolicy: cloudfront.OriginProtocolPolicy.HTTP_ONLY,
            readTimeout: Duration.seconds(60),
          }),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
          functionAssociations: [
            { function: stripApi, eventType: cloudfront.FunctionEventType.VIEWER_REQUEST },
          ],
        },
      },
    })
    const dist = join(REPO_ROOT, 'apps', 'web', 'dist')
    if (existsSync(join(dist, 'index.html'))) {
      new s3deploy.BucketDeployment(this, 'WebFiles', {
        sources: [s3deploy.Source.asset(dist)],
        destinationBucket: web,
        distribution: site,
        distributionPaths: ['/*'],
      })
    }

    // Downtime alerts: an email to the owner and the deputy when the API stops answering.
    const alerts = new sns.Topic(this, 'Alerts', {
      displayName: `Work Platform ${config.name} alerts`,
    })
    for (const email of config.alertEmails)
      alerts.addSubscription(new subs.EmailSubscription(email))
    const down = new cw.Alarm(this, 'ApiDown', {
      alarmDescription:
        'The API has no healthy task: the site is not answering. See docs/runbook.md.',
      metric: target.metrics.healthyHostCount({
        period: Duration.minutes(1),
        statistic: 'Minimum',
      }),
      threshold: 1,
      comparisonOperator: cw.ComparisonOperator.LESS_THAN_THRESHOLD,
      evaluationPeriods: 3,
      treatMissingData: cw.TreatMissingData.BREACHING,
    })
    const disk = new cw.Alarm(this, 'DatabaseDiskLow', {
      alarmDescription: 'The database has less than 2 GB free. See docs/runbook.md.',
      metric: db.metricFreeStorageSpace({ period: Duration.minutes(5) }),
      threshold: 2 * 1024 ** 3,
      comparisonOperator: cw.ComparisonOperator.LESS_THAN_THRESHOLD,
      evaluationPeriods: 2,
    })
    for (const alarm of [down, disk]) {
      alarm.addAlarmAction(new cwActions.SnsAction(alerts))
      alarm.addOkAction(new cwActions.SnsAction(alerts))
    }

    new CfnOutput(this, 'SiteUrl', { value: `https://${site.distributionDomainName}/` })
    new CfnOutput(this, 'ClusterName', { value: cluster.clusterName })
    new CfnOutput(this, 'ServiceName', { value: service.serviceName })
  }
}
