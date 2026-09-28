# Structured Promise collections integration — Phase 7

## Monetary authority

Authoritative invoice → existing dispute derivation → current Active structured
Promise → `deriveInvoiceActionability` → invoice To chase → customer sums →
portfolio benchmarks → unchanged scorer → ranked recommendation queue.

`invoice-promises-loading.ts` reads only Active operational state, paginated once
per tenant (or customer invoice scope), keyed by durable Xero invoice ID. Every
query constrains authenticated owner, tenant, provider and Active status. Numeric
SELECT casts preserve PostgreSQL decimal text before JSON parsing. No events,
baselines, cash, payment evidence, clock or resolver are loaded in scoring paths.
Errors, duplicate identities and incompatible invoice/customer/currency context
fail closed. A final authoritative-snapshot check rejects reads spanning publication
of a new accounting generation and its reconciled Promise state; the caller must
refresh rather than combine generations. Missing current Active invoice context
also rejects a monetary summary rather than inventing zero debt.

## Aggregation and contracts

Gross outstanding/native breakdowns and gross invoice counts remain accounting
facts. Gross subscription currency eligibility is unchanged. Effective disputed
amounts sum existing canonical dispute coverage. Customer active promised totals
sum canonical coverage, **not** the recorded fixed commitments.

Customer and queue DTOs add exact `active_promised_outstanding_base_decimal` and
`active_promised_overdue_base_decimal` (nullable when valuation is unavailable),
plus exact/numeric `to_chase_outstanding_base` and `to_chase_overdue_base` fields.
Exact variants have the `_decimal` suffix. Native breakdowns add promised and
To-chase outstanding/overdue fields. `collectible_*` remains a compatibility alias
for To chase. No new balance layer exists. Unknown gross/promised base values stay
null; known zero native To chase is safe for actionable currency health.

Customer invoice DTOs include native/base canonical coverage and To chase plus
minimal Active Promise ID/status/revision/fixed amount/date/certified paid context.
Their existing `collectibleAmountNative` and dispute-worklist collection remainder
now mean To chase. Dispute editing, needs-review rules and retained dispute amounts
remain unchanged. Promise detail/history continues to use the separate Phase 6 API;
no creation baseline, raw evidence or history leaks into aggregation DTOs.

## Recommendation model

Exposure numerator, largest-customer comparison and portfolio share use To-chase
overdue amounts. Urgency uses To-chase-weighted overdue age and counts only overdue
invoices with positive native To chase; the original due dates and bonus bands
remain unchanged. Relative deterioration uses this current weighted age and the
unchanged historical paid-invoice baseline. Payment recency stays gross-accounting
based. Weights remain 50/25/15/10, with unchanged caps, normalisation and overrides.
Monetary ties use To-chase overdue amounts. All corresponding portfolio benchmarks
use the same eligible To-chase population.

Full coverage removes the customer's debt from chasing; partial coverage keeps its
remaining debt ranked. Terminal Promise rows are not loaded and supply no coverage.
No independent date expiry or missed-Promise penalty exists. Existing card and
first-value monetary compatibility fields therefore agree with queue inputs.

## Legacy cutover

`promised_to_pay` collection outcomes remain historical contact records, including
existing/new contact-history dates. They neither suppress the queue nor create
structured Promises. The old suppression counter remains in the response as zero
for compatibility. Explicit `action_type = postponed` still suppresses until its
next-action date, including a postponed action with a legacy promise outcome.
Ordinary contacted-today handling is unchanged. No rows are deleted/backfilled.
The existing contact form now says its date does not postpone collection.

## Boundaries and performance

One additional Promise page read for a small tenant; larger tenants page by 1,000
Active rows. Invoice detail scopes by customer; no per-invoice queries, history reads,
new provider requests or resolver calls. Snapshot verification adds fixed metadata
reads independent of customer/invoice count. Existing portfolio recomputation on
queue fetch remains; mutations do not invoke the scorer.

Phase 8 provides the customer/invoice editor and bounded Promise history described
in `promise-customer-experience.md`. No worklist, unified Action History, Promise
reliability score or analytics is added. Unapplied cash continues to influence outcomes only;
it never changes To chase. No migration, environment or OAuth change is required.

Regression coverage: `tests/xero/promise-collections-integration.test.mjs`, the
existing frozen no-dispute portfolio fixture, multicurrency, dispute journeys,
queue status, invoice server and authoritative-snapshot reader suites.
