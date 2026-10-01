# A. Phase 1 verdict

**CERTIFIED WITH BOUNDED LIMITATIONS.** Certified on 2026-10-01 against `develop`
at `92d34c4` plus the uncommitted changes in this phase. The production calculation
passes deterministic monetary fixtures and local PostgreSQL contract tests after
one provider-isolation correction. This is automated fixture certification, not a
new live Xero/Test or deployed Production certification.

# B. Canonical-path preflight

The targeted delta check found one live customer actionability/scoring path:

| Stage | Authoritative file/function or database object |
| --- | --- |
| Provider mapping | `lib/xero/canonical-mapper.ts`: `buildXeroCanonicalRows` |
| Held generation | `lib/xero/authoritative-snapshot.ts`: `resolveXeroAuthoritativeSnapshot`, `applyXeroAuthoritativeSnapshot` |
| Invoice waterfall | `lib/collections/invoice-actionability.ts`: `deriveInvoiceActionability`; delegates to `deriveInvoiceDispute` in `invoice-disputes.ts` and `deriveInvoicePromise` in `invoice-promises.ts` |
| Operational Promise read | `lib/collections/invoice-promises-loading.ts`: `loadActiveInvoicePromises`, `assertInvoicePromiseSnapshotCurrent` |
| Customer aggregation | `lib/collections/customer-summary.ts`: `loadCustomerCollectionsSummaryWithMetadata`, `fetchHeldCustomerCredit` |
| Customer credit | `lib/collections/customer-credit-actionability.ts`: `deriveCustomerCreditActionability`; reads `xero_customer_credit_validations` and `canonical_customer_credit_evidence_exact` |
| Prioritisation | `app/api/collections/actions/route.ts`: `GET`; `lib/collections/prioritization.ts`: `prioritiseCustomer` |
| Action History | `lib/collections/action-history-server.ts`: `createActionHistory`; `action-history-queue-server.ts`: `loadLatestQueueActions`; RPC `latest_collection_queue_actions`; `queue-eligibility.ts`: `resolveQueueEligibility` |

No competing live monetary calculation was introduced by Promise, credit or Action
History work. Customer scoped refreshes use the same summary; invoice UI and
Disputes worklist use the same invoice domain. The public playbook uses synthetic
examples, not a second customer accounting path.

Weights remain Exposure **50%**, Urgency **25%**, Relative deterioration **15%**,
Payment recency **10%** (`PRIORITIZATION_CONFIG.weights`; recency retains the
internal name `behaviour`). No scoring weights or signals were changed.

State-changing boundaries remain separate from calculation: disputes use their
revision-safe server operations/`apply_invoice_disputes_bulk_full`; Promise
promotion uses `prepare_invoice_promise_reconciliation` and
`promote_xero_sync_run_with_promises`; credit evidence uses
`persist_xero_accounting_evidence`, `persist_xero_credit_note_evidence` and
`record_xero_customer_credit_stability_validation`. Generic Action History writes
only `collection_actions`. Its queue RPC supplies eligibility metadata after
accounting benchmarks and scores have been calculated.

# C. Certified accounting waterfall

1. Use current canonical `amount_due_native` and validated `amount_due_base` from
   one authoritative owner/tenant/provider/generation. AmountDue already reflects
   provider payments and allocations; do not subtract AmountPaid again. Paid or
   non-open receivables contribute no actionability.
2. Effective dispute: inactive = zero; full = current outstanding; partial = the
   lesser of recorded disputed amount and current outstanding.
3. Active Promise suppression = the lesser of post-dispute debt and the positive
   remainder of fixed commitment minus certified qualifying payments. Terminal
   `kept`, `missed`, `unclear`, `cancelled` states supply zero suppression.
4. Sum exact invoice To chase in organisation base currency into customer totals.
   Overdue amounts and weighted age use the overdue invoice population.
5. With a valid held-generation credit certificate, sum eligible residual
   RECEIVE-OVERPAYMENT, RECEIVE-PREPAYMENT and authorised ACCRECCREDIT sources per
   customer. Deduct once from **overdue** customer actionability, capped at that
   actionability. Retain excess separately.
6. `customer_to_chase_overdue_base_decimal` is final customer To chase for Exposure,
   monetary benchmarks and actionable queue eligibility. It cannot be negative.

Two approved details are more specific than the conceptual shorthand: credit
does not reduce future invoice amounts, and a passed Promise deadline alone does
not expire an operationally Active commitment. Certified reconciliation changes
that state. There is no separate `expired` status. Neither behaviour was redesigned.

Credit is not allocated to invoices or included in weighted age. Existing
`to_chase_*`/`collectible_*` compatibility fields retain invoice-derived pre-credit
meaning. Native currency subtotals remain separate. Foreign conversion uses
native / Xero rate, rounded to eight decimal places. Suppression components use
remainders so they reconcile to canonical gross base, avoiding independent
rounding drift. Exact decimal text is preserved until the scoring number boundary.

# D. Regression cases

All amounts below are GBP/base unless marked native. Actual values are exact
decimal assertions, not tolerance comparisons. Baseline fixtures pass through
the production Xero mapper, invoice domain, summary and Actions route.

| Scenario | Inputs/states | Expected customer To chase | Actual | Result |
| --- | --- | --- | --- | --- |
| Unpaid | Due 1,000 | 1,000 | 1,000 | Pass |
| Multiple unpaid | 1,000 + 250 | 1,250 | 1,250 | Pass |
| Partial payment | Total 1,000; paid 300; due 700 | 700 | 700 | Pass |
| Fully paid | Paid 1,000; due 0; PAID | 0 | 0 | Pass |
| Paid + unpaid | 0 + 250 | 250 | 250 | Pass |
| Zero open balance | AUTHORISED; due 0 | 0 | 0 | Pass |
| Near zero | Due 0.000000000000000001 | Same positive value | Same | Pass |
| Full dispute | Due 1,000; full active dispute | 0 | 0 | Pass |
| Partial dispute | Due 1,000; dispute 200 | 800 | 800 | Pass |
| Resolve/reactivate | Due 1,000; recorded dispute 600 | 1,000 / 400 | 1,000 / 400 | Pass |
| Payment after dispute | Due falls to 400; recorded dispute 600 | 0; effective dispute 400 | Exact match | Pass |
| Partial/full Promise | Due 1,000; active 300 / 1,000 | 700 / 0 | 700 / 0 | Pass |
| Promise after partial payment | Due 700; commitment 500; qualifying paid 300 | 500; coverage 200 | Exact match | Pass |
| Promise terminal states | Due 700; kept/missed/unclear/cancelled | 700 each | 700 each | Pass |
| Retained Promise history | Due 700; terminal history + new active 100 | 600 | 600 | Pass |
| Elapsed Active deadline | Due 700; remaining commitment 200; status still active | 500 under approved contract | 500 | Pass |
| Each credit source | Due 1,000; eligible residual 300 | 700 | 700 | Pass |
| Three credit sources | Due 1,000; residuals 100 + 200 + 300 | 400 | 400 | Pass |
| Zero/equal/excess credit | Due 1,000; credit 0 / 1,000 / 1,200 | 1,000 / 0 / 0; excess 200 last case | Exact match | Pass |
| A: dispute + Promise | 1,000 − 200 − 300 | 500 | 500 | Pass |
| B: dispute + credit | 1,000 − 200 − 150 | 650 | 650 | Pass |
| C: Promise + credit | 1,000 − 300 − 150 | 550 | 550 | Pass |
| D: all three | 1,000 − 200 − 300 − 150 | 350 | 350 | Pass |
| E: collectively covered | 1,000 − 200 − 700; credit 150 | 0; applied 100; excess 50 | Exact match | Pass |
| Overlapping coverage | Due 1,000; dispute 800; Promise 700; credit 150 | 0; Promise capped at 200 | Exact match | Pass |
| Selected invoices/customer mapping | Acme 1,000 + 400 + paid 0; disputes 200 + 100; Promise 300; credit 150 | 650 | 650 | Pass |
| Separate customer | Baker due 700; own credit 50 | 650 | 650 | Pass |
| Separate tenant, same IDs | Due 1,400; own credit 150; no own suppression | 1,250 | 1,250 | Pass |
| Provider/generation isolation | Colliding foreign-provider, owner, tenant, old and legacy IDs | Original amounts and recency unchanged | Exact match | Pass |
| Page boundary | 1,001 × 0.01; retained copies; credit 0.01 | Gross 10.01; net 10 | Exact match | Pass |
| Wrong credit types | Ordinary/allocated payments, refunds, receipts, supplier credits | No credit deduction | Exact match | Pass |
| Action History create | Due 1,000; dispute 200; Promise 300; credit 150 | Monetary values and benchmarks unchanged; net 350 | Exact match | Pass |

Existing suites additionally cover gross/To-chase FX health, future debt,
certificate unavailability, duplicate credit evidence, scope mismatches, atomic
Promise resolution and score invariance. New PostgreSQL assertions reject
duplicate current and legacy invoices and prove the combined credit view sums
three residual sources to 600 while keeping payments/allocations/refunds separate.

# E. Reconciliation evidence

Single invoice: **1,000 gross = 200 disputed + 300 promised + 500 invoice To chase**.
Customer: **500 = 150 credit applied + 350 final To chase**. Available credit is
150 and excess is zero.

Multiple invoices: **1,400 gross = (200 + 100) disputed + 300 promised + (500 + 300)
invoice To chase**. **800 pre-credit = 150 applied + 650 final**. The other
customer's 700 − 50 = 650 is separate. Identical IDs in another tenant yield
1,400 − 150 = 1,250, without borrowing first-tenant disputes/Promises.

Zero floor: **1,000 = 200 + 700 + 100**; available credit **150 = 100 applied +
50 excess**; final To chase **0**.

FX: USD 1,000 at rate 3, disputed USD 200 and promised USD 300, plus GBP 100:
**433.33333333 gross = 66.66666666 disputed + 100 promised + 266.66666667 invoice
To chase**. Customer credit is unsupported for that foreign-overdue population,
so no guessed conversion or deduction occurs. Native USD and GBP totals remain
separate. The residual-based split explains the final eight-decimal digit.

# F. Edge-case results

- Paid/zero invoices: zero actionability; partial payments use current AmountDue.
- Full/partial disputes: correct caps, resolution/reactivation and later-payment
  behaviour; no second deduction.
- Promise lifecycle: fixed unpaid commitment, post-dispute cap, all four terminal
  statuses inactive; certified expired-deadline reconciliation covered by the
  existing server and promotion database tests.
- Excess credit: zero floor, explicit applied/excess amounts; no invoice allocation.
- Tiny balances: exact positive values survive aggregation and queue eligibility.
- Mapping/isolation: correct customer and tenant totals, provider filters,
  held-generation selection, pagination, and real database invoice uniqueness.
- Multi-currency: base aggregation, separate native subtotals, exact split
  reconciliation, missing-FX review and unsupported-credit fallback preserved.
- Action History: actual server create through mocked database transport preserves
  all accounting tables, the complete customer summary, portfolio benchmarks and
  score components; only follow-up eligibility changes.

# G. Defects found and corrections

**Medium — missing provider scope in canonical customer summary reads.** The
organisation/customer/invoice/payment loaders filtered owner, tenant and held
generation but omitted provider. Foreign-provider organisation rows could make
the ranking unavailable; foreign invoices or payment IDs could contaminate
aggregation/recency and foreign customers could enter the population.

Correction: four `.eq('source_system', 'xero')` filters in
`lib/collections/customer-summary.ts`. No formula or product-policy change.
`accounting-actionability-certification.test.mjs` covers each reader independently
and combined customer/tenant/provider/generation collisions. The combined case
failed before the fix and passes afterward.

Older fixtures in `authoritative-snapshot-readers.test.mjs`,
`multicurrency-collections.test.mjs` and `promise-ui-scoped-reads.test.mjs` now
include the database's existing `source_system = xero` default. The journey helper
supports Action History ID uniqueness/timestamps. The accounting database suite
adds credit-view and invoice-uniqueness assertions. No migrations or environment
variables were added or changed.

# H. Tests executed

| Command | Result |
| --- | --- |
| `node --test tests/xero/accounting-actionability-certification.test.mjs` | 38 passed |
| `node --test tests/xero/accounting-actionability-certification.test.mjs tests/xero/authoritative-snapshot-readers.test.mjs tests/xero/multicurrency-collections.test.mjs tests/xero/promise-ui-scoped-reads.test.mjs` | 92 passed |
| `pnpm test` | 1,260 tests: 1,137 passed, 0 failed, 123 opt-in database tests skipped |
| `RUN_SUPABASE_INTEGRATION=1 node --test --test-concurrency=1 tests/database/invoice-disputes.integration.test.mjs tests/database/invoice-promises.integration.test.mjs tests/database/invoice-promises-server.integration.test.mjs tests/database/promise-reconciliation.integration.test.mjs tests/database/accounting-evidence.integration.test.mjs` | Initial combined run: 97 passed, 1 failed in new uniqueness fixture; see correction below |
| `RUN_SUPABASE_INTEGRATION=1 node --test tests/database/accounting-evidence.integration.test.mjs` | Final updated suite: 23 passed, 0 failed |
| `pnpm lint` | Passed |
| `pnpm typecheck` | Passed |
| `pnpm build` | Passed, 97 pages generated; Node module.register deprecation warning only |
| `pnpm security:sqlcheck` | Passed |
| `git diff --check` | Passed |

The initial database uniqueness fixture omitted required currency metadata and
failed before reaching the unique index. It was corrected and rerun successfully.
All 76 other dispute/Promise database tests passed in the combined run; with the
updated 23-test accounting suite, **99 distinct selected database tests passed**.
Initial broad-suite failures from missing provider fields in mocked fixtures were
also corrected and the entire broad suite rerun green. No unrelated existing
failing tests remain in the executed suites. Tests execute unchanged scoring
regressions as safeguards, without recertifying score mathematics here.

# I. Bounded limitations

**Automated fixture certification:** deterministic synthetic provider payloads,
production calculations/routes, mocked database transport, and actual disposable
local PostgreSQL persistence, constraints, exact numeric views and Promise atomic
reconciliation. This includes multi-currency cases unavailable in a live tenant.

**Provider-backed certification:** no fresh live Xero/Test dataset reconciliation
was performed. No claim is made about currently deployed code, hosted migration
state, provider observation freshness or live balances. No hosted mutations,
pushes or deployments occurred; `main` was untouched.

An Active Promise with an elapsed date still suppresses until approved lifecycle
reconciliation. Strict clock-only expiry is not certified. Customer credit is
certified only for the implemented supported base-currency overdue population;
foreign positive overdue debt/credit remains explicitly unsupported and preserves
pre-credit To chase. Missing credit certification remains unavailable, not observed
zero. Generalised foreign-credit netting and future-debt netting are not certified.

The broad suite's opt-in skips were supplemented with the 99 relevant database
tests above; 24 other database cases were not enabled. Production score mathematics,
weights/bonuses and a full interaction-system audit are outside this bounded phase.

# J. Phase 1 conclusion

Under the current approved Promise lifecycle and customer-credit currency/overdue
contracts, the accounting/actionability amounts entering prioritisation are
sufficiently certified to proceed to mathematical scoring correctness testing.
The certification applies to the tested local `develop` working tree, including
the provider-isolation fix. Phase 2 was neither implemented nor proposed.
