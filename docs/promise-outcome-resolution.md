# Pure Promise evidence and outcome resolution — Phase 5A

Canonical accounting evidence → payment qualification → pure resolver remains
independently testable. The pure functions do not call persistence, accounting
sync, actionability, scoring or UI. Phase 5B now consumes their results at atomic
accounting promotion. `defer` is technical and never a persisted status. Unclear is a silent terminal
business outcome, not a review task. Cancellation remains user-driven.

## Input contract

`PromiseLifecycleRecord` adds revision, created time, promised date, creation
generation and the existing version-1 payment baseline to the Phase 4 identity and
terms. Money must be exact decimal **text**, never already-rounded JSON numbers.
The baseline is unchanged: known payment IDs and explicit observation start/end.

`PromiseAccountingObservation` holds exact user/tenant/provider/generation identity,
the `promise_accounting_evidence_v1` contract, succeeded/authoritative state,
readiness, normalized organisation IANA timezone/base currency and resource
observations. Resource observations include complete, start/end, page counts,
source count and mapped count. Complete evidence requires successful explicit empty
pagination termination, ordered timestamps and matching counts. No promotion or
wall-clock timestamp substitutes for a resource start.

Callers supply the **whole generation's** canonical exact payment/cash arrays,
including rows belonging to other invoices/customers. Counts are checked against
the observations; a filtered subset must not masquerade as a complete generation.
All rows must match owner/tenant/provider/generation. This is not a new evidence
framework: these are typed domain projections of the Phase 3A exact views and
held readiness inspection. Later loaders must retain decimal text at the boundary.

Cross-currency comparison additionally needs the exact invoice's generation-scoped
`PromiseCurrencyValuation`: currency, organisation base currency, rate and validated
conversion status. No current balance/status is an input to the resolver.

## Payment qualification

`qualifyPromisePayments` recomputes from current complete evidence. Duplicate IDs
invalidate the stream instead of double counting. Baseline IDs are excluded even
when their amount/date changed. Only AUTHORISED ACCRECPAYMENT for the exact invoice,
customer and currency qualifies. DELETED, unsupported/refund types, other invoices,
dates before the creation local day and dates after the promised day are excluded.
Malformed required evidence or incompatible scope/currency invalidates qualification;
the paid total is then null, never fabricated zero.

The approved same-day ambiguity is retained: a same-day non-baseline payment may
qualify even if cash existed earlier that day but was invisible to the baseline.
UpdatedDateUTC is not used as a cash receipt time. The returned exact sum is uncapped;
all individual contributions and diagnostic exclusions have durable source IDs.
Results bind to Promise ID/revision/terms, generation and payment observation times.
Deleted payments disappear from the next recomputed total; no incremental accumulator
or Promise mutation exists here.

## Deadline and decision order

The pure timezone helper derives creation local date and the boundary at the start
of the following local day using IANA/Intl DST data. Missing/invalid timezone or an
unsupported calendar boundary fails closed. No timezone fallback or grace period.

1. Terminal Promise: `defer / terminal_promise_unchanged`, terminal=true,
   transition_required=false; retain existing operational paid facts. New evidence
   is not evaluated and history is never rewritten.
2. Invalid required payment/identity/timezone/observation evidence: defer.
3. Qualified payment >= fixed commitment: Kept immediately. Cash streams and foreign
   FX are not required for this positive payment proof.
4. Insufficient payment with payment observation start before the boundary: retain
   Active. Incomplete cash is not required for this pre-boundary decision. Failed or
   incomplete payment evidence defers; both decisions leave operational state alone.
5. Post-boundary payment observation: require complete Overpayment/Prepayment
   observations, matching cash counts and readiness. Any complete resource whose
   start predates the boundary retains Active, even when completion is later.
6. All three starts on/after the boundary: sufficient plausible cash → Unclear;
   complete safely comparable insufficient cash → Missed; unsafe evidence → defer.

Payment qualification may establish Kept before the deadline; no full readiness
requirement makes Kept depend on cash endpoints. Negative outcomes require full
readiness. A future runner must evaluate eligible observations in generation order
so the first successful eligible post-deadline observation is not skipped.

## Unapplied cash

Only matching-customer, positive, AUTHORISED RECEIVE-OVERPAYMENT/PREPAYMENT with an
accounting date on/before the deadline is considered. Known spend/unsupported,
voided/deleted/PAID, later-dated, zero and other-customer sources are excluded.
Malformed required facts defer. No creation-date lower bound is imposed on cash:
previously received cash can still plausibly cover the unpaid commitment.

Same-currency eligible cash is summed exactly against remaining unpaid commitment.
If it suffices, foreign FX is irrelevant. Otherwise convert the remaining native
shortfall through the exact invoice's authoritative valuation and compare with
validated foreign cash base values. Cash rates/base values are checked through the
existing native/rate, eight-place rounding contract. Known sufficient valued cash
can veto Missed despite additional unvalued cash; if unknown valuation could affect
an insufficient result, defer. Never guess a rate or interpret unknown cash as zero.

There is no allocation, reservation or consumption. One balance may independently
make multiple commitments Unclear. Cash never proves Kept or affects actionability.

## Result and Phase 5B handoff

Decisions are exactly retain_active, kept, missed, unclear and defer. Results include
reason code, terminal/transition flags, payment_evaluation_valid, exact paid/remaining totals, source generation,
resolver version, evaluated_at, effective_at/date and a minimal versioned evidence
summary. Reasons cover satisfied payment, unobserved deadline, sufficient cash,
reliably insufficient cash, terminal preservation and invalid/unavailable evidence.
The summary contains commitment terms, contributing payment IDs/amounts/dates,
resource boundary facts and a cash comparison only when needed. It contains no raw
payload, contact information, unrelated payment list or allocation data.

Kept's effective_date is the accounting payment day when cumulative eligible payments
first reach the commitment. effective_at is null: no universal intraday cash timestamp
exists. Missed/Unclear effective_at is the next-local-day boundary; effective_date is
the promised day. evaluated_at is the completion of the required observation(s), not
the cash date, deadline, promotion time or persistence commit time.

For transition_required=true, Phase 5B maps the decision directly to status and sends
the exact paid total, source generation, evaluated_at, reason/version, effective_at
and evidence to the existing revision-safe atomic system resolve command. It must
not re-decide outcomes. resolved_at/occurred_at remain database commit timestamps.
Terminal-preservation and defer with invalid payment evaluation cause no operational
or lifecycle writes. retain_active, or a cash-related defer with payment_evaluation_valid=true,
has no lifecycle event but provides a certified paid total that may decrease after
deletion. Payment qualification remains independent of an unavailable cash outcome.
Phase 2 currently has no system command for nonterminal
paid/evaluation updates; that bounded persistence support belongs to Phase 5B, not
this phase. Exact-text Promise reads also belong to that server/persistence boundary.

Phase 5B must hold one authoritative generation, qualify then resolve against the
same Promise revision and observation, reject stale revisions without replaying
intent, and use deterministic command idempotency. No part of that integration is
implemented here. Phase 4 calculations and all existing application flows are unchanged.

## Phase 5B integration

The pure functions remain unchanged. They are now consumed by the internal
[atomic reconciliation path](promise-reconciliation.md), which applies decisions
at fenced accounting promotion. No Promise CRUD/UI or queue integration exists.
