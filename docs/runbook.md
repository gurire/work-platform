# Runbook

What runs where, how it gets there, and what to do when something breaks. Written for the owner
and the named deputy. Every command here is run by a person with the `wm-admin` profile, never
from a Claude session.

## What runs where

| Piece    | Where                                                             | Name                                                 |
| -------- | ----------------------------------------------------------------- | ---------------------------------------------------- |
| Web app  | S3 bucket behind CloudFront                                       | stack `wm-<env>-hosting`, output `SiteUrl`           |
| API      | ECS Fargate, one task (0.25 vCPU, 512 MB), behind a load balancer | service in cluster from output `ClusterName`         |
| Database | RDS PostgreSQL 16, `db.t4g.micro`, private subnets only           | database `workplatform`, password in Secrets Manager |
| Files    | S3 attachments bucket (Foundation stack)                          | env `WM_FILES_BUCKET`                                |
| Sign-in  | Cognito (Auth stack)                                              |                                                      |
| Logs     | CloudWatch Logs, kept 1 month                                     | log group with prefix `api`                          |
| Alerts   | SNS topic emailing `alertEmails` in `infra/lib/config.ts`         | alarms `ApiDown`, `DatabaseDiskLow`                  |

`/api/*` on the site goes to the API (CloudFront strips the `/api`); everything else is the web
app. Live updates use a WebSocket at `/api/live`.

Rough running cost per stage, before free-tier credits: about US$50–60 a month (load balancer,
database, one Fargate task, public IPv4 addresses). Check it in the AWS Pricing Calculator before
go-live; it is an estimate, not a quote.

### Known limitation: HTTP between CloudFront and the load balancer

Until there is a domain name, CloudFront talks to the load balancer over plain HTTP inside AWS.
Browsers still only ever see HTTPS. Once a domain exists: request an ACM certificate, add an
HTTPS listener on the load balancer, switch the `/api/*` origin to `HTTPS_ONLY`, and close port 80. Track this as a go-live item.

## Deploying

Deploys only happen through GitHub Actions (`.github/workflows/deploy.yml`):

- Every push to `main` deploys **Dev**.
- **Prod** deploys only from **Actions → Deploy → Run workflow → Prod**, through the
  `production` environment.

The workflow runs the tests, builds the web app, then `cdk deploy`. CDK builds the API image from
`apps/api/Dockerfile` and pushes it to its own bootstrap repository, so no extra rights are
needed. It ends with a smoke test that calls `<SiteUrl>api/health` until it answers.

Before the first Prod deploy, put the owner's and deputy's addresses in `alertEmails` in
`infra/lib/config.ts`. Each person must click the confirmation link AWS emails them, or they get
no alerts.

## Rolling back

ECS rolls back by itself if a new API version never becomes healthy (deployment circuit
breaker). To go back to an older version on purpose:

1. In GitHub, revert the bad commit on `main` (or re-run an older successful Deploy run).
2. The next deploy puts the old code back.

Database changes are expand/contract only, so the previous API version still works with the
newer schema. Never write a migration that the previous version cannot run against.

## When an alert fires

**ApiDown** (no healthy API task for 3 minutes):

1. Open the site. If it loads but shows errors, the API is down; if nothing loads, check
   CloudFront and the AWS Health Dashboard.
2. Check the API is answering:
   `curl -i <SiteUrl>api/health`
   - `503 {"status":"database_unavailable"}`: the API runs but cannot reach the database. Go to
     **Database problems** below.
   - No answer: look at the service's recent events and logs:
     ```bash
     aws ecs describe-services --cluster <ClusterName> --services <ServiceName> \
       --query "services[0].events[0:10].message" --profile wm-admin
     aws logs tail /aws/ecs/... --since 30m --profile wm-admin   # the log group named in the task definition
     ```
3. If the last deploy caused it, roll back (above). If a task keeps crashing with
   "Refusing to start", an environment value is missing; the message names it.
4. To restart the API without a deploy:
   `aws ecs update-service --cluster <ClusterName> --service <ServiceName> --force-new-deployment --profile wm-admin`

**DatabaseDiskLow** (under 2 GB free): storage grows on its own up to 100 GB, so this usually
means it is near that ceiling or something is writing far too much. Check the largest tables, and
raise `maxAllocatedStorage` in `hosting-stack.ts` if the growth is real.

## Database problems

- **Status**: RDS console → the instance → _Monitoring_ and _Logs & events_.
- **Encryption**: the API connects with TLS and checks the certificate against AWS's RDS
  certificate bundle, baked into the image (`NODE_EXTRA_CA_CERTS`). Set `DATABASE_SSL=off` only
  for a local database.
- **Password**: lives in Secrets Manager. The API reads it at start-up, so after a rotation run
  the force-new-deployment command above.
- The database has no public address. There is no bastion host by design; use the restore-drill
  method below (a one-off task inside the VPC) when you need to run a query.

## Backups

1. **Automatic backups**: RDS takes a daily snapshot and keeps 14 days in Prod (1 day in Dev),
   with point-in-time restore to any second inside that window.
2. **Export**: an org admin can download everything from `GET /api/core/export` (JSON, all
   tables) or `GET /api/core/export?format=csv` (work items, opens in Excel). Take one before any
   risky change and once a month as an offline copy.
3. **Final snapshot**: Prod takes one automatically if the stack is ever deleted.

## Restore drill (do this once before go-live, then every quarter)

The point is to prove a backup can actually be read, without touching the live database.

1. Restore to a new instance, next to the live one:
   ```bash
   aws rds restore-db-instance-to-point-in-time \
     --source-db-instance-identifier <live instance id> \
     --target-db-instance-identifier wm-prod-restore-drill \
     --restore-time <an ISO time within the last 14 days> \
     --db-subnet-group-name <the live instance's subnet group> \
     --vpc-security-group-ids <the live instance's security group> \
     --no-publicly-accessible --profile wm-admin
   aws rds wait db-instance-available --db-instance-identifier wm-prod-restore-drill --profile wm-admin
   ```
2. Count rows in the restored copy with a one-off API task (same image, same secrets, a different
   host). In the ECS console: _Run new task_ with the API task definition, in the public subnets
   with a public IP, and override:
   - environment `DATABASE_HOST` = the restored instance's endpoint
   - command:
     `node -e "const {Client}=require('pg');const c=new Client({host:process.env.DATABASE_HOST,user:process.env.DATABASE_USER,password:process.env.DATABASE_PASSWORD,database:'workplatform',ssl:true});c.connect().then(()=>c.query('select (select count(*) from work_items) items,(select count(*) from comments) comments,(select max(id) from schema_migrations) migration')).then(r=>{console.log(JSON.stringify(r.rows[0]));return c.end()})"`
3. Read the task's log: the counts should be close to the live site's, and the migration should
   be the latest one.
4. Delete the drill instance (no final snapshot):
   ```bash
   aws rds delete-db-instance --db-instance-identifier wm-prod-restore-drill \
     --skip-final-snapshot --profile wm-admin
   ```
5. Write the date, the restore time used, the counts and how long it took in the drill log
   below.

### Real restore

Same as the drill, then point the API at the restored instance: the simplest safe route is to
note the data you need from the restored copy and re-enter or re-import it. Swapping the live
database is a change to `hosting-stack.ts` (restore from snapshot) and goes through a reviewed
deploy, never a hand edit in the console, because the next deploy would undo a console change.

### Drill log

| Date | Restore time used | Items / comments counted | Minutes taken | By  |
| ---- | ----------------- | ------------------------ | ------------- | --- |
|      |                   |                          |               |     |
