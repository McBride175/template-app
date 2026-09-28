# Pure invoice actionability — Phase 4

This is the canonical synchronous domain calculation. The pure function performs
no queries, writes, provider calls or lifecycle decisions. Phase 7 aggregation and
invoice DTOs consume its result; see [the integration contract](promise-collections-integration.md).

## Inputs and canonical flow

`deriveInvoiceActionability(invoice, dispute, promise)` accepts the existing
`DisputeAccountingInvoice`, existing `InvoiceDisputeRecord` and a minimal
`InvoicePromiseRecord`. Accounting inputs must come from one held authoritative
snapshot. Promise identity uses owner, tenant, provider and durable invoice/customer
IDs, not a generation-specific row UUID. Identity or Promise/invoice currency
disagreement throws a domain error; it never silently ignores the commitment.

The wrapper calls the existing `deriveInvoiceDispute` unchanged. Its effective
dispute coverage and collectible remainder are the inputs to Promise coverage.
`deriveInvoicePromise(promise, eligibleAmountNative)` uses exact decimal helpers:

```
O = current outstanding
D = existing effective dispute coverage
E = O - D (existing post-dispute native remainder)
R = max(recorded promise - certified qualifying paid, 0)
A = active ? min(R, E) : 0
To chase = E - A
```

The current outstanding already reflects accounting payments. Certified paid is
subtracted only from the fixed commitment, never again from outstanding. Disputes
consume coverage first. Dispute removal can restore coverage toward R; invoice
growth cannot expand the recorded commitment. Credits affect O without changing
certified paid or deciding an outcome.

Operational status alone controls coverage. The domain accepts no clock, promised
date, raw payments, baseline or unapplied cash. An Active commitment remains active
for this calculation even after its promised date. Invalid amounts/status fail
closed; missing eligible debt gives null active coverage. No Promise has null
recorded/paid/remaining values and zero coverage. Terminal promises preserve their
terms/paid/remaining values but supply zero coverage.

## Output and valuation

Money outputs are normalized decimal strings or null, with denomination in their
names: `currentAmountDueNative`, `effectiveDisputedAmountNative`,
`postDisputeAmountNative`, `recordedPromisedAmountNative`,
`qualifyingPaidAmountNative`, `remainingPromiseCommitmentNative`,
`activePromisedCoverageAmountNative`, `toChaseAmountNative`, `grossOpenAmountBase`,
`effectiveDisputedAmountBase`, `activePromisedCoverageAmountBase`, and
`toChaseAmountBase`. The canonical active promised coverage is
`activePromisedCoverageAmountNative`; future consumers must use this result rather
than reproduce overlap logic. Explicit native/base currency codes accompany it.
The nested dispute and Promise results preserve their operational context.

No-split valuation preserves the existing dispute base values exactly. Complete
coverage uses the entire known post-dispute base remainder. A partial split converts
the final native To chase through the existing native/rate, eight-place rounding
contract and verifies gross valuation against canonical gross. Promise base is then
the residual, so gross base = disputed base + promised base + To-chase base exactly.
Unavailable/inconsistent partial valuation leaves both new base components null;
it never invents FX or treats unknown base debt as zero.

Missing invoices have null current outstanding and null To chase. Invalid native
balances/denomination also have null derived current actionability. Known settled
or ineligible invoices follow existing Disputes eligibility: their observed native
amount is retained, but collection actionability and coverage are zero. None of
these cases changes the Promise status. Nested Disputes retain their existing
missing-invoice operational conventions; canonical top-level monetary values are
the contract for future consumers.

Pure outcome qualification/resolution now exists separately (Phase 5A); it never
calls actionability. Automatic reconciliation (Phase 5B), authenticated backend reads/mutations (Phase 6)
and customer/queue actionability integration (Phase 7) are implemented. Promise
editor/history UI is available in the customer invoice context (Phase 8). Legacy promise contact outcomes no longer
suppress the queue; explicit postponement remains.
