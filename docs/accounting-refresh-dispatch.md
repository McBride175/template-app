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

`POST /api/internal/accounting/refresh-worker` has Node runtime and maxDuration 300. Per-delivery HMAC-SHA256 authentication uses the internal secret and constant-time comparison, bound to project/job/reservation. A project-ref header must match the configured Test Supabase hostname. Production rejects synthetic execution regardless of flags; the server-only `ACCOUNTING_REFRESH_SYNTHETIC_ENABLED=1` flag and explicit synthetic allowlist are also required.

The synthetic-only dispatcher refuses to send real/unmarked provider jobs. The worker never imports ingestion, mapper, accounting publication, reconciliation, scoring or derivative execution. Scenario metadata is disposable test specification/observability, not another queue. It simulates complete, delayed complete (maximum 40 seconds), one retryable failure, attention and deliberate loss of the worker lease. Real provider execution stays disconnected for Phase 7.3.

Each HTTP invocation chooses a new worker UUID and calls the existing claim RPC. Only `resultCode=claimed` starts execution; duplicate/already-held deliveries no-op. Lease remains 300 seconds. Heartbeats run every 30 seconds without overlap, reuse exact attempt/epoch identity and abort execution on authority loss. Result transitions use the existing fenced RPC. A 240-second substantive deadline and 270-second bookkeeping boundary prepare the later execution budget. Retry proposals use the existing Phase 7.1 pure policy.

## Configuration/security

Worker URL and internal secret are in Test Vault entries `accounting_refresh_worker_url` and `accounting_refresh_internal_secret`. Optional `accounting_refresh_preview_bypass` supplies Vercel's independent protection header. Exact immutable deployment URL is required; develop aliases are rejected. Preview protection is not disabled or otherwise changed. Production configuration is untouched.

Two new application variable names: `ACCOUNTING_REFRESH_INTERNAL_SECRET`, `ACCOUNTING_REFRESH_SYNTHETIC_ENABLED`; both are scoped to Preview/develop only. Credentials never enter Git, client code, status DTOs or structured logs. Supabase owns pg_net as supabase_admin and retains managed SQL grants that ordinary postgres cannot revoke. Net is not an exposed Data API schema. Static worker credentials are therefore kept out of its queue: transport stores only a per-delivery MAC, whose replay can join only the already accepted reservation. New refresh functions/spec/configuration remain service-only. Public transport RPCs have explicit service-only grants and fixed pg_catalog search paths. Private configuration/telemetry/spec tables have RLS and no browser access.

Cron activation is explicit, Test-only and idempotent via `set_accounting_refresh_cron(true)`, named `yuohme-accounting-dispatch-v1`, every minute. `set_accounting_refresh_cron(false)` disables dispatch and removes that named job. No Production Cron is created by migrations.

## Observability/cost

Structured `[accounting.refresh]` events cover dispatch source/submission, received/auth rejection, claim/duplicate, heartbeat, authority loss and outcome/duration. Private dispatch ticks record duration, capacity, eligibility and expiry recovery. They retain seven days with bounded indexed cleanup. No payload/header/credential/error-text logging occurs.

Idle ticks use bounded active-state indexes, read configuration, write one diagnostic tick and submit no HTTP. They do not load Vault credentials without eligible work. Detailed measured Test timing/plans and hosted outcomes are recorded after certification. Test Cron may remain enabled only with empty synthetic fixtures, no provider execution and proven idle zero-delivery behaviour.

The guarded Test operator `scripts/accounting-transport-test.mjs` uses existing Test credentials, private temporary state, exact Preview selection and disposable fixture identities. Business-table fingerprints protect accounting, operational, billing and calculation state. No Xero connection or generation is created.

## Certification evidence

Local full enabled run: **2,183 passed, zero failed/skipped**. Focused worker suite: 21 passed. Final transport DB suite: 14 passed, including two additional post-full-run checks for terminal observation idempotency and indexed idle access with 5,000 terminal rows. The canonical 27-file migration chain replays in disposable databases. Lint, TypeScript, production build, SQL security check and diff check pass. Compiled worker maxDuration is 300; the generated worker secret is absent from client assets.

Test migration 27 is `20261008074131_accounting_refresh_dispatch`; installed pg_cron 1.6.4 and pg_net 0.19.5. The installed http_post signature includes the explicit timeout parameter. Application worker configuration is Preview/develop only. No protection bypass was necessary because project Preview protection was already off; this phase did not change protection settings.

Hosted certification at the exact arn1 Preview for `e15ee7683d5c02e1e4da847722a79d772057a5f1` proved:

- Immediate acceptance/dispatch returned before a 35-second worker finished. A later independent process observed running state, one real heartbeat and one completion.
- Duplicate valid delivery returned 202 ALREADY_HANDLED with one attempt/claim. GET returned 405; missing/wrong secrets 401; nonexistent delivery 409.
- A separately accepted job without immediate signalling completed from the next Cron tick, without another worker completion acting as its trigger.
- Four synthetic disappeared workers held exactly four live attempts. A fifth request stayed queued and dispatch reported capacity_full/submitted zero.
- Controlled lease expiry recovered the same job; its second attempt completed. Three other connection-epoch changes cancelled old authority; old HTTP delivery returned 409 and SQL heartbeat/result updates rejected stale epochs.
- An intentionally reserved-but-unsent delivery suppressed submission while live. Controlled expiry produced a replacement nonce and one pg_net delivery; the old nonce became unavailable.
- Retryable failure persisted retry_wait/next eligibility, then completed on attempt 2 when test time was advanced. Deterministic failure persisted attention_required.
- Cleanup removed only the temporary certification owner's Auth/control/spec rows. All 31 accounting/operational/billing/calculation table fingerprints remained identical.

Idle measurements: cold dispatcher 23.634ms; warm/cleanup ticks 3.959–7.398ms. Occupied/eligible/recovered/submitted all zero, no new HTTP response and no worker execution. Initial active/eligible probes used indexes and returned zero rows; after fixture cleanup PostgreSQL chose one-page empty-table scans (zero rows examined). Local 5,000-terminal-row certification verifies indexed access without broad history scans. Each enabled idle tick performs bounded recovery/capacity/eligibility reads, reads one configuration row, inserts one diagnostic row and bounded retention cleanup; it does not read Vault values or submit HTTP. Network/client timing (about 3.4s for multiple remote probes) is separate from SQL duration.

Test Cron is `yuohme-accounting-dispatch-v1`, every minute, explicitly enabled, synthetic-only. No pending fixture or real provider execution remains. Production/main and existing Xero/product source are untouched. The final exact Preview URL is rebound in Test Vault after the documentation push, preserving the same secret; final idle and short-completion checks reconfirm that deployment.

## Hosted managed-extension adjustment

The final ACL audit found managed pg_net grants survive ordinary postgres REVOKE. Forward migration 28 documents the best-effort grant hardening; it cannot override supabase_admin ownership. Forward migration 29 changes delivery authentication to a project/job/reservation-bound HMAC, so the static secret is never written into the managed queue. Preview credentials were rotated after initial certification. The net extension has a nonrelocatable public-namespace advisory; all actual functions live under net. No unrelated platform-owner privileges or event triggers were modified. New transport RPCs remain service-only; the final signed deployment is re-certified and rebound explicitly.
