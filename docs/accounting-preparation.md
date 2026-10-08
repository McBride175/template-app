# Durable derivative completion (Phase 7.4)

Refresh completion is a historical successful preparation point. It requires the
job's confirmed promoted G to still be authoritative, a current full customer
feature population and both standard `collections` portfolio variants:
`overdueOnly=false` and `overdueOnly=true`. Identity includes G/F, current UTC
date, `customer_basis_v1`, `customer_features_v1`,
`collection_scoring_50_25_15_10_v1`, `portfolio_base_v1` and credit/evidence identity.
Priority, Action History, customer-detail and queue-page overlays are excluded.

The worker loads stage from durable state. Accounting-stage delivery delegates to
the existing provider path. Derivative-stage delivery uses `preparation-server`:
claim → current bound/accounting identity → existing feature ensure → existing
portfolio ensure twice → atomic current-identity completion proof → complete.
No provider client/token/importer/generation acquisition dependency exists in this
path. The same four-slot transport and 300-second attempt lease apply.

No financial implementation is duplicated. Existing ensure functions preserve
basis reuse, per-customer revision misses, exact weights, benchmark populations,
founder adjustment downstream, checksum/publication fences and lazy read safety.
The completion RPC uses those existing validity readers while holding the same
financial scope lock. It checks the full feature population and both actual
calculation IDs, including UTC date at the completion point. P is not a financial
completion fence. Subsequent financial changes/UTC rollover can invalidate a
previous completion; ordinary read ensures continue to handle them.

F/rCustomer/evidence drift or UTC rollover causes bounded re-ensure against the
new context, then derivative-only retry if unstable. A newer authoritative G
closes the old job as `complete/superseded`; it never relabels G1 as G2 readiness.
There is no rollback of valid accounting promotion.

Parked preparing rows are discoverable through the same eligible-work contract.
Reservation transactionally normalizes them to queued derivative work; claim
restores preparing. Stage cannot return to accounting. Production/Test migration
application alone never enables preparation delivery. A separate Test config gate
and `ACCOUNTING_REFRESH_PREPARATION_ENABLED` environment flag control rollout.
Cron dispatches/retries/recovers existing intent only; dormant tenants generate
no work. Provider dispatch remains independently gated.

Preparation retry count is independent of provider retries. Failures use the
accepted 1/5/15/60-minute jittered sequence, then attention. Provider cooldowns do
not delay preparation. Expired derivative attempts use the same bounded recovery
sequence; stale attempts cannot heartbeat/complete. Existing succeeded-run
recovery never resets a live preparation attempt or bypasses its retry due time.

The attempt controller renews connection/attempt authority throughout preparation;
there is no running-generation heartbeat for an already succeeded generation.
An absolute 240-second substantive deadline and 270-second bookkeeping boundary
gate each database operation; cancellation propagates to ensure RPCs. Completion
SQL is not aborted midway. Lost completion response is resolved by reading the
exact job; already-published derivative responses are recovered through ordinary
warm ensure validity, never by provider retrieval.

The completion identity/diagnostics are audit metadata, not a second derivative
authority or ready table. Status distinguishes accounting refresh, preparing,
preparation retry/attention, updated and superseded. No visible UX, product
trigger, billing-route or activity cutover is included; those belong to Phase 7.5.

All control/proof RPCs remain service-only with fixed search paths and exact
attempt/epoch checks. Internal Test injection is private, one-shot and guarded by
Test project configuration. It can fail after feature ensure or lose a completion
response; it cannot select provider work. Telemetry contains identities, counts
and timings only. No accounting/customer payload or secret is logged.
