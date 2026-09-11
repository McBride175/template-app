# Application Architecture

This document is the high-level source of truth for environments, deployment, database workflow, security boundaries, and external integrations. Read it before making architecture, database, authentication, or deployment changes.

## Environments

| Environment | Application | Supabase | External-service intent |
|---|---|---|---|
| Local | `http://localhost:3000` | Test project `rbmxegyiwntomhpbepnu` (`Template app test`) | Test/sandbox credentials where the provider supports them |
| Vercel Preview | `develop` branch and other unassigned branches; per-deployment URL | Test project `rbmxegyiwntomhpbepnu` | Stripe test/sandbox mode; other provider applications may intentionally be shared with Production |
| Vercel Production | `main` branch; `https://template-app-inky.vercel.app` | Production project `sswyxbugbdoadktyaows` (`McBride175's Project`) | Stripe live mode; reviewed Production credentials/configuration |

`develop` is the active pre-launch development branch. Its pushes create Vercel Preview deployments and do not automatically deploy to Production. Vercel's configured Production Branch is `main`.

The deployment currently serving the public Production alias was manually promoted/rebuilt from historical `test-stripe@ed5ae80`. That historical source does not change the automatic Production Branch, which remains `main`. During pre-launch, Production may intentionally lag significantly behind `develop`; promoting development code is a deliberate future release decision.

Use the same environment-variable names everywhere and scope their values in `.env.local` or Vercel. Never infer an environment from a secret prefix alone, and never commit an environment file.

## Deployment

- Local and Vercel Preview deliberately share the Test Supabase project.
- Vercel Production uses the separate Production Supabase project.
- `develop` is the sole authoritative active development branch. Its stable branch alias is `https://template-app-git-develop-james-mcbrides-projects.vercel.app`; individual Preview deployment URLs remain immutable.
- Pushes to `main` are eligible for automatic Production deployment. Pushes to unassigned branches, including `develop`, create Preview deployments instead.
- Preview URLs are dynamic. OAuth and email links must use the request origin or `NEXT_PUBLIC_SITE_URL` rather than a hard-coded Preview hostname.
- A deployment is not ready merely because the application build succeeds: its Supabase schema, Auth redirects, webhooks, OAuth callbacks, and environment-scoped credentials must also be ready.
- Database changes go to Test first. Production receives the same reviewed forward migration only after Test validation.

## Database workflow

The canonical schema starts at:

`supabase/migrations/20260813205201_baseline_current_schema.sql`

The pre-baseline SQL files are preserved under `supabase/migrations_legacy/`. They are historical evidence, not an executable migration chain.

Rules:

1. The canonical baseline is the source of truth for an empty application database.
2. Every later schema change gets a new 14-digit timestamped, forward-only migration in `supabase/migrations/`.
3. Never edit a migration after it has been applied to a shared environment.
4. Do not make manual hosted SQL changes without representing the same change in Git.
5. Validate a clean local replay, then Test, before a reviewed Production rollout.
6. Do not run `db push`, migration repair, or hosted SQL without explicit authorization and an exact project-ref preflight.

At baseline creation time, neither hosted project has a reconciled migration ledger. Test already contains most schema objects from manual SQL; Production has no public application schema. A later controlled reconciliation must align Test and record the baseline appropriately, while Production should receive the verified baseline normally. Do not blindly replay the archived migrations or the baseline over Test's existing objects.

## Database model

### Core and billing

- `subscriptions` caches Stripe subscription state, keyed by `user_id`. Stripe customer and subscription IDs are unique. `current_period_end` is nullable for valid transient states.
- `stripe_customers` maps Stripe customer IDs to Supabase users for server-side webhook resolution.
- `notes` provides authenticated user-owned CRUD.
- `billing_usage_days` records at most one free-use day per authenticated user and UTC calendar date. Tenant history is also retained so changing accounts cannot reset an already exhausted Xero organisation. The service-role-only `claim_billing_usage_day` function serializes each user/tenant claim and atomically enforces the five-day limit.

Stripe remains authoritative for subscription state; the Supabase subscription row is a cache used for UI and entitlement checks. Only `active` and `trialing` rows for a configured Basic or Pro price with a future `current_period_end` grant paid access.

### Support and privacy

- `support_tickets` stores support submissions. The contact route inserts through the service role, including for signed-out users.
- Email-delivery metadata is intentionally not persisted. `sent_at`, `resend_message_id`, and `email_error` were unused optional scaffolding and are not part of the canonical schema.
- `user_privacy_preferences`, `privacy_requests`, `privacy_request_events`, and `privacy_exports` support GDPR/UK GDPR workflows.
- Privacy routes authenticate and authorize the caller in application code, then use the service-role client for database operations.

### Xero and collections

The final Xero design contains only:

- `xero_oauth_grants`: encrypted grant-scoped tokens and refresh locks
- `xero_connections_public`: per-user/per-tenant public connection metadata, grant linkage, auth state, and tenant auto-sync locks
- `xero_raw`: user/tenant-scoped raw API snapshots
- `canonical_organisations`: explicit Xero organisation identity, base currency, country, timezone, and source retrieval metadata
- `canonical_customers`, `canonical_invoices`, and `canonical_payments`: normalized accounting data
- `customer_overrides`: user-controlled collection priority overrides
- `xero_scheduled_sync_runs`: internal scheduler lock and cadence state
- `collection_actions`: user-owned action history

The legacy `xero_connections`, transient `xero_connection_secrets`, tenant-scoped refresh-lock RPCs, and orphaned `set_updated_at_xero_connections()` function are not part of the final architecture.

Xero token, auto-sync, and scheduler RPCs are `SECURITY DEFINER`, have a fixed `pg_catalog, public` search path, and are executable only by `service_role`. The scheduled candidate RPC is the final stale-aware three-argument version.

### Currency data contract

Transaction/native currency, organisation base currency, and SaaS subscription billing currency are separate concepts. Xero invoice amounts remain available in their transaction currency, while derived base-currency amounts use the connected organisation's explicit ISO currency code.

Sync retrieves both Xero `Organisation` metadata and `Organisation/Actions`; the latter records `UseMulticurrency` for diagnostics but never gates currency-safe processing. Xero `CurrencyRate` is transaction-currency units per one organisation base-currency unit, so a foreign invoice is converted with `base = native / CurrencyRate`. If transaction and base currency match, conversion is identity and no rate is required or invented. A foreign invoice with a missing, zero, negative, or otherwise unusable rate retains its native data but has null base amounts and an explicit incomplete conversion reason. A foreign rate of exactly one is valid and is not rejected merely for being unusual.

Canonical conversion preserves native decimal precision and rounds foreign-derived base amounts to eight decimal places using half-away-from-zero rounding. Conversion is deterministic from the raw invoice plus canonical organisation metadata and does not use an external or current-market FX provider. It does not attempt to recreate Xero's realised or unrealised gain/loss accounting.

Base-currency conversion is an accounting/scoring correctness layer and is not a premium entitlement. Premium multi-currency product functionality, if introduced, must remain separate from the correctness of canonical data, aggregation, and scoring.

All cross-invoice and cross-customer monetary collections prioritisation operates in the authoritative Xero organisation base currency. Native invoice currency remains source/accounting context and must never be directly aggregated with another currency. Customer outstanding and overdue totals sum canonical base amounts, and balance-weighted overdue age uses `amount_due_base` as its weight. Exact PostgreSQL numeric strings are summed before one controlled conversion to JavaScript numbers at the dimensionless scoring boundary.

The collections currency-health gate evaluates open, positive `ACCREC` obligations before aggregation. If an otherwise eligible receivable has incomplete or inconsistent conversion data, or the organisation base currency is unavailable, the APIs return an explicit incomplete health state and no normal ranking or portfolio totals. The invoice is never omitted, treated as zero, interpreted in native units, or assigned a guessed rate. Paid historical invoices do not block the queue when only their dates are used for historical lateness.

## Database access model

RLS is enabled on every application table. Grants are explicit rather than relying on Supabase's broad default privileges.

| Access | Tables |
|---|---|
| Authenticated user SELECT | `subscriptions`, `xero_connections_public` |
| Authenticated user CRUD | `notes` |
| Service role only | `stripe_customers`, `support_tickets`, all privacy tables, `xero_oauth_grants`, `xero_scheduled_sync_runs`, `billing_usage_days`, `xero_raw`, canonical Xero tables, `customer_overrides`, `collection_actions` |
| Anonymous browser | No direct application-table access |

User-accessible tables have `auth.uid() = user_id` policies. Server-only tables have RLS enabled, no browser policies, and explicit revocation from `anon` and `authenticated`. Service-role credentials are server-only and bypass RLS. Billable server routes authenticate the user, atomically claim/check the current UTC usage date, and only then query service-role-only product data with explicit `user_id` and `tenant_id` filters.

## Authentication and Google OAuth

Supabase Auth is the identity system of record. Browser/server session clients use the public Supabase URL and anon key; the Next.js proxy refreshes cookie-based sessions.

Google sign-in flow:

1. The login page calls `supabase.auth.signInWithOAuth({ provider: 'google' })`.
2. Google returns through Supabase Auth.
3. The application callback `/auth/callback` exchanges the authorization code for a session.
4. The user is redirected to the application.

Application code controls the application callback and post-login redirect. Supabase controls provider enablement, Site URL, and allowed redirects. Google Cloud controls the OAuth client and Supabase callback URIs.

Preview and Production may use the same Google OAuth client if every required Supabase callback URI and origin is configured. Because Test and Production are separate Supabase projects, both project callback URLs must be accounted for even when the Google client is shared.

## Stripe

Stripe is authoritative for customers and subscriptions.

- Checkout is created by authenticated server routes.
- Stripe webhook signatures are verified before processing.
- Webhook handlers use service-role writes and idempotent cache application because events can arrive more than once or out of order. Cache replacement compares Stripe subscription creation times so events for an older subscription cannot replace a newer subscription row.
- `checkout.session.completed` retrieves the signed session's subscription from Stripe and caches its actual status, price, and item period end. Visiting the checkout return URL does not grant access.
- Preview uses Stripe test mode and a Preview webhook secret. Production uses live mode and its own Production webhook secret and Price IDs.
- Checkout success/cancel URLs are derived from the request origin.

## Xero

Xero OAuth uses `XERO_CLIENT_ID`, `XERO_CLIENT_SECRET`, `XERO_REDIRECT_URI`, and `XERO_TOKEN_ENCRYPTION_KEY`. The callback route is `/api/xero/callback`. Tokens are encrypted before storage in `xero_oauth_grants`; plaintext token tables are not permitted.

The code supports one Xero configuration per deployment environment. Preview and Production may intentionally share one Xero developer application if that application's redirect configuration supports both environments. Separate applications are not assumed or required by the code.

Manual and scheduled synchronization use service-role database access. Internal sync endpoints require an internal/cron secret, and scheduled sync is disabled unless explicitly enabled.

## Resend

The contact route always attempts to persist a support ticket first, then sends a notification through Resend when the inbox and API key are configured. Email failure does not discard the ticket.

Preview and Production may intentionally share a Resend account and verified sending domain. The sender in `SUPPORT_FROM_EMAIL` must be permitted by that account. No database email-delivery metadata is maintained.

## Vercel

Vercel provides Preview and Production deployment scoping and supplies `VERCEL_ENV`, `VERCEL_URL`, and `VERCEL_GIT_COMMIT_SHA`. The application uses `VERCEL_URL` as a fallback origin and `VERCEL_ENV` for environment-sensitive behavior.

Environment values—not variable names—must differ where required. In particular, Production must use the Production Supabase project and Stripe live configuration, while Preview uses Test Supabase and Stripe test configuration.

## Environment variables

`.env.example` is the complete variable-name inventory. It contains no values. Broad groups are:

- Application URL and Vercel-provided runtime metadata
- Supabase public/session and server-only service credentials
- Stripe keys, Price IDs, and webhook secret
- Resend/support sender and inbox
- Xero OAuth, token encryption, internal access, and sync tuning
- Retention/scheduling secrets
- Privacy administration, export signing, and policy metadata

Google OAuth has no direct Google secret in application code; provider credentials live in Supabase and Google Cloud dashboards.

## Important failure modes

- A missing or stale database schema must fail validation rather than be hidden by legacy-table fallbacks.
- Unpaid billing usage writes/counts fail closed so a database error cannot silently grant unlimited free access. A valid cached paid-through entitlement does not depend on reading the free-usage ledger, avoiding an unnecessary paying-user lockout during a partial ledger failure.
- Protected collection and Xero data is not directly readable or writable by browser Data API roles; otherwise a valid session token could bypass Next.js route enforcement.
- Stripe events are unordered and duplicated; webhook handlers must remain idempotent.
- Xero refresh and sync operations are concurrent; grant, tenant, and scheduler locks must remain service-only.
- Dynamic Preview URLs require explicit OAuth/dashboard planning.
- `supabase/.temp/` is local generated metadata and must never be committed because it can silently restore a hosted project link.
