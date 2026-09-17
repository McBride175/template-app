# Auth email operations

Supabase Auth owns signup confirmation, password recovery, magic-link, invitation, and email
change delivery. The application supplies redirect URLs and, when configured, a Cloudflare
Turnstile token. It does not send or queue these messages itself.

## Hosted testing policy

- `pnpm test` and the other normal automated checks must stay local/mocked and email-neutral.
- A real hosted Auth email is an exceptional, quota-consuming Test operation. Never use
  Production Supabase for routine Auth email E2E or template verification.
- The permanent diagnostic is `scripts/auth-email-e2e.mjs`. Starting it without arguments only
  prints help. A send requires an explicit `signup`, `recovery`, or `magic-link` operation, the
  `--allow-auth-email-send` flag, a deliberately selected recipient, and the exact Test project.
- Before a real send, coordinate with any other Auth verification, budget the expected message,
  and record the operation and timestamp. Test's built-in sender currently permits only two
  project-wide messages per hour.
- Prefer the deployed UI when verifying CAPTCHA behavior. The script accepts a fresh
  `AUTH_EMAIL_E2E_CAPTCHA_TOKEN` only for exceptional direct-API diagnostics after CAPTCHA is
  enabled; Turnstile tokens are short-lived and single-use.

Example shape (values stay in the shell or `.env.local`, never Git):

```sh
node --env-file=.env.local scripts/auth-email-e2e.mjs recovery --allow-auth-email-send
```

Set `AUTH_EMAIL_E2E_TARGET_EMAIL`, `AUTH_EMAIL_E2E_REDIRECT_ORIGIN`, and, for signup only,
`AUTH_EMAIL_E2E_SIGNUP_PASSWORD`. The harness accepts only Test project
`rbmxegyiwntomhpbepnu` and either localhost or the stable `develop` Preview origin.

## Custom SMTP status and branding dependency

As of 2026-09-14, the authenticated Resend workspace has no verified domains. Its only API key is
the existing `Onboarding` sending-only key used by the Contact Us integration; it is not dedicated
to Auth and must not be reused for Supabase SMTP. The current support sender is
`onboarding@resend.dev`. There is no domain-level SPF, DKIM, DMARC, or click-tracking configuration
to review because no domain has been added to the workspace.

The final product brand and domain have not been selected. Test custom SMTP is therefore
deliberately deferred rather than creating a temporary domain, throwaway DNS records, or an Auth
credential that would soon need replacement. Test Supabase project `rbmxegyiwntomhpbepnu`
continues to use the built-in sender and its two-email-per-hour project limit. Custom SMTP, a
dedicated credential, and the three real-email delivery checks remain inactive.

After the final brand and domain are selected:

1. Add the legitimately controlled Auth sending domain to Resend and verify its generated SPF and
   DKIM records plus an appropriate DMARC policy.
2. Disable click tracking for the Auth sending domain so authentication links are not rewritten.
3. Create a sending-only, domain-restricted Resend key named `Supabase Auth - Test` and transfer it
   directly into Test Supabase's SMTP password field. Do not store it in this repository, Vercel,
   a client variable, or chat.
4. Configure only Test Supabase with `smtp.resend.com`, port `465`, username `resend`, the branded
   sender, and a non-production sender label. Leave the initial custom-SMTP limit at 30 emails per
   hour unless reviewed Test traffic requires otherwise.
5. Send exactly one signup confirmation, one password recovery message, and one magic link through
   the stable `develop` Preview. Confirm Supabase acceptance, Resend delivery, sender identity,
   redirect target, and successful link completion for each flow.
6. Treat Production SMTP, its separate Resend credential, and its delivery verification as a later
   controlled rollout.

### Future domain migration sweep

When the brand/domain decision is complete, review these domain-dependent surfaces together rather
than changing them piecemeal:

- Resend verified sender/domain, Auth subdomain, DNS authentication, click tracking, and the
  Contact Us sender;
- Test and Production Supabase Auth senders, Site URLs, redirect allow-lists, email templates, and
  any Supabase custom-domain decision;
- the Production Turnstile widget and hostname allow-list;
- Google/OAuth callback, authorized-origin, consent-screen, and customer-facing domain settings;
- the Vercel custom domain and environment-scoped application URLs;
- canonical URLs, SEO and social metadata, Open Graph assets, sitemap, and robots configuration;
- legal, privacy, terms, support/contact addresses, and domain-specific cookie/consent settings;
- hard-coded Preview or legacy product naming in application copy, configuration, operational
  documents, and external dashboards;
- Sentry environment, release, allowed-origin, and domain assumptions; and
- Stripe customer-facing branding, support details, return URLs, and portal/receipt settings.

## CAPTCHA ownership and rollout

| Control | Owner/location |
|---|---|
| Turnstile widget and token forwarding | Repository (`TurnstileCaptcha` and Auth helpers) |
| Public Turnstile site key | `NEXT_PUBLIC_TURNSTILE_SITE_KEY` in the deployment environment |
| Turnstile secret key | Supabase Auth dashboard only; never an application environment variable |
| CAPTCHA enforcement | Supabase Auth > Authentication > Bot and Abuse Protection |
| Widget hostname allow-list | Cloudflare Turnstile |

The widget obtains a short-lived, single-use token. The application passes that token through
Supabase JS as `options.captchaToken`; Supabase Auth validates it server-side with the configured
Turnstile secret. A visual-only CAPTCHA is not sufficient.

The dedicated Test configuration is:

- widget name: `template-app-test-auth`;
- Cloudflare widget mode: Managed;
- application appearance: `interaction-only` (the challenge is hidden unless Cloudflare requires
  interaction);
- permitted hostname: `template-app-git-develop-james-mcbrides-projects.vercel.app` only;
- public site key: Vercel Preview's `NEXT_PUBLIC_TURNSTILE_SITE_KEY` only;
- private secret: Test Supabase project `rbmxegyiwntomhpbepnu` under Authentication > Bot and
  Abuse Protection only.

Do not add localhost to the real Test widget. For component tests, mocks, or an isolated local
Supabase Auth stack, use Cloudflare's official Turnstile testing site key and its matching testing
secret. A dummy token cannot be validated by hosted Test Supabase once that project holds the real
Test widget secret, so use the stable Preview for full browser-to-hosted-Test verification. With no
site key, the component is intentionally absent; this is suitable only where the corresponding
Supabase Auth environment does not enforce CAPTCHA.

Roll out one environment at a time: create the Turnstile widget and allow its hostname, set the
matching public site key on the deployment, deploy the CAPTCHA-capable code, then enable
Turnstile with the matching secret in that environment's Supabase project. Validate Test before
any separately reviewed Production work.

Protected email/password signup, email/password login, password recovery, magic-link sign-in,
and the signed-in emailed recovery fallback pass a token. Google OAuth and authenticated direct
password updates do not use CAPTCHA.

To rotate the Test secret, generate a replacement in Cloudflare without immediately invalidating
the current secret, update only Test Supabase with the replacement, verify an email-neutral login
through the stable Preview, and then invalidate the old secret in Cloudflare. Never copy either
secret into Git, Vercel, a `NEXT_PUBLIC_*` variable, or logs.

Production requires a separately reviewed widget, hostname allow-list, public site key, and
Supabase secret. Never reuse the Test widget or its credentials for Production.

## Production custom SMTP checklist

No application code or application secret is required to switch Supabase Auth from its built-in
sender to standard custom SMTP. Keep Auth email transport credentials out of this repository.

| Setting/control | Supabase | SMTP provider / DNS | Repository |
|---|:---:|:---:|:---:|
| SMTP host, port, username, password/API credential | Configure | Issue and document limits | None |
| Sender email and sender display name | Configure | Authorize sender/domain | Email copy may reference the product name |
| Sending-domain ownership | Reference verified domain | Verify | Document only |
| SPF and DKIM | None | Publish provider records in DNS | None |
| DMARC policy and reporting | None | Publish/monitor in DNS | None |
| Supabase Auth email rate limit | Set after capacity review | None | Handle stable rate-limit errors |
| Provider throughput/daily limits | Keep Supabase below them | Select/raise/monitor | None |
| Bounce and complaint handling | Review Auth logs | Configure provider alerts/suppression | None unless a future integration is justified |
| Delivery verification | Review Auth logs | Review delivery events/inbox placement | Run minimal Test E2E only |

Before Production launch: choose the transactional provider, authenticate a dedicated Auth
sending subdomain, configure and verify SPF/DKIM/DMARC, enter SMTP credentials and sender details
in Production Supabase, set Supabase's Auth email limit within provider capacity, and test signup,
recovery, magic link, bounce handling, complaints, and monitoring. Keep Auth traffic separate
from marketing traffic. The provider's own limits remain independent of Supabase's configured
Auth email rate limit.

## Operational signals

Client Auth failures are classified without logging email addresses or provider error messages:

- `over_email_send_rate_limit` -> `auth_email_rate_limited`
- `over_request_rate_limit` -> `auth_request_rate_limited`
- `captcha_failed` -> `captcha_failed`
- built-in-sender authorization failure -> `auth_email_delivery_failed`
- a 5xx response during signup or an email-link action -> `auth_service_failed`

These structured warnings are sent to the browser console and the existing Sentry integration
using only the action, category, stable Auth error code, and HTTP status—never the submitted email
or Supabase/provider error text. Supabase Auth logs and the eventual SMTP provider remain the
delivery source of truth; do not build a parallel bespoke monitoring pipeline without evidence
that one is needed.
