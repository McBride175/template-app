# Durable Xero execution (Phase 7.3)

> Historical phase record. This document preserves Phase 7.3 execution and
> authority certification. Its parked-preparation boundary was completed in
> Phase 7.4; current lifecycle semantics live in `accounting-product-cutover.md`.

Compute follows actual Yuohme usage. Cron dispatches/retries/recovers existing
intent; it never creates intent from the age/existence of a connection. At this
phase boundary, product triggers, public refresh routes, billing and UX cutover
remained for Phase 7.5.

## Inspected starting pipeline

The auto/manual/internal compatibility routes acquire the 180-second tenant
admission lock and call `syncXeroAuthoritatively`. The importer acquires a
300-second fenced generation, obtains encrypted grant credentials through the
existing rotation/CAS lock, retrieves organisation and four bounded streams,
performs catch-up and independent evidence sweeps, persists fenced raw and
canonical batches, and certifies `collections_readiness_v2`, FX and customer
credit stability. Its historical 60-second heartbeat ended when it returned.
The domain then renewed once, inspected readiness, and invoked the shared
bounded Promise proposal/recomputation and atomic publication transaction.

The admission lock limits compatibility-request admission; it is not accounting
publication authority. A longer import remains independently fenced after that
lock expires. The durable worker does not take it or change auto-trigger timing.
Both paths still acquire through the same generation single-flight engine. A
worker observes an existing compatibility run rather than retrieving in parallel.

## Three authorities

1. The refresh attempt retains its UUID, worker UUID, number and 300-second lease.
2. The owned provider connection retains its distinct epoch and grant linkage.
3. The generation retains a separately generated lease-owner UUID, fencing token,
   generation identity, readiness and existing Promise locks.

`acquire_accounting_xero_run` atomically checks the first two, acquires through
the existing engine and records an exact run association. An observed external
run is linked for recovery without taking ownership of its publication.

All new generation acquisitions capture connection epoch/grant authorization
revision. The service-only publication wrapper locks source connection, control
connection/job, then enters the unchanged generation/Promise engine. It checks
the captured epoch/grant and, for a worker-owned run, the exact attempt and
generation-owner/fence. It rechecks the attempt before committing the handoff.
No application pre-check is the final fence. No engine can be called directly by
browser/service roles to bypass this wrapper.

Disconnect/authentication invalidation and grant-link changes advance the epoch
and cancel old jobs transactionally. OAuth callbacks explicitly change a grant
authorization revision; ordinary refresh-token rotation does not. Token CAS and definitive auth-failure
recording also check the captured authorization revision, preserving the existing
grant lock while preventing old refreshes from overwriting/invalidating a relink. The callback
now disconnects removed organisations only within the affected grant. Same
verified organisation retains scope and all accounting/operational/usage history.

## Execution and recovery

Signed opaque delivery → authoritative mode/job load → attempt claim → connector
resolution → exact-run inspection → generation acquisition/binding → existing
import/map/evidence/readiness → shared Promise reconciliation → atomic promotion
and parked `preparing` handoff. No provider data flows back into orchestration.

One sequential 30-second controller renews attempt/epoch and then generation.
Both must renew; either loss aborts outstanding provider work. The importer uses
this external controller and keeps the compatibility controller as its default.
Heartbeat remains active through Promise preparation. A promotion that commits
just before heartbeat refusal is resolved from the exact succeeded run.

One absolute deadline, measured from worker receipt, bounds provider/import work
at 240 seconds. OAuth has an explicit 30-second ceiling (including body reading)
bounded by the remaining deadline and external cancellation. Existing provider
30-second calls, three attempts, jitter, Retry-After and concurrency four remain.
No major phase starts after the deadline; 270 seconds is the bookkeeping boundary
within the 300-second route maximum. Committing SQL is not interrupted by a
client abort. Token responses already received still complete the existing CAS
write to preserve rotation safety; uncertain responses retain existing recovery.

Request-level retries remain in the Xero client. Whole-candidate failures use
the accepted durable 5/15/60-minute jittered policy, then six-hour probes, with
provider lower bounds. Auth requires reconnect, invalid data/readiness is
deterministic attention, and unclassified/internal/publication failures require
attention rather than endless transient retries. Lost authority defers to epoch
cancellation/expiry recovery instead of overwriting state.

Publication and handoff are one transaction. A succeeded bound/observed exact run
can also repair an omitted handoff, including after attempt expiry. It cannot
start a second provider retrieval. A failed/abandoned candidate leaves the old
generation authoritative; replacement acquisition fences it through the existing
engine. Uncertain publication still uses the existing exact-run Promise recovery.

## Historical Phase 7.3 preparation boundary

`preparing` may be parked with no live worker lease. Its stage is derivatives;
G and captured publication F/P are retained in the run association. If an
observed compatibility run was already superseded before handoff, its F/P are
unavailable rather than pairing its old G with a newer financial epoch; later
preparation must resolve the current authoritative dependency context. It remains
nonterminal/coalescible and is excluded from provider dispatch. Phase 7.5 will
claim derivative work and complete it; Phase 7.3 never invents a ready boolean or
marks calculation success. Phase 7.4 subsequently closed this boundary using the
existing ensure services; exact G/F read checks and lazy ensures remain.

## Environment and security

Real dispatch requires explicit Test `xero_enabled` configuration and Preview
`ACCOUNTING_REFRESH_XERO_ENABLED=1`. Migration defaults are disabled. Internal
Test acceptance is service-only, resolves exact owned active Xero scope in SQL,
and consumes no usage day. No temporary public acceptance endpoint exists.
Synthetic mode retains its separate allowlist/enablement and never delegates to
Xero. Both modes reject Production. Vault URL/secret and signed pg_net delivery
remain unchanged; payload has only job/reservation UUIDs. No token enters control
tables, DTOs or telemetry. Existing encrypted grant storage remains authoritative.

Structured telemetry records claim/epoch, both heartbeats, binding, exact-run
recovery, request/retry counts, aggregate mapping/validation/promotion timings
and durable outcome. Safe numeric diagnostics persist with the association.
Unexpected/deterministic/publication failures enter Sentry without provider
payloads. Expected provider/auth/backoff outcomes use durable operational state.
No provider SDK framework, second importer/reconciler, scoring or materialization
change is introduced.
