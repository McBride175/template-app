# Collection dependency foundation (Phase 3.2)

This unit stores invalidation metadata, not financial values or calculated results.
It adds no customer materialization, score/benchmark persistence, caching, leases,
workers, provider calls, read-route changes, or UI changes. The Phase 3.1 calculation
contracts and frozen goldens remain unchanged.

## Authority and identity

Every metadata key includes `(user_id, tenant_id, source_system)`; customer keys
also include the provider customer source ID. Overrides have no provider column
and retain their existing effective Xero scope. Owner identity must not be dropped
when two owners have access to the same provider tenant.

| Identifier | Authority / meaning | Default |
| --- | --- | --- |
| G | Existing `xero_sync_tenant_state.active_sync_run_id`, verified against a succeeded, owner/tenant-scoped run | No active pointer is explicit legacy mode, **not** an immutable generation |
| rCustomer | `collection_customer_financial_revisions.financial_revision`: relevant operational customer feature input changed | Absent row = decimal text `0` |
| F | `collection_dependency_heads.financial_epoch`: some relevant tenant financial input or published generation changed | Absent row = decimal text `0` |
| P | Same head's `projection_revision`: financial or displayed operational projection input changed | Absent row = decimal text `0` |

Counters are nonnegative PostgreSQL bigint, transmitted as canonical decimal
strings, never JavaScript numbers. They are monotonically increasing invalidation
identities, not counts of user gestures. A multi-event command/batch can advance
more than once within its single transaction. There is no backfill requirement.
Missing schema/RPC, malformed results, scope mismatches, or an invalid generation
are errors; they must not be replaced with default zeros.

The server-only reader in `lib/collections/dependency-state-server.ts` obtains
G/F/P/optional rCustomer in one SQL statement snapshot. It is deliberately unused
by current pages/routes. Its caller must already authenticate, enforce entitlement
and resolve an owned tenant, just as existing server-only reads do. It creates no
new browser API and never accepts counter values from users.

## Mutation classification

| Authoritative change | rCustomer | F | P |
| --- | --- | --- | --- |
| Effective dispute coverage changes, including create/resolve/reactivate/delete | affected customer + | + | + |
| Dispute amount/mode changes but clipped current coverage is unchanged | — | — | + (invoice/worklist display changes) |
| Dispute note/review-basis change, including confirmation that changes review state | — | — | + |
| Dispute reconfirmation or repeated same-value update changing only domain revision/timestamp | — | — | — |
| Promise active coverage or customer `has_active_promise` input changes | affected customer + | + | + |
| Promise amount changes but effective clipped coverage and active flag are unchanged | — | — | + (terms/history display changes) |
| Promise date/note changes with unchanged coverage and active flag | — | — | + |
| Promise cancellation/kept/missed/unclear changes an open customer's active flag/coverage | affected customer + | + | + |
| Promise evaluation changes qualifying paid total and effective coverage | affected customer + | + | + |
| Evaluation generation/time only, or an identical evaluation replay | — | — | — |
| Priority create/change/removal; restore Normal by deleting an override | — | — | + |
| Same priority value, ignoring updated_at; repeated delete of absent row | — | — | — |
| Action History insert/delete or business-field update | — | — | + |
| Accounting active generation pointer changes | no mass increment | + | + |
| Candidate accounting/credit certification writes | — | — | — (G is unchanged) |
| Active credit certificate's consumed readiness/reason/consistency/contract inputs change | all current generation customers + | + | + |
| Credit certificate observational metadata only | — | — | — |

Dispute coverage uses the current authoritative invoice's native amount: active
full = due; active partial = min(recorded, due); settled/missing receivable = zero.
The classifier does not perform FX conversion or produce accounting outputs.
Exact native coverage changes can affect amounts, age populations and calculation
health, even where a customer's final score is currently suppressed.

Promise coverage uses min(max(promised minus qualifying paid, 0), post-dispute due).
The active flag also matters: Phase 3.1 customer features expose it even if a full
dispute leaves zero Promise coverage. An active insertion/cancellation in that
case must invalidate that customer feature. Date changes invoke the **existing**
command planner/resolver; any resulting lifecycle/evaluation change is classified
from actual row values, rather than assuming every date edit is financial.

Financial feature extraction uses authoritative accounting and current operational
rows. Invoice terms, notes, review markers, Promise history and priority/action
metadata must remain current projection inputs, **not** be embedded in a reusable
financial feature record that ignores P. Generic `notes` has no current collection
read-path consumer and receives no collection hook.

All existing commands, audit events, revisions, no-change validation, bulk revision
checks and replay fingerprints are preserved. Version suppression never suppresses
an existing audit write. Promise identity reassignment remains forbidden by its
existing guard. Defensive dispute/projection identity reassignment invalidates both
old and new scopes.

## Atomicity and locking

PostgreSQL AFTER-row triggers call private helpers in the authoritative write
transaction. The application does not issue an extra version RPC after a write.
Rollback of either the domain write or the version update rolls back both.

`advance_financial` atomically upserts F/P with database-side increments, then
upserts the sorted, deduplicated customer revision keys. `advance_projection`
atomically upserts only P. Neither performs application-side read/add/write.
Financial classification locks the existing accounting-state row, then obtains a
scope advisory transaction lock (also covering sparse scopes), then obtains a
fresh current-invoice snapshot, then updates head/customer keys. Thus a dispute
waiting for a publication uses the newly committed generation for clipping.

Promotion already holds accounting state before the Promise tenant advisory lock.
The two older Promise entry points (`apply_invoice_promise_command` and
`record_invoice_promise_evaluation`) now acquire the same accounting-state lock
first. Their validation, events, replay and result bodies remain unchanged. The
current request executor already has this lock order. No separate publication or
reconciliation transaction is introduced.

The active-pointer trigger advances F/P in the **existing** publication transaction.
Promise reconciliation in that transaction may additionally advance actual affected
customer revisions/F/P. There is never a committed new G with the old F/P. Failed
promotion, failed reconciliation, and already-promoted replay cannot publish partial
version state. G, not a mass rCustomer increment, invalidates accounting bases.
Candidate credit certification causes no tenant invalidation. The active-certificate
hook defensively covers certification availability changes; ordinary certification
writers still require candidate write authority. Published accounting remains
protected by existing generation fencing and immutable writer rules.

Deletion triggers make override removal and Action History undo observable. User
removal cascades erase metadata and do not resurrect it or fail a metadata FK.
Trusted multi-scope administrative operations should use deterministic scope order;
normal application commands retain their single owner/tenant scope. PostgreSQL
transaction failure remains a failure, never an acknowledgement followed by best-
effort invalidation.

## Validity contract for later units

A customer financial derivative must match owner/tenant/provider/customer,
**non-null G**, rCustomer, exact feature calculation contract version and UTC
evaluation date. A portfolio derivative additionally requires matching F, scoring
model/calculation versions and scoring population/scope. A projection also requires
P and the current operational eligibility evaluation time/date. Equality comparisons
must preserve bigint strings or BigInt, not coerce them to Number.

These counters do not advance at midnight without writes. Overdue age, payment
recency and history windows require the Phase 3.1 explicit UTC evaluation-date key.
Action History day-based rules use the authoritative organisation-local date/timezone;
that date identity is required in addition to UTC financial calculation date. No daily
counter/job is introduced here. Later reads must recheck dependencies across feature
extraction/publication and reject mismatches; this unit does not implement that work.

Legacy/null-G accounting remains supported by existing live reads. It cannot safely
be reused as an immutable accounting basis merely because F/rCustomer are zero.
Legacy canonical writes are not newly versioned by this migration; later materialization
must refuse reuse in legacy mode. This is an explicit unavailable immutable identity,
not a competing accounting pointer or a silent validity claim.

## Security, rollout and validation

New tables have RLS enabled, no browser policies, and SELECT only for service_role.
No browser or service_role role can directly update counters. Private helper/trigger
functions use a fixed pg_catalog search_path and fully qualified application tables.
Trigger functions execute as the migration owner (postgres); private schema usage
and function execution are revoked from PUBLIC/anon/authenticated/service_role.
The reader is SECURITY INVOKER and executable only by service_role. Existing
server authentication, owner filters and entitlement boundaries remain unchanged.

Migration: `supabase/migrations/20261003060828_collection_dependency_foundation.sql`.
It is additive and uses sparse initialization. Existing application requests work
before installation because none calls the new reader. Once installed, all covered
writes invalidate transactionally; unavailable metadata is a transaction failure,
not silent fallback. No hosted migration application is part of this task. Test/Preview
rollout requires the repository's exact-project preflight before a later reviewed
Production rollout. No environment variables are added/changed.

Local integration tests create uniquely named disposable databases inside the
existing local Supabase Postgres container, copy auth schema only, replay all canonical
migrations and use synthetic owner/tenant/accounting fixtures. They never reset the
existing local project database, execute legacy migrations, call Xero, or use hosted
credentials. Cleanup drops only their own database. Enable with:

```sh
RUN_SUPABASE_INTEGRATION=1 node --test tests/database/collection-dependencies.integration.test.mjs
```

The suite checks defaults, monetary/metadata/no-op cases, terminal and partial-payment
Promise reconciliation, replay, deletions, bulk rollback, forced publication/version
failure, simultaneous increments, visibility snapshots, changed-balance publication
races, cross-scope isolation, grants/RLS/search_path, bigint precision and exact-decimal
classification against the existing pure domain. Existing Promise/reconciliation/queue
local suites also run with the new migration. Phase 3.1 goldens are not rewritten.

## Validation record (2026-10-03)

Validated on develop at `806b5420a87749665d9de28957970275c54924f8`, with no commit
or hosted rollout. All 15 starting Phase 3.1 file hashes remained unchanged.

- New internal-reader tests: 21 passed.
- New isolated dependency database tests: 28 passed; all 19 canonical migrations replayed.
- Existing isolated Promise-command, reconciliation and queue suites: 59 passed.
- Focused calculation/domain tests (39 files, concurrency 2): 829 passed.
- Full suite (concurrency 2): 1,445 passed, 154 opt-in tests skipped, zero failed.
- Lint, TypeScript, SQL/security check, production build and diff whitespace check passed.
- No hosted integration tests enabled; all database fixtures were local and synthetic.

Five fresh local SQL sessions on one synthetic customer/invoice measured dependency
trigger time 2.134–2.940ms (median 2.473ms); complete financial UPDATE execution
2.533–3.708ms (median 2.917ms). These are PostgreSQL execution measurements,
not browser, remote-request or hosted latency. Normal hot reads gain no requests;
mutation network request count remains unchanged after the migration is installed.

Overlapping validation runs caused local paging and a synthetic 300-second candidate
lease expiry. A redundant runner was stopped; final bounded-concurrency/full and
isolated database runs passed. Race fixtures use database latches, not timing guesses.
