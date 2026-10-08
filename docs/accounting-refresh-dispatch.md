# Activity-driven dispatch — Phase 7.2

Starting revision `7bb0d279232ccbedcd625835ab0f689d1dd333c9`, clean develop/origin/develop, Test ledger 26, exact Preview `template-2m25kmz81-james-mcbrides-projects.vercel.app`, arn1. Accepted baseline: 2,150 passed.

## Corrected launch policy

Compute follows meaningful Yuohme usage, not the existence or age of an accounting connection. Launch intent comes from onboarding, reconnect, manual requests, meaningful product activity when due, or explicit internal recovery. There is no hourly/daily dormant-tenant maintenance. The scheduled trigger and Phase 7.1 schedule metadata remain dormant; no connection scan creates jobs. Future unattended email/reminder/digest/alert workflows can justify deliberate scheduled creation later.

Phase 7.4 owns activity/freshness decisions. Phase 7.2 supplies `signalAccountingRefresh`: acceptance commits through the existing RPC, then a best-effort short dispatch RPC is attempted. A failed/missed signal leaves the accepted job durable. Existing live Xero/manual/onboarding routes do not call it yet.

## Transport and capacity

One-minute Supabase Cron calls `dispatch_accounting_refresh('cron')`. The dispatcher only recovers existing reservations/attempts and dispatches existing eligible jobs. No provider work or network wait occurs in the transaction. A transaction advisory lock serializes every immediate/Cron/completion dispatch, counts live reservations plus attempts, then reserves at most four minus occupied slots. Existing Phase 7.1 eligibility, cooldown, priority and 30-minute starvation escape are preserved. Completion can fill newly free slots.

Delivery is one job UUID plus its generated reservation UUID. Owner/provider/organisation/epoch are loaded from the configured database, never trusted from HTTP. Reservation lasts 60 seconds. `pg_net.http_post` uses an explicit 310,000ms transport timeout: slightly beyond the 300-second Vercel route budget; transport diagnostics never own the job. Lost queues/responses are recovered from durable state, independent of unlogged pg_net tables.

Only the main `postgres` database installs pg_cron/pg_net; pg_cron's configured database restriction requires disposable schema replays to omit those extension installs. Local dispatch tests substitute a private HTTP recorder and perform no network delivery. Hosted certification verifies the real installed signature and transport. No migration activates Cron.

## Worker and synthetic guard

`POST /api/internal/accounting/refresh-worker` has Node runtime and maxDuration 300. Internal bearer authentication uses constant-time comparison. A project-ref header must match the configured Test Supabase hostname. Production rejects synthetic execution regardless of flags; the server-only `ACCOUNTING_REFRESH_SYNTHETIC_ENABLED=1` flag and explicit synthetic allowlist are also required.

The synthetic-only dispatcher refuses to send real/unmarked provider jobs. The worker never imports ingestion, mapper, accounting publication, reconciliation, scoring or derivative execution. Scenario metadata is disposable test specification/observability, not another queue. It simulates complete, delayed complete (maximum 40 seconds), one retryable failure, attention and deliberate loss of the worker lease. Real provider execution stays disconnected for Phase 7.3.

Each HTTP invocation chooses a new worker UUID and calls the existing claim RPC. Only `resultCode=claimed` starts execution; duplicate/already-held deliveries no-op. Lease remains 300 seconds. Heartbeats run every 30 seconds without overlap, reuse exact attempt/epoch identity and abort execution on authority loss. Result transitions use the existing fenced RPC. A 240-second substantive deadline and 270-second bookkeeping boundary prepare the later execution budget. Retry proposals use the existing Phase 7.1 pure policy.

## Configuration/security

Worker URL and internal secret are in Test Vault entries `accounting_refresh_worker_url` and `accounting_refresh_internal_secret`. Optional `accounting_refresh_preview_bypass` supplies Vercel's independent protection header. Exact immutable deployment URL is required; develop aliases are rejected. Preview protection is not disabled or otherwise changed. Production configuration is untouched.

Two new application variable names: `ACCOUNTING_REFRESH_INTERNAL_SECRET`, `ACCOUNTING_REFRESH_SYNTHETIC_ENABLED`; both are scoped to Preview/develop only. Credentials never enter Git, client code, status DTOs or structured logs. pg_net's administrative diagnostic tables/functions are inaccessible to browser/service roles; only the privileged dispatcher submits HTTP. Public transport RPCs have explicit service-only grants and fixed pg_catalog search paths. Private configuration/telemetry/spec tables have RLS and no browser access.

Cron activation is explicit, Test-only and idempotent via `set_accounting_refresh_cron(true)`, named `yuohme-accounting-dispatch-v1`, every minute. `set_accounting_refresh_cron(false)` disables dispatch and removes that named job. No Production Cron is created by migrations.

## Observability/cost

Structured `[accounting.refresh]` events cover dispatch source/submission, received/auth rejection, claim/duplicate, heartbeat, authority loss and outcome/duration. Private dispatch ticks record duration, capacity, eligibility and expiry recovery. They retain seven days with bounded indexed cleanup. No payload/header/credential/error-text logging occurs.

Idle ticks use bounded active-state indexes, read configuration, write one diagnostic tick and submit no HTTP. They do not load Vault credentials without eligible work. Detailed measured Test timing/plans and hosted outcomes are recorded after certification. Test Cron may remain enabled only with empty synthetic fixtures, no provider execution and proven idle zero-delivery behaviour.

The guarded Test operator `scripts/accounting-transport-test.mjs` uses existing Test credentials, private temporary state, exact Preview selection and disposable fixture identities. Business-table fingerprints protect accounting, operational, billing and calculation state. No Xero connection or generation is created.
