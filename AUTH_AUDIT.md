# Authentication audit

## Scope and environment

This audit covers the application authentication experience on the active pre-launch
`develop` branch. Local development and Vercel Preview use Test Supabase project
`rbmxegyiwntomhpbepnu`. Production (`main`, Supabase project
`sswyxbugbdoadktyaows`) intentionally may lag behind and is not part of this rollout.

No database migration or new environment variable is required by these changes.

## Pre-change journey map

| Journey | Previous behavior and landing point |
|---|---|
| Email/password signup | Called `signUp` without an explicit email redirect. Immediate sessions went to `/dashboard`; confirmed-email flows depended on the Supabase Site URL. |
| Google signup | Started Google OAuth and returned through `/auth/callback` to `/dashboard`. |
| Email/password login | Signed in client-side and always went to `/dashboard`, even when a protected page supplied `next`. |
| Google login | Returned through `/auth/callback` and always went to `/dashboard`. |
| Magic-link login | Sent a link to `/auth/callback`, allowed account creation by default, and landed on `/dashboard`. |
| Incorrect password or Google-only account | Showed a generic message suggesting Google or setting a password, but provided no set-password action. |
| Forgot password | Required an email in the login field, sent recovery through `/auth/callback`, and opened `/reset-password`. |
| Signed-in password management | Sent another recovery email rather than allowing the authenticated user to set a password directly. |
| Expired reset link | Rendered a generic invalid-link screen with only a route back to login. |
| OAuth cancellation/failure | Callback added an error code to the login URL, but login did not read or display it. |
| Protected navigation | Some server pages preserved `next`; several client pages showed nothing while checking a session and redirected without preserving their destination. |
| Authenticated visit to login/signup | Client-side session check rendered a blank page, then redirected to `/dashboard`. |
| Logout | Signed out and navigated to login without a busy state or failure feedback. |
| Pricing-to-login | Pricing supplied `next=/pricing`, but login ignored it. |

## Supabase behavior relied upon

The implementation follows current Supabase Auth documentation rather than inferring identity
state from UI metadata:

- A user can have multiple identities, and Supabase automatically links identities that present
  the same verified email address.
- A signed-in OAuth user can add email/password access with
  `updateUser({ password })`; the application does not need a custom linking primitive.
- Signing up with email after an OAuth account already exists can deliberately return an
  obfuscated response and send no email. The UI therefore gives useful alternatives without
  revealing whether an account exists.
- `resetPasswordForEmail` deliberately does not reveal whether an email is registered.
- Server-side rendering uses PKCE; callback codes are exchanged server-side and have short,
  one-time validity.
- Auth API errors are handled by stable `error.code` values rather than English message matching.

References:

- [Supabase identity linking](https://supabase.com/docs/guides/auth/auth-identity-linking)
- [Supabase password-based authentication](https://supabase.com/docs/guides/auth/passwords)
- [Supabase Auth error codes](https://supabase.com/docs/guides/auth/debugging/error-codes)
- [Supabase redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls)
- [Supabase SSR client guidance](https://supabase.com/docs/guides/auth/server-side/creating-a-client?queryGroups=framework&framework=nextjs)

The September 2026 breaking-change index was also checked. Its Auth-relevant entries concern
self-hosted endpoint configuration and hosted default-email template restrictions, not the
client methods used here. The final hosted verification below records the actual Test provider,
SMTP, Site URL, and redirect settings.

## Findings and decisions

### High priority

1. Intended destinations were accepted inconsistently and discarded by login/signup. A single
   strict relative-path sanitizer now rejects external, protocol-relative, backslash-normalized,
   callback, and auth-loop destinations.
2. Email confirmation had no request-origin callback. Confirmation links could therefore return
   to the configured Site URL instead of the active Preview. Signup now supplies the current
   origin and safe intended destination explicitly.
3. The password-mismatch message created a dead end. Incorrect credentials now remain
   non-enumerating while offering immediate Google and secure password-link actions.
4. Callback failures were invisible. OAuth cancellation, expired PKCE state, expired OTPs,
   malformed callbacks, and general callback failures now arrive as whitelisted, plain-English
   login states.
5. Password creation for a signed-in Google user was unnecessarily indirect. Account now offers
   direct password creation/change using authenticated `updateUser`, with a secure emailed flow
   when Supabase requires reauthentication.

### Reliability and polish

- Login, signup, and reset entry pages validate the user on the server, removing blank
  client-side session checks.
- The proxy refreshes and validates sessions before rendering protected page namespaces.
- Expired-session redirects preserve the original path and query string.
- Auth actions share one busy state, disable duplicate submissions, use `try/finally`, and show
  understandable network/rate-limit/provider failures.
- Email is carried between login and signup; the intended destination is carried through email,
  password, Google, confirmation, and recovery journeys.
- Password fields use associated labels, autocomplete hints, visibility controls, requirements,
  and submit-on-enter behavior.
- Magic-link sign-in sets `shouldCreateUser: false`, so the login alternative cannot silently
  create a new account.
- Logout validates the initial user, shows progress, and reports failure instead of pretending
  the user is signed out.

## Post-change journey behavior

| Journey | Intended experience |
|---|---|
| New user with Google | Continue with Google, return through the server callback, then go directly to the original safe destination. |
| New user with email/password | Create the account; either continue immediately or receive a confirmation email that returns to the original safe destination. |
| Existing account during signup | Receive the same non-enumerating confirmation state, plus clear sign-in and Google alternatives if no email arrives. |
| OAuth cancellation/failure | Return to login with a clear, recoverable message and both sign-in methods still available. |
| Correct password login | Go directly to the preserved destination. |
| Wrong password or no password yet | See a plain-English error with direct Google and secure password-link actions. |
| Magic link | Receive a non-enumerating sign-in email only for an existing account, then return to the preserved destination. |
| Forgot/create/reset password | Request one secure email, set the password on a verified session, then continue to the preserved destination. |
| Signed-in user wants a password | Set or change it directly in Account without learning about providers or linked identities. |
| Supabase requires recent authentication | Use the secure password-link fallback. |
| Expired/used recovery link | See why the link no longer works and a direct route to request another. |
| Session expires on a protected page | Return to login with an explanation and the complete original destination preserved. |
| Authenticated login/signup visit | Redirect server-side to the requested safe destination or dashboard. |
| Logout | Show an in-progress state; on success show signed-out confirmation, and on failure keep the user in place with retry guidance. |

## Security review

- Page protection is performed with server-validated `getUser`, while route handlers retain
  their own authorization checks. UI redirects are not an authorization boundary.
- No authorization decision uses `user_metadata` or provider display metadata.
- The service-role key remains server-only.
- Callback and `next` handling cannot redirect off-origin and avoids login/signup/callback loops.
- Password recovery and signup responses do not disclose whether an email exists.
- OAuth code exchange and OTP verification remain delegated to Supabase Auth; no custom token or
  identity mechanism was introduced.
- Callback error descriptions from external query parameters are never shown directly.
- Password policy is validated in the UI for fast feedback and remains enforced by Supabase as
  the authoritative control.

## Automated coverage

The auth tests cover:

- successful and failed password login contracts;
- the Google-user/password-mismatch recovery copy;
- non-creating magic links;
- Preview-aware signup and recovery redirects;
- direct authenticated password creation/update;
- password validation;
- callback success, cancellation, expiry, malformed input, recovery, and unsafe redirects;
- protected destination preservation, expired-session handling, and authenticated auth-page
  redirects.

## Hosted Test checklist

After the changes are deployed from `develop`, verify against the stable Preview and Test project
`rbmxegyiwntomhpbepnu`:

1. Confirm the deployment's public Supabase URL resolves to `rbmxegyiwntomhpbepnu`.
2. Confirm Google and email/password providers are enabled in Test.
3. Confirm Test Site URL and allowed redirects include localhost, the stable `develop` Preview,
   and the required Vercel Preview wildcard.
4. Confirm the Google OAuth client includes the Test Supabase callback URI.
5. Confirm Test SMTP can deliver confirmation, magic-link, recovery, and security-action emails
   to non-team users; Supabase's default SMTP is unsuitable for a production-quality rollout.
6. Exercise Google signup, Google return, Google cancellation, email signup/confirmation,
   password login failure/success, magic link, password recovery, direct password creation for a
   Google-created user, expired link, protected destination return, mobile layout, and logout.
7. Confirm `main`, Production Vercel, Supabase Production `sswyxbugbdoadktyaows`, and Stripe Live
   remain unchanged.

## Final hosted E2E verification — 13 September 2026

The final pass used only `develop`, the stable `develop` Preview, and Test Supabase project
`rbmxegyiwntomhpbepnu`. The stable Test origin is:

`https://template-app-git-develop-james-mcbrides-projects.vercel.app`

### Verified hosted configuration

- Test Site URL is the stable `develop` Preview origin above.
- Test redirect allow-list contains only the stable Preview and intentional localhost versions
  of `/auth/callback` and `/reset-password`. It contains no Production or retired Preview URL.
- Vercel Preview public and service-role Supabase variables resolve to Test project
  `rbmxegyiwntomhpbepnu`; no branch-specific override supersedes them.
- Google is enabled with configured Test credentials. The live OAuth request uses
  `https://rbmxegyiwntomhpbepnu.supabase.co/auth/v1/callback`, and Google accepted the request
  without a redirect-URI or blocked-application error.
- Email/password signup is enabled, confirmation is required, unverified password sign-in is
  disabled, and recovery tokens expire after 3,600 seconds.
- Test uses Supabase's built-in SMTP sender (`Supabase Auth <noreply@mail.app.supabase.io>`), not
  custom SMTP. The built-in sender delivered a real recovery email successfully. Its Test quota
  is two messages per hour.

### Observed hosted journeys

| Journey | Result | Actual observation |
|---|---|---|
| Returning Google login | Pass | A real cached Google grant completed the Test OAuth round-trip and returned to the full requested customer path and query. |
| Google signup with a brand-new identity | Not exercised | No disposable Google identity was available; the existing Test Google account was not mutated. |
| Google-only account attempts password login | Not exercised as Google | A disposable passwordless Test user received the expected `invalid_credentials` result; the hosted UI showed non-enumerating copy plus immediate Google and password-link actions. |
| Add password to passwordless account | Pass | Authenticated password creation retained the same Supabase user and the same single identity record; password login then succeeded for that user. This proves the credential-add path, but the disposable identity provider was email rather than Google. |
| Email/password signup and confirmation | Pass with delivery limitation | A disposable unconfirmed Test user was confirmed through the real hosted token-hash callback; the callback set a valid session and preserved the full destination. Confirmation-email delivery itself was not exercised. |
| Returning password login and logout | Pass | Hosted login reached the requested nested route directly, repeated login returned the same user, and the deployed logout fix reached the signed-out login state. |
| Wrong password | Pass | Test Auth returned `invalid_credentials`; the hosted UI displayed plain-English non-enumerating guidance with Google and password-link recovery actions. |
| Password recovery | Pass with post-fix delivery limitation | A disposable recovery token opened the hosted reset route, changed the password on the same user, invalidated the old password, and accepted the new password. A real email delivered, but exposed the legacy fragment-link defect described below; the corrected template could not be redelivered in the same pass because the built-in hourly quota was exhausted. |
| Reused, malformed, or invalid link | Pass | Hosted callbacks returned plain-English expired/invalid guidance and a direct route to request another link; no raw Supabase error was shown. |
| Magic link | Pass with delivery limitation | A Test magic-link token created a hosted session for the same user and restored the full destination. Mail delivery was not separately exercised. |
| Password account uses Google with the same email | Not exercised | This requires a disposable Google identity whose verified email matches a disposable password user. |
| Protected route/session expiry | Pass | Both missing and invalid sessions preserved `/customers?tenantId=e2e&view=overdue`; the invalid-session case explained that the session ended, with no redirect loop. |
| OAuth cancellation/failure | Pass with limitation | The hosted callback mapped `access_denied` to understandable recovery UI while preserving both sign-in methods. Interactive cancellation was unavailable because Google completed silently from its cached grant. |

### Actual identity state

- The real Test Google account has one `google` identity, a password credential, one Stripe
  customer row, and one subscription row. The real OAuth login left this as one Supabase user;
  no duplicate application/customer state was present.
- Adding a password to the disposable passwordless user returned the same user ID, subsequent
  password login returned that same ID, and the identity count stayed at one.
- The two disposable users created for this pass had no Stripe customer or subscription rows and
  were deleted after testing.
- Provider authority was read from `auth.identities` and `app_metadata`; no decision relied on
  user-editable `user_metadata`.

### Defects found and corrected

1. Logout from the dashboard cleared Auth state but competing client redirects could leave the
   dashboard shell at the old URL until refresh. `app/components/Nav.tsx` now uses a hard
   `window.location.replace` after successful Supabase sign-out. A contract regression test was
   added and the fixed `develop` Preview was retested successfully.
2. Test confirmation, recovery, and magic-link templates used Supabase `.ConfirmationURL`, which
   delivered legacy implicit tokens in a URL fragment. The server callback cannot read fragments,
   so a real recovery email ended at `auth_missing_params`. Test-only template configuration now
   uses `.RedirectTo`, `.TokenHash`, and the explicit `signup`, `recovery`, or `magiclink` type.
   The setting reads back correctly and its token-hash callback contract passed; a post-change
   delivered-email rerun remains outstanding because Test's two-email hourly quota was exhausted.

No Site URL, allow-list, Google credential, SMTP, Vercel environment, database schema, migration,
Production, or Stripe configuration was changed during this pass.
