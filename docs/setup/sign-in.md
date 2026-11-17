<h1 align="center">Setting up sign-in</h1>
<p align="center">Inviting people and trying Cognito sign-in locally</p>

<table>
  <tr><td valign="middle"><b>Date</b></td><td valign="middle">17 Nov 2026</td></tr>
  <tr><td valign="middle"><b>Reference</b></td><td valign="middle">SETUP-AUTH-001</td></tr>
  <tr><td valign="middle"><b>Subject</b></td><td valign="middle">Cognito user pool outputs, first invitations, and local settings</td></tr>
</table>

The rules are in `specs/sign-in.md`. This page is the how-to. Run the commands in PowerShell on
your PC with your own AWS sign-in (never in a Claude session).

## 1. Where the user pool comes from

Merging to main runs the deploy workflow, which deploys the Dev stage, including the
`wm-dev-auth` stack. Prod deploys only when you run the workflow by hand.

Before deploying Prod, put its real web address in `infra/lib/config.ts` (`appUrls`). Until
then Prod has a placeholder address, so nobody can sign in to Prod.

Find the values you need (Dev shown):

```powershell
aws cloudformation describe-stacks --stack-name wm-dev-auth --region ap-south-1 --query "Stacks[0].Outputs" --output table
```

You get `UserPoolId`, `WebClientId` and `SignInDomain`.

## 2. Invite a person

Every person needs two things with the same email: a Cognito account and a Work Platform user.

```powershell
aws cognito-idp admin-create-user --region ap-south-1 --user-pool-id <UserPoolId> `
  --username priya@yourcompany.com `
  --user-attributes Name=email,Value=priya@yourcompany.com Name=email_verified,Value=true `
  --desired-delivery-mediums EMAIL
```

Cognito emails a temporary password (valid 3 days). At first sign-in the person sets their own
password and an authenticator app. The Work Platform user with that email is linked on first
sign-in; there is no user interface for adding users yet.

## 3. Try it locally against the Dev pool

The sample data gives every sample person an `@example.org` email. To sign in as Asha Rao (org
admin) without a real mailbox, invite that address with a temporary password and no email:

```powershell
aws cognito-idp admin-create-user --region ap-south-1 --user-pool-id <UserPoolId> `
  --username asha.rao@example.org `
  --user-attributes Name=email,Value=asha.rao@example.org Name=email_verified,Value=true `
  --temporary-password "Temp-Passw0rd-1" --message-action SUPPRESS
```

Then give the app the pool's settings. For the API, set two values in the PowerShell window you
will run `pnpm dev` from:

```powershell
$env:COGNITO_USER_POOL_ID = "<UserPoolId>"
$env:COGNITO_CLIENT_ID = "<WebClientId>"
```

For the web app, create the file `apps/web/.env.local` (git ignores it) containing:

```
VITE_COGNITO_DOMAIN=<SignInDomain>
VITE_COGNITO_CLIENT_ID=<WebClientId>
```

Run `pnpm dev`, open http://localhost:5173 and sign in with `asha.rao@example.org` and the
temporary password. The "Dev sign-in" picker is gone and the sidebar shows **Sign out**.

To go back to development sign-in, delete `apps/web/.env.local` and open a new PowerShell
window (so the two `COGNITO_` values are gone).

## 4. Remove someone

```powershell
aws cognito-idp admin-disable-user --region ap-south-1 --user-pool-id <UserPoolId> --username priya@yourcompany.com
```

Disabling stops new sign-ins at once; a session already open ends within an hour, when its token
expires.
