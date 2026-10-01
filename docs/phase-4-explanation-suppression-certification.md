# Phase 4 — Explanation, suppression and legacy-path certification

## A. Phase 4 verdict

CERTIFIED WITH BOUNDED LIMITATIONS. This phase exercises production calculations, routes and React consumers with deterministic fixtures, plus the persisted queue RPC in a disposable local database. Hosted Preview, provider-backed data and a real browser session are outside this execution. Accounting, scoring weights, benchmark policy and queue policy are unchanged.

## B. Starting checkpoint

- Branch: `develop`.
- Starting commit: `1e0dd6d9a4ad1c21e0945fe55895b474f22d2c8c` (`test: certify cross-feature scoring interactions`).
- Starting working tree: clean. Phases 1–3 were already committed.
- Phase 4 remains local and uncommitted. No push, main update, hosted migration or deployment.

## C. Explanation architecture

The bounded path is `resolveXeroAuthoritativeSnapshot` / `applyXeroAuthoritativeSnapshot` in `lib/xero/authoritative-snapshot.ts` → `loadCustomerCollectionsSummaryWithMetadata` in `lib/collections/customer-summary.ts` → `deriveInvoiceActionability` and `deriveCustomerCreditActionability` → Actions `GET` in `app/api/collections/actions/route.ts` → `prioritiseCustomer` in `lib/collections/prioritization.ts` → `resolveQueueEligibility` → Actions DTO → `CollectionActionsClient` / `FirstValueResultView`.

| Representation | Source and classification |
| --- | --- |
| Component, base and final scores; diagnostic lines | A: scorer's actual local components and inputs; API copies results. No persisted score cache. |
| Main priority reason | C/D: `buildReason` reuses the same component helpers and normalization context, then selects the two largest weighted contributions and categorical language. |
| First-value reasons | B/D: `buildFirstValueReasons` consumes the scored row and approved weights, chooses strongest contributions and formats them. |
| To chase and currency labels | A/D: canonical post-credit customer amount, formatted for display. Invoice currency detail is not presented as post-credit customer allocation. |
| Historical timing/current age/relative lateness | A/D: summary values rendered through `payment-behavior-copy.ts`; separate from the Payment recency signal. |
| Founder explanation | B/D: `base_score`, multiplier and final score plus `founder-context.ts` labels/consequences. |
| Eligibility and deferred copy | A/D: `loadLatestQueueActions` → `latest_collection_queue_actions` RPC → `resolveQueueEligibility`, queue metadata, UI status/date formatting. |

`first_value_reasons` is an explanation list, not another score assembly. The consuming clients do not recompute or sort priority scores.

## D. Exposure explanation fidelity

The combined fixture has £1,000 gross, £200 dispute, £300 effective Promise, £500 invoice actionability and £150 credit. Both API and UI expose **£350 To chase**, with Exposure 58⅓ against a £600 maximum. Diagnostic amounts now explicitly say overdue To chase instead of overdue AR. The explanation's comparison is the portfolio, which includes deferred/Do not chase monetary members under existing policy.

£999.60 versus £1,000 produces equal displayed final scores but distinct exact amounts. The smaller customer is no longer falsely described as the largest: the previous 99.95% narrative threshold has been removed. Server ordering remains score, exact To chase, then case-insensitive customer name, with Do not chase last. No tie rule changed.

## E. Urgency explanation fidelity

£100 at 100 days plus £900 at 10 days displays the certified weighted age **19 days**, with invoice bonus 5. £800 customer credit leaves that age and Urgency unchanged. Suppressing the old invoice changes age to **10 days** and bonus to 0.

Diagnostics retain the actual customer age, portfolio mean/max and invoice bonus. They now disclose the cap: `100.0 + invoice bonus 5, cap 100 -> 100.0`. The fractional-score regression retains 72.5; no integer-rounded narrative value enters the composite. Descriptions such as materially/heavily aged remain categorical scorer explanations, not newly introduced absolute-day thresholds.

## F. Relative deterioration explanation fidelity

Fixtures distinguish improving (10 current versus 20 historical), normal (10 versus 10), exactly the three-day floor (13 versus 10), above floor (14 versus 10), strongly deteriorating (40 versus 10), and only two qualifying historical invoices. Expected scores are respectively 0, 0, 0, 100/27, 100 and 0 in the tested portfolios.

The customer timing copy distinguishes earlier/about the same/later/not enough history. The breakdown names the deterioration input; sparse history explicitly says there is insufficient recent history. Zero-contribution cases do not acquire a first-value deterioration reason.

## G. Payment recency explanation fidelity

Canonical payment dates exercise days 0, 1, 7, 8, 14, 15, 30, 31, 45, 46, 60, 61 and 365. Exposed recency scores match 0, 10, 10, 20, 20, 40, 40, 60, 60, 80, 80, 100 and 100. No history is explicitly identified and contributes 100 under existing policy.

`computeBehaviourScore`, `computeBehaviourComponents`, `weights.behaviour` and related local variable names remain harmless internal identifiers. User-facing diagnostics say Payment recency. The Customers table's broader Payment behaviour heading describes historical median/current age/relative lateness, not the recency component. Educational historical-behaviour copy has the same distinction.

## H. Composite / founder-override fidelity

The diagnostic weights remain **50/25/15/10**. Corrections remove an erroneous displayed `/100` before decimal weights: a component of 100 × 0.50 contributes 50 points. Approximation markers and a rounding note distinguish formatted components from calculation precision.

Unrounded components form the weighted composite; base is rounded to one decimal, founder multiplier applies to that base, and final rounds to one decimal. UI displays the final `priority_score` to one decimal. With base 100, Safe/Normal/Priority/Do not chase produce **40/100/160/0**. With the changing-payment fixture's base 90 they produce **36/90/144/0**. Diagnostics disclose base, multiplier and final separately. No fifth signal or display feedback was introduced.

## I. Suppression and queue-eligibility certification

Single-customer £100, 30-day overdue, no qualifying payment history unless paid:

| State | To chase | Base / final | Active queue | API/state and explanation |
| --- | ---: | --- | --- | --- |
| Positive actionable / follow-up due | 100 | 85 / 85 | Yes | `eligible`; current scorer reason |
| Fully paid, same-day payment | 0 | 0 / 0 in all-customer diagnostic read | No | No action; no overdue amount to chase |
| Fully disputed | 0 | Not scored in active path | No | Excluded; no overdue amount to chase, gross debt still 100 |
| Fully promised | 0 | Not scored in active path | No | Excluded; same truthful empty status |
| Fully credit-covered | 0 | Not scored in monetary path | No | Excluded; invoice ageing remains in reference population |
| Do not chase | 100 | 85 / 0 | No | Diagnostic API row retained; `do_not_chase`, Never chase reason |
| Future V1 follow-up | 100 | 85 / 85 internally | No | Row excluded; `suppressedCustomerCount=1`, next return date exposed |

Deferral does not remove monetary benchmark membership or modify accounting/base score. A due follow-up restores eligibility on the next current read. Full suppression does not invent zero component outputs for customers deliberately excluded before scoring.

## J. Zero-actionability / stale-state results

The real React Actions client consumes real fixture API responses through a mocked network transport. The journey checks amounts, all server score fields, reason, every diagnostic line, table ordering and removal/restoration through dispute → Promise → credit → payment → dispute resolution → Promise cancellation → full credit → credit removal → overrides → follow-up → due-date return. Repeated reads are identical.

A controlled race first captures a positive-debt response, applies full credit, lets the newer response remove the row, then releases the old response. Before correction, the old response resurrected the customer. A monotonically increasing request token now prevents stale responses, stale errors and stale loading completion from overwriting the current result; effect cleanup invalidates requests on scope change/unmount.

## K. Legacy scoring-path audit

| Finding | Classification / consequence |
| --- | --- |
| Actions `GET` calling `prioritiseCustomer` | Live authoritative connected-product path. |
| `lib/credit-control-playbook.ts` | Live synthetic educational adapter; delegates to the same scorer. Its separate display sort acts only on fictional examples, not canonical customers. |
| `buildReason` recomputation | Live explanation helper reusing certified component functions, not a competing scorer. |
| First-value weighted contribution sorting | Live explanation selection, not customer scoring/ranking. |
| Customers/worklist sort helpers | Live user-selected amount/age/name ordering for other screens, not Actions priority ordering. |
| `behaviour` identifiers | Harmless internal names for the current recency component. |
| Historical documentation/test fixtures | Evidence rather than production paths. The frozen pre-dispute fixture's narrative was updated; all numerical expectations remain intact. |

Targeted searches found no active 50/35/15 assembly, obsolete multiplier, generic-behaviour scorer, client-side score assembly or duplicate connected-customer prioritiser. A durable caller-inventory guard allows only the scorer definition, Actions route and delegated playbook. **No alternative live customer scorer was found.**

## L. Legacy actionability-path audit

`collectible_*` summary/API fields remain compatibility aliases for defined invoice-level values. Prioritisation explicitly receives `customer_to_chase_overdue_base`; weighted age explicitly receives invoice actionability. `deriveInvoiceDispute` is a stage inside `deriveInvoiceActionability`, which also applies Promise coverage, not a competing live customer-total calculation. Customer credit remains customer-level.

Both customer-summary routes share the summary loader. Invoice/dispute/worklist views use `deriveInvoiceActionability`. Canonical/raw inspection screens show provider evidence and do not supply Actions ranking.

The authoritative snapshot resolver retains supported `legacy` null-generation selection when no active generation exists. This selects a source snapshot for the same calculation; invalid active state throws rather than falling back. It is not obsolete arithmetic. Credit readiness and exact-value evidence remain enforced by the summary loader.

`collection_actions` retains legacy contact outcomes and postponed dates; only approved eligibility logic consumes them. A legacy `promised_to_pay` outcome with a future date is not an invoice Promise or future deferral by itself. Local schema checks found no persisted base/final/priority score or To chase fields on the current customer/action/override records that could override the scorer. Injecting obsolete stored-looking values into fixture records leaves money, scores, reasons and ordering unchanged. **No reachable alternative customer monetary calculation was found.**

## M. Legacy explanation/copy findings

- Harmless internal terminology: `collectible_*`, `computeBehaviour*`, `weights.behaviour`, legacy contact enums. Preserved.
- Developer-only terminology: historical fixture/docs and comments describing earlier names. Preserved unless a test explicitly needed current explanation expectations; no numerical baseline was relaxed.
- Misleading visible terminology corrected: overdue AR used for net To chase, current queue used for a broader benchmark population, near-largest stated as largest, unexplained urgency capping/scaling, obsolete collectible labels, and empty/resolved states implying gross debt had vanished or all restored debt was necessarily actionable.

## N. API/UI consistency results

Tests compare scorer observations to Actions fields, then render `CollectionActionsClient` and `FirstValueResultView`. The API copies all four components, base, final, reason and breakdown unchanged. Net amounts, credit deduction, diagnostic explanations and order agree through lifecycle refreshes. Founder and deferred states remain separate from current economics.

The Actions money display uses two decimal places; first-value summaries and narrative money use whole currency units; age/percentage narrative values are rounded; final score is one decimal. These are display conventions only. The new diagnostics disclose rounding and the near-tie test prevents rounded comparisons from inventing a largest-customer claim.

## O. Defects found and corrections

1. **High — stale queue response resurrected a covered customer.** Missing request sequencing in `CollectionActionsClient.tsx`. Added latest-request guards and cleanup invalidation. Reproduced before correction and covered by the held-response regression plus the rendered transition journey.
2. **Medium — misleading diagnostic arithmetic.** `prioritization.ts` printed an extra `/100`, omitted urgency capping, integer-rounded urgency and printed zero division for an empty benchmark. Corrected explanation construction only; component/formula outputs unchanged. Regression checks 100 × 0.50 = 50 points, the urgency cap, zero benchmark and fractional urgency.
3. **Medium — Exposure narrative could identify the wrong amount/population/largest customer.** `prioritization.ts`, `first-value.ts`, Actions route. Corrected To chase/portfolio labels, explanation population count and largest threshold. Covered by £350 net versus £1,000 gross, deferred-reference and £999.60/£1,000 tie fixtures.
4. **Medium — suppression and lifecycle copy contradicted current economics.** `FirstValueResultView.tsx`, `CollectionActionsClient.tsx`, `CustomerInvoiceDisputes.tsx`, `CustomerCollectionsClient.tsx`, `DisputesClient.tsx`. Corrected no-amount-to-chase language and obsolete collectible wording; dispute resolution no longer asserts that debt must be actionable. Covered by suppression matrix, rendered journey and focused legacy-copy guard.

No scoring, accounting, lifecycle, benchmark, multiplier or queue policy changed. No migrations or environment-variable names were added or changed.

## P. Tests executed

| Command | Result |
| --- | --- |
| `node --test tests/xero/explanation-suppression-certification.test.mjs tests/xero/first-value-result.test.mjs` | 35 passed, 0 failed, including 25 Phase 4 cases/subtests. |
| `node --test tests/xero/disputes-journeys.test.mjs tests/xero/promise-collections-integration.test.mjs tests/xero/collections-queue-status.test.mjs` | 63 passed, 0 failed. |
| `RUN_SUPABASE_INTEGRATION=1 node --test tests/database/queue-fidelity.integration.test.mjs` | 3 passed, 0 failed; disposable local database removed. |
| `RUN_SUPABASE_INTEGRATION=1 node --test tests/database/invoice-disputes.integration.test.mjs tests/database/invoice-promises.integration.test.mjs tests/database/promise-reconciliation.integration.test.mjs` | 54 passed, 0 failed; disposable local databases removed. |
| `pnpm test` | 1,339 total: 1,213 passed, 0 failed, 126 opt-in database skips. Includes Phase 1 accounting, Phase 2 mathematics/queue, Phase 3 interactions, Phase 4 fidelity, API/action/history/eligibility, disputes, Promises, credit and multicurrency suites. The 57 database checks above ran separately; the other opt-in database suites were not executed in this phase. |
| `pnpm lint` | Passed, no warnings. |
| `pnpm typecheck` | Passed, including after the final build. |
| `pnpm build` | Passed; existing Node `module.register()` deprecation notice only. |
| `pnpm security:sqlcheck` | Passed. |
| `git diff --check` | Passed. |

Pre-fix Phase 4 run: 23 counted tests, 13 passed and 10 failed (including aggregate/subtest failures). The first broader run found three stale-copy expectation failures; they were corrected without changing frozen monetary/scoring expectations. A separate structural comparison against `HEAD` confirms that all non-explanation baseline contract values are unchanged. No unrelated failing tests remain.

## Q. Bounded limitations

- Automated: deterministic production summary/scorer/route/React paths are covered; fake storage/network surrounds server routes. Promise persistence in the API journey is emulated around the production command planner, not claimed as a full real-database HTTP journey.
- Database-backed: actual migrations, persisted latest-action RPC, identity boundaries, permissions, due-date decisions and existing dispute/Promise/reconciliation regression suites run in disposable local Docker databases. No hosted schema/history claim is made.
- Browser/UI: real React DOM and server rendering under JSDOM, with router/peripheral component mocks. No real-browser visual/layout/accessibility or deployed navigation certification. Due follow-ups are checked on refresh; no new background timer policy was introduced.
- Provider/live: no Xero-connected hosted account, live credit stream, provider webhook timing, Preview deployment or Production was exercised. Existing automated multicurrency and previous-phase suites remain regression protection.

## R. Phase 4 conclusion

Within these boundaries, explanation, suppression, queue eligibility and reachable legacy-path behaviour are sufficiently certified to proceed to final hosted Test/Preview certification. That hosted phase is not implemented here.
