# A. Phase 2 verdict

**CERTIFIED WITH BOUNDED LIMITATIONS.** Certified on 2026-10-01 on local `develop`
at `92d34c4` plus the preserved, uncommitted Phase 1 changes and this phase's
changes. Production scorer and queue fixtures match hand-calculated results.
One numerical range defect was corrected without changing scoring policy,
weights, signals, arithmetic precision or benchmark methodology.

# B. Scoring preflight

The Actions queue entry is `GET` in `app/api/collections/actions/route.ts`.
It constructs benchmarks from `loadCustomerCollectionsSummaryWithMetadata` in
`lib/collections/customer-summary.ts`, then calls `prioritiseCustomer` in
`lib/collections/prioritization.ts`.

| Calculation | Exact implementation |
| --- | --- |
| Exposure | `computeExposureComponents`, exported `computeExposureScore` |
| Urgency | `computeUrgencyComponents`, exported `computeUrgencyScore` |
| Payment recency | `computeBehaviourComponents`, exported `computeBehaviourScore` |
| Composite | `calculateWeightedEvidence`, exported `computePrioritizationBaseScore` |
| Founder adjustment | `prioritiseCustomer`, `OVERRIDE_MULTIPLIERS` |
| Historical eligibility/median | `lib/collections/payment-behavior.ts`: `calculateHistoricalPaymentBaseline`, `isEligibleHistoricalPaymentInvoice`, `calculateHistoricalPaymentWindowCutoff` |
| Current relative lateness | `calculateRelativeLatenessDays` in `payment-behavior.ts` |
| Relative scaling | `lib/collections/relative-lateness.ts`: `buildRelativeLatenessContext`, `calculateLinearInterpolatedPercentile`, `computeRelativeLatenessScore` |
| Ranking and operational filtering | Actions `GET`, `resolveQueueEligibility`, `isEligibleActiveQueueRow` |

Weights are exactly **Exposure .50 / Urgency .25 / Relative deterioration .15 /
Payment recency .10**. The internal `behaviour` identifier is payment recency.
Phase 1 added provider filters only; it introduced no scoring path. One live
customer scorer remains. The public playbook delegates synthetic examples to the
same scorer and is not another live customer ranking implementation.

# C. Exposure certification

Let C be customer **net overdue To chase**, T the portfolio net overdue total and
L its largest customer net overdue To chase.

- If C <= 0, T <= 0 or L <= 0: E = 0.
- Otherwise E = clamp(100 × C/L, 0, 100).
- 100 × C/T is a diagnostic share; it is **not** the scoring denominator.

The customer's own amount participates in T and L. Cases include C = 0, tiny
positive values, 1%, 50%, 90%, 100%, one-customer portfolios, identical customers,
tied maxima, skewed portfolios and zero benchmarks. A row with gross 1,000,000,
invoice actionability 9,000 and customer net 100 against L = 1,000 scores **10**.
Gross accounting or pre-credit invoice amounts cannot substitute for C. **Pass.**

# D. Urgency certification

Let a be the customer's balance-weighted overdue age, m the portfolio weighted
mean, and M the greatest customer weighted age. Invoice monetary weights are
post-dispute/post-Promise, pre-customer-credit base amounts.

If invoice-derived overdue actionability <= 0, U = 0 including its count bonus.
Otherwise the base urgency B is:

| Condition | B before clamping |
| --- | --- |
| M <= 0 | 0 |
| M <= m or m <= 0 | 100a/M |
| a <= m | 50a/m |
| a > m | 50 + 50(a−m)/(M−m) |

B is clamped to [0,100]. Count bonus b is 0 for one invoice, 5 for two, 10 for
three/four, and 15 for five or more (zero invoices also gives zero bonus).
U = min(100, B+b). The guarded M <= 0 branch avoids division by zero; if positive
invoice actionability and an inconsistent nonzero count are supplied with zero
benchmarks, the count bonus still applies as currently implemented.

At m = 20 and M = 60, ages 10/20/30/40/60 produce bases 25/50/62.5/75/100.
At age 30, counts 1/2/3/4/5 produce 62.5/67.5/72.5/72.5/77.5.

Real invoice fixture: 900 at 10 days plus 100 at 100 days gives a = **19**, not 55.
A second customer has 200 at 40 days, so m = **22.5**, M = **40**. The first
customer has two invoices: U = 19/22.5×50+5 = **425/9**, with base composite **71.8**.

Suppression fixture: old invoice 900 − dispute 600 − Promise 200 = 100 at 100 days,
plus 100 at 10 days, gives a = **55**, with two actionable invoices. Fully
disputed/promised older invoices do not enter age/count. Customer credit 100
changes net 200 to 100 without changing a, U or deterioration. **Pass.**

# E. Relative deterioration certification

Historical eligibility requires valid-date ACCREC/PAID invoices, positive Total
and AmountPaid, zero AmountDue, and absent or immaterial absolute AmountCredited
<= 0.01. Settlement dates must fall within the inclusive six-calendar-month
window ending on evaluation date. Month-end subtraction clamps to the target
month's last day. At 2026-10-01 the cutoff is 2026-04-01.

With at least **three** qualifying invoices, historical normal is the unweighted
median of signed days late (early payment remains negative). Even histories
average the middle pair. Mean is diagnostic only. Fewer than three yields null
normal and null deterioration; its 15% contribution remains zero, not redistributed.

Let r = current invoice-weighted age − historical median. No positive invoice
actionability, missing/nonfinite r, or r <= **3 days** gives R = 0.

Reference observations: one r > 3 per customer with positive finite invoice
actionability. The customer's own r participates; monetary size does not weight
the percentiles.

- Fewer than five material customers: midpoint A = 16.5, high H = 30.
- At least five: A = max(P50,16.5); H = max(P90,30,A+13.5).
- Percentiles use linear interpolation at index (n−1)p of sorted observations.
- r <= A: R = clamp(50(r−3)/(A−3),0,100).
- r > A: R = clamp(50+50(r−A)/(H−A),0,100).

The fallback is equivalent to clamp(100(r−3)/27,0,100). r values
3/9.75/16.5/23.25/30 produce **0/25/50/75/100**. Below/equal historical normal
produce zero. A sparse-history customer remains zero even at current age 1,000.

Portfolio [25,30,35,40,45]: P50 = 35, P90 = 43, A = 35, H = 48.5; scores are
34.375, 42.1875, 50, 68.51851851851852, 87.03703703703704. Outlier portfolio
[10,20,30,40,1000] gives P50 = 30 and P90 = 616; r = 30 scores 50 and r = 1000
caps at 100. Five equal values of 20 retain a nonzero upper span H = 33.5. **Pass.**

# F. Payment recency certification

`computeBehaviourScore` uses absolute whole UTC days since the latest scoped
canonical payment date:

| Days | P |
| --- | --- |
| <= 0 | 0 |
| 1–7 | 10 |
| 8–14 | 20 |
| 15–30 | 40 |
| 31–45 | 60 |
| 46–60 | 80 |
| >= 61 | 100 |
| No history | 100 |

The generation importer admits authorised ACCRECPAYMENT records into canonical
recency data. Summary reads the held owner/tenant/Xero generation and associates
payments using customer identity, with invoice identity fallback for absent
customer ID. It chooses the latest valid payment date. The recent-partial-payment
flag contributes no additional signal.

Every integer band boundary and its neighbouring values passes. Payments at
31/14/7 days produce latest age 7 and P = **10**; another customer's same-day
payment gives that customer P = **0**. Newer foreign owner/tenant/provider/retained
generation records, Promise events, dispute activity, generic Action History and
credit evidence do not replace the qualifying date. **Pass.**

# G. Benchmark certification

| Portfolio | Net total / largest | Weighted mean / max age | Result |
| --- | --- | --- | --- |
| One: 100 at 30 days | 100 / 100 | 30 / 30 | E=100, U=100 |
| Two: 100 at 10; 300 at 30 | 400 / 300 | 25 / 30 | E=33⅓,100; U=20,100 |
| Three identical: 100 at 20 | 300 / 100 | 20 / 20 | Equal components |
| Skewed: 1000 at 10; 1 at 100 | 1001 / 1000 | 10100/1001 / 100 | Exact expected benchmark |
| Five: 100 each at 25/30/35/40/45, last credit-covered | 400 / 100 | 35 / 45 | Five deterioration observations retained |

Fully dispute/Promise-covered customers are excluded from the actionable invoice
population. Credit-covered customers leave monetary scoring/queue population but
remain in invoice ageing/deterioration references. Deferred and Do-not-chase
customers remain benchmark members; their eligibility is applied afterward.
Sparse-history customers contribute current money/age, but no deterioration
observation. No-payment-history customers remain eligible benchmark members.
Zero-current invoices are excluded from overdue benchmarks. Currency-unhealthy
customers remain excluded under Phase 1's existing gate.

In the five-customer example, deferring the 35-day customer and marking the 40-day
customer Do not chase leaves all benchmark values unchanged. Adding a sparse
100-at-10-day customer changes total to 500 and age mean to 185/6, while the
five-material-observation deterioration context remains unchanged. **Pass.**

# H. Composite-score certification

Raw = .50E + .25U + .15R + .10P. Base = `Number(raw.toFixed(1))` using the current
JavaScript number convention. Component/display strings are never fed back.

| E | U | R | P | Expected base | Actual | Result |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | 0 | 0 | 0 | 0 | 0 | Pass |
| 100 | 100 | 100 | 100 | 100 | 100 | Pass |
| 100 | 0 | 0 | 0 | 50 | 50 | Pass |
| 0 | 100 | 0 | 0 | 25 | 25 | Pass |
| 0 | 0 | 100 | 0 | 15 | 15 | Pass |
| 0 | 0 | 0 | 100 | 10 | 10 | Pass |
| 50 | 62.5 | 50 | 40 | 52.1 (raw 52.125) | 52.1 | Pass |
| 50 | 72.5 | 0 | 40 | 47.1 (raw 47.125) | 47.1 | Pass |
| 50.08 | 0 | 0 | 0 | 25.0 | 25.0 | Pass |
| 50.12 | 0 | 0 | 0 | 25.1 | 25.1 | Pass |
| 50.18 | 0 | 0 | 0 | 25.1 | 25.1 | Pass |
| 99.98 | 100 | 100 | 100 | 100 | 100 | Pass |

# I. Founder-override certification

Order: bounded components → weighted raw sum → base rounding to one decimal →
founder multiplier → final rounding to one decimal → ranking. There is no 100-point
cap after founder multiplication. `priority_score` equals `final_score`.

| Base | Safe .4 expected/actual | Normal 1 expected/actual | Priority 1.6 expected/actual | Do not chase 0 expected/actual |
| --- | --- | --- | --- | --- |
| .1 | 0 / 0 | .1 / .1 | .2 / .2 | 0 / 0 |
| 12.4 | 5 / 5 | 12.4 / 12.4 | 19.8 / 19.8 | 0 / 0 |
| 52.1 | 20.8 / 20.8 | 52.1 / 52.1 | 83.4 / 83.4 | 0 / 0 |
| 100 | 40 / 40 | 100 / 100 | 160 / 160 | 0 / 0 |

Raw 12.44 demonstrates the order: 12.4 × 1.6 → **19.8**, not raw-first **19.9**.
Do not chase keeps its accounting breakdown but final score is zero. **Pass.**

# J. Ranking certification

The real queue fixture has all current ages 30, one overdue invoice/customer,
no qualifying recency history (P=100) and no usable historical median (R=0).
Thus U=100 and normal base is 35 + .5E. Sparse has two historical invoices.

| Expected order | Customer/net | Override | Expected base/final | Actual base/final |
| --- | --- | --- | --- | --- |
| 1 | priority / 500 | Priority | 60 / 96 | 60 / 96 |
| 2 | normal / 800 | Normal | 75 / 75 | 75 / 75 |
| 3 | close-high / 602 | Normal | 65.1 / 65.1 | 65.1 / 65.1 |
| 4 | close-low / 600 | Normal | 65 / 65 | 65 / 65 |
| 5 | exact (name Zeta) / 500.000000000000000001 | Normal | 60 / 60 | 60 / 60 |
| 6 | alpha / 500 | Normal | 60 / 60 | 60 / 60 |
| 7 | beta / 500 | Normal | 60 / 60 | 60 / 60 |
| 8 | same-a / 300 (Same name) | Normal | 50 / 50 | 50 / 50 |
| 9 | same-b / 300 (Same name) | Normal | 50 / 50 | 50 / 50 |
| 10 | sparse / 100 | Normal | 40 / 40 | 40 / 40 |
| 11 | safe / 1000 | Safe | 85 / 34 | 85 / 34 |
| Diagnostic tail only | never / 900 | Do not chase | 80 / 0 | 80 / 0 |
| Excluded | zero / 0 | Normal | No actionable overdue row | Excluded |

Actual order exactly matches expected. Do-not-chase rows sort last in API
diagnostics and are excluded by the active queue selector. Future V1/legacy
deferrals are removed before the response limit.

Tie order: final rounded score descending, exact customer net To chase descending,
then customer name with case-insensitive `localeCompare`. Completely equal keys
retain stable input order; there is no additional customer-ID tie-break. Canonical
reads order invoice/customer source IDs. Reversing fixture storage order yields
the same ranked result. No new tie policy was introduced. **Pass.**

# K. Numerical / invariance results

- Zero denominators and no eligible invoice amounts follow explicit guards.
- Components stay in [0,100] for certified inputs; base stays in [0,100]; adjusted
  final scores stay in [0,160]. Negative age/exposure inputs are floored.
- Exact positive money down to the decimal contract's 1e-100 boundary remains
  finite and actionable. A singleton at that amount scores E=100, U=100, base=85.
- Supported large amounts (1e95 at 100 days) retain the correct age/score.
- NaN, Infinity and beyond-contract money (1e306) are excluded by canonical
  validation before any scorer invocation. Failed weighted-age intermediate
  arithmetic now fails the request instead of fabricating zero age.
- Final scores/rounding use exact assertions. Non-terminating ratios and percentile
  interpolation allow only eight machine epsilons at the expected magnitude.
- Action History, inactive dispute history/notes, terminal Promise history/events
  and note changes preserve captured scorer inputs, benchmarks and all scores.
- Increasing credit from exactly covering a customer to 1,000,000 leaves all
  remaining scorer inputs, benchmarks, components and ranking unchanged.
- A displayed urgency of 73 is still calculated as 72.5. The mixed composite is
  47.1, not the 47.3 that feeding back the display-rounded component would produce.

# L. Defects found and corrections

**Medium — failed weighted-age numerator sum silently became zero.**

The decimal parser permits at most 100 digits/absolute exponent 100. A valid
100-digit balance of 1e99 at age 100 produces a 102-digit weighted intermediate.
`sumDecimalValues(...)` correctly returns null when it cannot parse that
intermediate, but `?? '0'` substituted zero, allowing a successful queue response
with fabricated zero age.

Correction in `lib/collections/customer-summary.ts`: remove that fallback and
preserve null for the existing supported-range guard. Empty sums already return
zero. The request now fails closed before any customer is scored. Supported
accounting and score formulas are unchanged.

Regression in `tests/xero/scoring-queue-certification.test.mjs`: before correction,
expected HTTP 500 received 200; after correction HTTP 500 and zero scorer calls.
Companion cases prove supported large values and tiny positive values still work.

Phase 2 additionally adds `scoring-mathematics-certification.test.mjs` and an
optional observer in the existing journey fixture. The observer records arguments
and delegates to the real production scorer; it supplies no substitute formula.
Phase 1's four provider filters and all earlier files remain preserved.
No migrations or environment-variable names were added or changed.

# M. Tests executed

| Command | Suites/result |
| --- | --- |
| `node --test tests/xero/scoring-mathematics-certification.test.mjs tests/xero/scoring-queue-certification.test.mjs` | Final new suites: **23 passed, 0 failed** |
| `node --test tests/xero/scoring-mathematics-certification.test.mjs tests/xero/scoring-queue-certification.test.mjs tests/xero/prioritization.test.mjs tests/xero/relative-lateness.test.mjs tests/xero/payment-behavior.test.mjs tests/xero/collections-queue-status.test.mjs tests/xero/accounting-actionability-certification.test.mjs tests/xero/customer-credit-summary.test.mjs tests/xero/promise-collections-integration.test.mjs tests/xero/disputes-journeys.test.mjs` | Targeted run: **189 passed, 0 failed**, before adding the final unequal-invoice-weight case; that case passed in the new-suite and broad runs |
| `pnpm test` | **1,283 tests: 1,160 passed, 0 failed, 123 opt-in integration skips** |
| `pnpm lint` | Passed |
| `pnpm typecheck` | Passed |
| `pnpm build` | Passed; 97 pages; existing Node module.register deprecation warning |
| `pnpm security:sqlcheck` | Passed |
| `git diff --check` | Passed |

The intentional before-fix range regression failed and passed after correction.
An initial exploratory 1e306 fixture was correctly blocked by the existing
decimal contract; its expectations were corrected to test that protection.
No unrelated failures remain in the executed suites. No database schema or
persistence logic changed; the opt-in database suites were not rerun in Phase 2.

# N. Bounded limitations

**Mathematically certified:** current production scorer, canonical summary
integration, real queue benchmark construction/sorting and operational selectors
under controlled fixtures, including the numerical guard correction. No new
signals, weights, founder factors or benchmark methodology were introduced.

**Not directly certified:** arbitrary malformed calls to low-level numeric
helpers outside the validated canonical path; those helpers are not all runtime
input validators. Values beyond the existing decimal/arithmetic range are rejected,
not supported through arbitrary-precision scoring. Complete ties inherit stable
input order rather than a new explicit identity key; cross-runtime collation
differences are not separately certified. No visual browser exercise was needed
to establish calculation/display separation.

**Provider/live limitations:** no fresh Xero/Test or Production live-data
reconciliation, hosted migration verification or deployed-version verification.
This phase certifies the local working tree with synthetic accounting inputs.
Phase 1's credit-currency/overdue and Promise lifecycle boundaries remain intact.

Phase 1 was already uncommitted when this phase began and remains preserved.
Phase 2 is also uncommitted. Nothing was pushed or deployed; `main` and hosted
systems were not modified.

# O. Phase 2 conclusion

The prioritisation mathematics are sufficiently certified, within the validated
canonical-input contract and stated limits, to proceed to cross-feature interaction
regression. Phase 3 was not implemented. The earlier Phase 1 accounting foundation
was reused and regression-tested, not redesigned.
