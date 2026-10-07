# Durable accounting refresh foundation — Phase 7.1

Starting revision: `66ba59c956b96a5dfa25e13825fa597d43b38add`, clean `develop`, matching `origin/develop`. Accepted Phase 6 baseline: 1,798 passed, 254 skipped. Test project: `rbmxegyiwntomhpbepnu`; the current Preview uses `arn1`.

This unit is dormant. No normal page, API, Xero route, OAuth callback, disconnect route or collection reader imports the new control plane. There is no scheduler, worker endpoint, HTTP delivery, provider call, usage claim, generation writer or derivative ensure operation. Xero is the only installed connection facade. Other provider identifiers are accepted in the provider-neutral domain/storage, but no second connector is implemented.

## Authority and identity

Logical identity is `(owner, provider, provider organisation)`. External organisation IDs are opaque strings, not globally unique IDs or UUID requirements. `accounting_refresh_connections` assigns an internal UUID and retains a provider-specific opaque connection/authority binding. Its epoch is decimal bigint text at the TypeScript/JSON boundary.

The Xero bridge resolves an exact owned `xero_connections_public` row and grant scope metadata. It registers the tenant/grant identity without loading tokens or calling Xero. Existing `xero_sync_tenant_state`/succeeded runs remain the sole accounting authority. The bridge reads `snapshot_as_of` separately from publication time and uses the existing validated portfolio calculation reader for derivative identity; it never builds a calculation. Legacy/null-G mode is not labelled a successful immutable generation.

Connection health is derived, not copied into the new tables. `invalidated_at` is an explicit control-authority suspension, not a token-health cache. A changed observed binding rotates the epoch and cancels old work. Explicit disconnect/organisation change suspends acceptance; explicit verified reconnect/credential relink rotates and resumes authority. Same organisation keeps the internal connection scope. Different organisations/providers get separate scopes; no history transfer exists.

**Phase boundary:** existing OAuth/disconnect mutations do not yet invoke the epoch API. Phase 7.3 must integrate epoch changes with credential mutations and check the captured attempt/epoch inside atomic publication. The private `lock_attempt` contract is available to that future transactional wrapper. Current Xero generation fencing remains intact and independent. A heartbeat/control update cannot publish accounting.

## State machine

Nonterminal: `queued`, `running`, `preparing`, `retry_wait`, `reconnect_required`, `attention_required`.
Terminal: `complete`, `cancelled`.

A partial unique index enforces one nonterminal job per logical identity, including paused work. Connection-row locking serializes acceptance, reservation, claim, epoch change and attempt updates. Job rows lock after connection rows; recovery uses the same ordering with `SKIP LOCKED`. The job identity/epoch/start timestamps and terminal state are immutable. `work_stage` moves only from accounting to derivatives.

`complete` acknowledges control work. It does not prove accounting publication or certified derivatives. Status always reads those authorities independently. A no-op job may complete without a new generation. Xero generation association checks exact ownership; preparation requires a succeeded run. Associated succeeded Xero runs automatically make failure/recovery continue with derivatives rather than refetching provider data. A failed/abandoned candidate can be replaced during a later attempt; succeeded candidates cannot be replaced as though they failed.

## Acceptance, priority and keys

`accept_accounting_refresh` locks the exact connection and checks owner/provider/organisation/epoch. It joins an existing nonterminal job or creates one. The earliest requested due time may advance queued work, but never shortens retry/provider cooldown. No acceptance restarts blocked work.

Priority: onboarding 60, manual 50, reconnect 40, internal 30, opportunistic 20, scheduled 10. Highest priority and latest trigger are separate metadata. Accepted duplicate signals increment request count; idempotent replay does not. Triggers never confer generation/publication authority.

Optional caller keys are bounded opaque strings, SHA-256 hashed in `accounting_refresh_request_keys`, and scoped by owner/provider/organisation. The same key returns the same job even after completion/cancellation or reconnect. A new user intent needs a new key. Keys are not global job IDs. New keys on active work attach to that existing job.

## Dispatch/attempt primitives

- `list_accounting_refresh_work`: eligible queued/retry jobs only; bounded limit 200; waiting over 30 minutes gets a starvation escape, then priority/due/age/id order.
- `reserve_accounting_refresh_delivery`: 60-second default reservation (15–300 allowed), generated delivery nonce; same-reserver replay does not extend it.
- `release_accounting_refresh_delivery`: exact scope/nonce/reserver release; no delivery happens here.
- `claim_accounting_refresh_attempt`: consumes a live eligible reservation, captures epoch and creates a new attempt UUID/number and worker lease (300 seconds default, 60–900 allowed).
- `heartbeat_accounting_refresh_attempt`: checks full scope, epoch, attempt number/UUID, worker and unexpired lease before renewal.
- `update_accounting_refresh_attempt`: fenced bind/preparing/complete/fail/requeue; no generation or derivative writes.
- `recover_accounting_refresh_work`: bounded stale reservation/attempt recovery, no external calls. It never changes Xero run state. The execution phase must still inspect/recover an associated candidate through the existing generation lifecycle.
- `cancel_accounting_refresh` and `advance_accounting_refresh_epoch`: cancel control authority without deleting accounting, operational or usage history.

An uncertain claim can be retried with the same delivery nonce/worker identity; it returns the existing attempt. An uncertain failed/completed update is inspected through status rather than replaying a new attempt. Stale updates reject instead of incrementing retries twice.

## Retry/scheduling policy

Stored metadata includes failure class/code/time, retry count/source, provider lower bound and next eligible time. Codes are bounded lowercase identifiers, never raw provider/SQL error text. Provider/connection cooldown persists across terminal jobs and is not shortened by higher priority. Completion establishes five-minute refresh spacing.

The pure retry proposal uses candidate delays 5/15/60 minutes with ±10% jitter, followed by six-hour probes. Reconnect pauses; deterministic and unknown failures require attention. Quota without a trustworthy reset uses a conservative six-hour probe. Provider-directed delay overrides any shorter local proposal. Preparation uses 1/5/15/60 minutes, then attention. No runtime retry loop is enabled.

Meaningful activity is Dashboard, queue, customer or collection action. Polling, background maintenance, scheduler activity, OAuth/provider callbacks, login and health checks are excluded. No reliable existing product-activity timestamp was found; the new nullable timestamp is not yet instrumented. Scheduling metadata supports hourly activity within seven days, daily inactivity, and configurable/deferred dormant maintenance. No scheduling job is created.

Freshness uses the active generation observation timestamp: fresh below 2h; aging at 2h up to below 6h; materially stale from 6h through exactly 24h; very stale strictly over 24h through exactly 7d; extended stale strictly over 7d. Invalid/missing authority, observation or future timestamps are unusable; elapsed age alone is never unusable. No UI consumes this helper yet.

## Security and free usage

All three tables have RLS and no browser policies/grants. Service role has SELECT only; mutations use thirteen explicitly granted RPCs with `search_path=pg_catalog`. Private helpers have no service/browser execute or schema usage grants. Composite FKs prevent cross-owner/provider/organisation request-key/job attachment.

The authenticated service obtains `getUser()` and accepts no caller owner ID. Requested organisation lookup is exact; no fallback to another organisation. The internal primitives require trusted server scope and opaque transport/worker IDs. Only the Xero facade currently resolves production connections; future registration must come from a trusted verified connector, not user metadata.

New acceptance/status do not read subscriptions, claim a free UTC day, reveal product accounting payloads or call provider APIs. Existing live refresh/billing behaviour is byte-identical in this unit.

## Retention and verification

Retain terminal jobs and their scoped idempotency mappings for 90 days. Later bounded service-only pruning can delete terminal jobs older than this window; keys cascade. Nonterminal jobs are never pruned as completed work, and operational/accounting history is never coupled to job retention. No cleanup scheduler or archival is added pre-launch. The terminal completion index and request-key job index support the future pruning contract.

Local certification uses disposable Docker databases and a complete canonical migration replay. Tests cover concurrent acceptance/key replay/reservation/claim; paused retry priority; owner/provider isolation; stale leases/epochs; no business writes; security and owner erasure. Pure/service tests use synthetic provider inputs without a fake installed connector and keep all existing product source byte-identical.

`tests/database/accounting-refresh-hosted-certification.sql` runs synthetic control flows in one rollback-only transaction, tests grants/actual browser denial and fingerprints 31 existing business tables before/after. The guarded `scripts/certify-accounting-refresh-test.mjs --execute` refuses any other project/application/pooler identity. It never creates a Xero connection or generation. No fixture state survives the transaction.

No environment-variable names are added or changed. Test certification uses existing `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_DB_PASSWORD`; credentials and `supabase/.temp` remain uncommitted.

## Local certification result

The finalized full suite with `RUN_SUPABASE_INTEGRATION=1` passed **2,150 tests**, with zero failures, skips or cancellations. The new unit/service files contain 49 tests; the new integration file contains 34 tests, including the rollback-only hosted certificate on clean replay. All 26 canonical migrations replayed in disposable Postgres databases. Lint, TypeScript, production build, SQL security check and `git diff --check` passed.

Five pre-existing billing/Xero integration files targeted the retired `supabase_db_yuohme` container and shared `postgres` database. Their assertions are unchanged; their harnesses now use the existing `supabase_db_template-app` container with per-file disposable replay databases. The first enabled run exposed only that infrastructure issue; the corrected full rerun is clean.
