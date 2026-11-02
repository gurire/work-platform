# First AWS deploy

You run these steps yourself in a terminal. Claude Code sessions are blocked from `cdk deploy`.
Replace `<ACCOUNT>` with your 12-digit account ID and `<REGION>` with your chosen region.

## 1. Secure the account

1. Turn on MFA for the root user, then stop using root for daily work.
2. Billing console → Budgets: create a monthly cost budget with email alerts at 50%, 80% and 100%.
   After the first deploy, add per-environment budgets filtered on the `env` tag
   (activate `env` as a cost allocation tag first).

## 2. Create your everyday admin sign-in

1. Open IAM Identity Center and enable it. This creates a free AWS Organization containing
   just your account; it is still one account.
2. Create a user for yourself, a permission set with `AdministratorAccess`, and assign both
   to your account.
3. On your PC:
   ```bash
   aws configure sso --profile wm-admin
   aws sso login --profile wm-admin
   aws sts get-caller-identity --profile wm-admin
   ```

## 3. Bootstrap CDK and deploy the access roles

```bash
cd infra
pnpm exec cdk bootstrap aws://<ACCOUNT>/<REGION> --profile wm-admin
pnpm exec cdk deploy Access --profile wm-admin
```

This creates the GitHub deploy role (`wm-github-deploy`) and the view-only Claude role
(`wm-claude-dev-view`). It does not create any paid resources.

## 4. Add the view-only profile for Claude and the AWS MCP

Add to `~/.aws/config`:

```ini
[profile wm-claude-view]
role_arn = arn:aws:iam::<ACCOUNT>:role/wm-claude-dev-view
source_profile = wm-admin
region = <REGION>
```

## 5. Let GitHub Actions deploy

In the GitHub repo, open **Settings**:

1. **Environments**: create `development` and `production`. On `production`, add yourself as a
   required reviewer. On a free personal account this may need GitHub Pro for a private repo;
   without it, Prod still only deploys when you start it by hand.
2. **Secrets and variables → Actions → Variables**:
   - `AWS_DEPLOY_ROLE_ARN` = `arn:aws:iam::<ACCOUNT>:role/wm-github-deploy`
   - `AWS_REGION` = `<REGION>`

From then on, every push to `main` deploys Dev. Deploy Prod from **Actions → Deploy → Run
workflow → Prod**.
