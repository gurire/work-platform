<h1 align="center">Sign-in</h1>
<p align="center">How people sign in with Amazon Cognito, and how the API knows who they are</p>

<table>
  <tr><td valign="middle"><b>Date</b></td><td valign="middle">17 Nov 2026</td></tr>
  <tr><td valign="middle"><b>Reference</b></td><td valign="middle">SPEC-AUTH-001</td></tr>
  <tr><td valign="middle"><b>Subject</b></td><td valign="middle">Accounts, invitations, two-step sign-in, sessions, and the development sign-in</td></tr>
</table>

**Status: DRAFT.** Written by Claude after the owner chose Amazon Cognito on 17 Nov 2026. Every
default below is marked _(default)_. It becomes binding when the owner merges it. It changes no
permission: who may do what still comes from `specs/permission-matrix.md`.

---

## 1. Accounts

1. **One Cognito user pool per environment** (dev and prod), in ap-south-1, named
   `wm-<env>-users`.
2. **Invite only.** Nobody can sign themselves up. An org admin invites a person by email;
   Cognito sends a temporary password.
3. **Email is the sign-in name.** Emails are unique and must be verified.
4. **Passwords:** at least 12 characters with upper case, lower case and a number
   _(default)_. Temporary passwords expire after 3 days _(default)_.
5. **Two-step sign-in is required** for everyone, using an authenticator app (TOTP). Text
   messages are not offered _(default: they cost money and are weaker)_.
6. **Prod keeps its accounts** if the stack is deleted; dev accounts may be deleted.

## 2. Linking a Cognito account to a Work Platform user

1. Every Work Platform user may hold one Cognito identity (its `sub`).
2. **First sign-in:** if no user holds this `sub` yet, the user whose email equals the token's
   verified email is linked to it. If there is no such user, or the email is not verified,
   sign-in is refused with "You have not been invited" (HTTP 403).
3. **Later sign-ins** find the user by `sub` only. Changing an email in Cognito does not move the
   account to another user.
4. An org admin adds the Work Platform user (name, email, org role) at the same time as the
   Cognito invitation. Until a user interface exists, `docs/setup/sign-in.md` gives the commands.

## 3. Sessions

1. The web app uses Cognito managed login with the authorisation code flow and PKCE. No client
   secret exists in the browser.
2. The API accepts `Authorization: Bearer <ID token>` and checks its signature, issuer,
   audience (the app client), expiry and `token_use = id`.
3. ID tokens last 1 hour; refresh tokens 12 hours _(default: one working day)_. The web app
   refreshes quietly before expiry and signs out when it cannot.
4. Tokens are kept for the browser tab only (session storage) _(default)_, so closing the tab
   signs you out.
5. **Sign out** ends the Cognito session and clears the tokens.

## 4. Development sign-in

1. The "act as" header sign-in stays for local development only.
2. It is on only when the API runs without Cognito settings. The API refuses to start in
   production with it on, and refuses to start in production without Cognito settings.
3. The web app shows the "Dev sign-in" picker only when it has no Cognito settings.

## 5. Worked examples

1. Priya is invited with priya@example.org and a Work Platform user with the same email exists.
   She signs in, sets a password and an authenticator app; her account is linked by `sub`.
2. Someone with a Cognito account but no Work Platform user signs in: "You have not been
   invited". Nothing is created.
3. Priya's email is later changed in Cognito to p.k@example.org. She still signs in as the same
   user, because the link is the `sub`.
4. A token for another app client, an expired token, or a tampered token: 401.
5. The API is started in production without Cognito settings: it refuses to start.
