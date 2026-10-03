# Collection calculation contracts (Phase 3.1)

## Reference and scope

The behavioural reference is develop commit
`806b5420a87749665d9de28957970275c54924f8`. The working tree was clean
before this task. This unit extracts calculations and certifies parity; it does
not add persistence, counters, caches, RPCs, or incremental recalculation.

## Original execution path

1. `customer-summary.ts` resolves/holds the accounting generation, loads
   organisation/customer/invoice/payment/dispute/active-Promise/credit state,
   and rechecks the generation after reading live Promises.
2. Its aggregation uses `deriveInvoiceActionability`: dispute coverage first,
   certified active-Promise remainder second. Gross and actionability currency
   health are evaluated separately. Invalid gross amounts remain null.
3. It aggregates exact amounts and invoice-weighted age, applies certified
   customer credit once per customer, then calculates historical paid-invoice
   timing and canonical payment recency. Credit changes monetary To chase, not
   invoice ageing or the deterioration reference population.
4. The Actions route constructs separate invoice/age and monetary populations,
   selected by `overdueOnly`, before any operational suppression or result limit.
5. The route builds exposure totals/maximum, urgency weighted mean/maximum,
   and the existing relative-lateness percentile/fallback context.
6. `prioritiseCustomer` computes components and the weighted base score
   (50% exposure, 25% urgency, 15% deterioration, 10% payment recency), rounds
   the base score, applies founder override, rounds again, and builds explanations.
7. The route orders adjusted scores, exact monetary ties and customer names,
   applies V1/legacy Action History eligibility, derives status/counts, suppresses
   only the existing deferred/postponed rows, applies the limit, and builds DTOs.
   Other ineligible rows remain in the response as before; UI eligibility is separate.

## Deterministic evaluation

Feature extraction receives an explicit UTC evaluation date. Production captures
that date before remote reads, retaining the original timing. The queue overlay
receives explicit UTC and organisation-local dates calculated at the original
route boundary. Promise coverage has no clock-driven expiry in this layer.

Historical baseline uses the existing calendar-six-month cutoff, not 180 days.
Founder overrides, notes and Action History do not enter financial benchmarks.

## Parity evidence

`tests/xero/fixtures/collection-calculation-parity.json` freezes complete summary,
queue, scorer input/output and database-call sequence observations from the
original implementation. Its provenance includes the reference SHA and hashes
of the three original pipeline files. Capture happened before production edits.
Fixtures mock transport only and use fixed instants. Expected values must not
be regenerated merely because a refactor produces a mismatch.

The scenario definitions are in
`tests/xero/test-helpers/calculation-parity-fixture.mjs`.

## Extracted boundaries

```text
Before: server summary fetch + aggregation → route population + benchmarks
        → monolithic base/override/explanations → route eligibility/order/DTO
After:  same held server reads → pure customer features → pure portfolio benchmarks
        → pure base scores → founder adjustment → pure operational queue projection
```

### Customer features

`lib/collections/customer-features.ts` exports `CustomerFeatureInput`,
`CustomerFinancialFeatures`, `CustomerFinancialFeaturesResult` and
`calculateCustomerFinancialFeatures`. Inputs are held, ordered accounting rows,
operational disputes/active Promises, validated customer-credit evidence, an
explicit UTC date and generation scope. The snapshot input contains only
`syncRunId`; the server snapshot brand and fetching are not calculation inputs.

The result retains the original summary shape: exact decimal gross/disputed/
promised/invoice-To-chase/customer-To-chase/credit amounts; monetary availability;
invoice counts; pre-credit weighted age; paid-invoice history, relative lateness,
canonical payment recency; native currency breakdowns; health/review populations.
Compatibility exports in `customer-summary.ts` preserve existing consumers.

Amounts still use the existing exact-decimal helpers. Missing certified credit
remains unavailable with null available-credit amount, while the current invoice
fallback stays unchanged. FX-invalid gross totals remain null even when full
operational coverage makes actionable debt zero. The function does not reconcile
Promise lifecycle or certify credit: callers must supply the loader's validated
inputs. Currency context and actionability health remain separate from gross
subscription currency access.

### Portfolio benchmarks

`lib/collections/portfolio-benchmarks.ts` exports `PortfolioBenchmarkInput`,
`PortfolioBenchmarks`, `calculatePortfolioBenchmarks` and
`calculatePortfolioBaseScores`.

The result carries `overdueOnly`, invoice scope, monetary/scoring scope, ageing
reference population, analysed-overdue population, exact/numeric totals and
maximum, invoice-weighted urgency mean/maximum, and the unchanged relative-
lateness context. Queue projection reads scope from this result, avoiding an
independent scope flag. The limit is absent from this calculation.

Exposure uses customer monetary To chase after credit. Urgency and deterioration
use positive invoice To chase before customer credit. A credit-covered customer
can leave the monetary queue while remaining in ageing/deterioration reference
populations. Founder priority and contact history cannot remove benchmark rows.
Exposure total supplies the share/explanation and positive-portfolio guard;
maximum supplies its numerical normalization. Urgency applies its existing
piecewise mean/maximum normalization and invoice-count bonus. A below-mean
customer's urgency is not affected by maximum alone while that branch remains
unchanged. No portfolio benchmark is invented for payment recency.

Deterioration context remains the existing material population (>3 days,
positive finite invoice overdue), fewer-than-five absolute fallback, linearly
interpolated P50/P90, midpoint floor 16.5, high floor 30 and minimum upper span
13.5. History uses at least three qualifying paid invoices over six calendar
months and preserves all existing paid/credit qualification rules.

### Base scoring and founder adjustment

`lib/collections/prioritization.ts` exports `calculateBaseCustomerScore` and
`BaseCustomerScore`. Inputs are `PrioritizationCustomerRow` and
`PrioritizationContext`; `PRIORITIZATION_CONFIG` remains the single fixed current
configuration (50/25/15/10, one decimal place). No new model version/counter is
introduced in this unit.

The result separates component scores, rounded base score, original row/context
and unrounded explanation evidence. `validity` reports whether the legacy
computed base is finite; it does not invent accounting availability or change
legacy numerical guards. Financial availability belongs to customer features
and the existing route currency gate. Unknown money must not be fabricated into
a scorer row. `applyFounderOverride` performs the existing normalized override,
multiplier and final rounding. `adjustCustomerPriority` adds recommendation and
unchanged reason/breakdown presentation from the base result.

The old `prioritiseCustomer` API remains a compatibility wrapper for existing
callers, including the synthetic playbook. `buildReason` retains its original
small repeated arithmetic rather than changing explanation semantics here.

### Queue projection

`lib/collections/queue-projection.ts` exports `QueueProjectionInput`,
`CollectionQueueProjection`, `projectCollectionQueue`, `LoggedCollectionAction`
and `CollectionQueueStatus`. The input contains reusable features/base results/
benchmarks plus verified founder/Action History maps, explicit organisation-local
and UTC dates, display limit, health and source counts. It performs no fetching.

The result includes the original rows/portfolio/queue response fields and the
operational eligibility decisions. Sorting remains: Never chase last, adjusted
rounded score descending, exact monetary amount descending, locale name
comparison (base sensitivity), stable input order for remaining ties. No ID
sort is added. Deferred/postponed customers are removed before the limit, while
other existing ineligible rows remain visible. The route retains auth,
entitlements, unavailable-currency gating, loading/normalization and telemetry.

### Dependency evidence

| Change | Financial features | Portfolio anchors | Base scoring | Projection |
|---|---|---|---|---|
| Founder priority / Normal | Identical | Identical | Identical | Adjustment/order/eligibility |
| Action History / undo | Identical | Identical | Identical | Eligibility/activity/refill |
| Promise note/date only | Identical for unchanged active coverage | Identical | Identical | Existing display only |
| Dispute note/confirmation | Identical for unchanged effective amount | Identical | Identical | Existing display only |
| Dispute / Promise effective amount | Affected customer | May change exposure/age/deterioration populations/anchors | Affected customer and anchor-dependent peers | Reordered authoritative result |
| Customer credit | Customer monetary amounts | Exposure; pre-credit age/deterioration references retained | Exposure and weighted base; age components unchanged for retained customers | Accounting-zero queue gate |
| Accounting / UTC date | Relevant held features | May change | Corresponding components | Dates and eligibility |

Pure-contract tests compare features, benchmark contexts, scorer population,
components, base/adjusted scores, explanation output, eligibility, full DTO/order
and counts to independent goldens. They also freeze inputs, test direct anchor
dependencies, unchanged metadata/operational cases and population/limit rules.
The original IANA provider timezone fixtures exercise UTC fallback; additional
Xero enum fixtures exercise Auckland's local midnight. Their expectations were
captured with SHA256-verified untouched reference pipeline files. No old golden
expectation was replaced.

### Local CPU comparison

Original feature/queue blocks and scorer from the recorded SHA were executed
against the extracted functions with identical held inputs and exact-output
assertions. No transport time was measured. Node v26.8.2, macOS arm64; 10 warmups,
31 alternating samples per implementation, evaluation date 2026-10-01; synthetic
customers with two open and three paid invoices each; queue limit 50.

| Customers / invoices | Features before → after (median ms) | Benchmark/scoring/projection before → after (median ms) |
|---|---|---|
| 3 / 15 | 0.273 → 0.278 | 0.151 → 0.153 |
| 100 / 500 | 4.248 → 4.267 | 3.663 → 3.655 |
| 1,000 / 5,000 | 43.459 → 43.600 | 27.499 → 27.579 |

These results show no material local calculation CPU regression; they are not
hosted latency certification or a performance improvement claim. Full-path
goldens also assert the unchanged database-call sequence. No additional provider
calls, client refetches or database calls were introduced.

## Verification on the final implementation

- 89 frozen portfolio scenarios; 90 full-path golden tests plus 116 pure-contract
  and dependency tests, all passing within the domain-focused run.
- Domain-focused calculation/scoring, collections, Promise, dispute, credit and
  Action History run: 688 passed, zero failed, zero skipped.
- `pnpm test`: 1,550 total, 1,424 passed, zero failed, 126 skipped. Hosted/local
  database integration tests remain opt-in; they were not enabled for this unit.
- `pnpm lint`: passed with no warnings; `pnpm exec tsc --noEmit`: passed.
- `pnpm security:sqlcheck`: passed; `git diff --check`: passed.
- Local production `pnpm build`: passed after allowing the existing Google font
  download. Sentry upload was disabled for this local verification. No environment
  files were changed, and this build did not deploy.

There were no pre-existing modified/untracked files at the start. The branch and
HEAD remain `develop` / `806b5420a87749665d9de28957970275c54924f8`.
No migrations, hosted data changes, Xero syncs, caches, materialization, version
counters, jobs, commits, pushes, deployments or main updates were introduced.
