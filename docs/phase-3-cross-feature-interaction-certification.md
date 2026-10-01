# A. Phase 3 verdict

**CERTIFIED WITH BOUNDED LIMITATIONS.** Deterministic production-path interaction
journeys pass, including repeated state transitions, portfolio-wide recalculation,
operational deferral, zero crossings and scoped identities. No production defect
was found. Database persistence/reconciliation has separate local integration
evidence; the complete journey uses mocked database transport and synthetic data.

# B. Starting checkpoint

- Branch: `develop`.
- Starting commit: `c1d5deb8fe884fd68f66b2231b17b4aebbfc8138`.
- Starting working tree: clean; local branch tracked `origin/develop` without divergence.
- Phases 1/2 were committed together as `test: certify actionability and scoring correctness`.
- Phase 3 changes remain uncommitted. Nothing was pushed or deployed; `main` and
  hosted systems were not changed.

# C. Interaction-path preflight

The existing production path remains:

1. `resolveXeroAuthoritativeSnapshot` / `applyXeroAuthoritativeSnapshot` in
   `lib/xero/authoritative-snapshot.ts` hold the generation.
2. `deriveInvoiceActionability` in `lib/collections/invoice-actionability.ts`
   derives dispute and Active Promise coverage.
3. `loadCustomerCollectionsSummaryWithMetadata` in
   `lib/collections/customer-summary.ts` aggregates invoices and applies certified
   customer credit through `deriveCustomerCreditActionability` in
   `lib/collections/customer-credit-actionability.ts`.
4. Actions `GET` in `app/api/collections/actions/route.ts` constructs monetary,
   ageing and relative-deterioration benchmarks, then calls `prioritiseCustomer`
   in `lib/collections/prioritization.ts` with the unchanged 50/25/15/10 weights.
5. `loadLatestQueueActions` calls `latest_collection_queue_actions`; the route
   applies `resolveQueueEligibility`, and the active selector uses
   `isEligibleActiveQueueRow` in `lib/collections/queue-eligibility.ts`.

The test observer captures production scorer inputs and its actual returned
result, including scores calculated before operational deferral removes a row.
No alternate scorer or actionability formula was introduced.

# D. Dispute lifecycle interactions

The golden customer has £900 at 60 days and £100 at 10 days, with three historical
paid invoices establishing a ten-day median. Baker has £600 at 30 days; Cedar has
£300 at 15 days.

Dispute transitions are none → £200 → £500 → £100 → resolved → reactivated → full.
Customer To chase is respectively £1,000 / £800 / £500 / £900 / £1,000 / £900 / £100.
Weighted age is 55 / 53.75 / 50 / 490÷9 / 55 / 490÷9 / 10 days. Full suppression
of the older invoice reduces the actionable count from two to one and relative
deterioration from 45 days to zero. Payment recency remains 100 throughout.

Explicit assertions cover invoice/customer money, age, benchmark totals/mean/max,
all component scores, base/final scores and active ordering after every state.
One durable dispute row advances revisions; old resolution metadata contributes
no extra suppression. All pass.

# E. Promise lifecycle interactions

Production `planPromiseMutation` creates/cancels/edits commitments;
`qualifyPromisePayments` and `resolvePromiseOutcome` determine paid coverage and
terminal outcomes. Persistence of those decisions is emulated in journey fixtures;
actual atomic commands/promotion are covered separately by local database tests.

An Active £300 commitment produces £700 To chase. A qualifying £200 payment changes
provider AmountDue to £700 on the older invoice and remaining commitment to £100;
customer To chase stays £700. Recency changes from 100 to zero. Cancellation
restores £800 To chase; a new £100 commitment restores £700. The new commitment's
creation baseline includes the existing payment, preventing its reuse.

An elapsed deadline alone leaves Active coverage intact. A subsequent complete
observation resolves Missed and removes coverage. A qualifying £300 payment
resolves Kept and leaves the current provider balance actionable. Terminal
commitments reject cancellation; retained terminal notes/events do not change
scorer inputs. All pass.

# F. Customer-credit interactions

Credit £0 → £800 → £1,000 → £1,000,000 → £800 → £0 produces customer To chase
£1,000 → £200 → £0 → £0 → £200 → £1,000. Weighted age stays 55 and current relative
deterioration stays 45 days. Excess credit produces identical remaining scorer
inputs and results to exact coverage.

The credit-covered customer leaves monetary scoring and the active queue while
its invoice ageing/deterioration reference remains. Separate dispute/credit and
Promise/credit journeys verify that fully covering one invoice changes invoice
weights, whereas covering the customer remainder does not. Terminal Promise or
resolved dispute restores actionability with credit still applied once.

# G. Combined dispute + Promise + credit + payment journey

Amounts are GBP. AmountDue is total current customer debt; the younger invoice
remains £100 throughout. D/P are effective suppression, not recorded commitments.
E/U/R/P are Exposure/Urgency/Relative deterioration/Payment recency. Normal founder
multiplier is 1.0. Scores shown with ellipses are asserted with rational expectations
within eight machine epsilons; monetary values and rounded scores use exact assertions.

| State | AmountDue | Dispute | Promise | Invoice actionability | Credit | To chase | Weighted age | E/U/R/P | Base | Final | Active rank/order |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | ---: | ---: | --- |
| A: ordinary debt | 1,000 | 0 | 0 | 1,000 | 0 | 1,000 | 55 | 100/100/100/100 | 100 | 100 | 1; Acme, Baker, Cedar |
| B: dispute £200 | 1,000 | 200 | 0 | 800 | 0 | 800 | 53.75 | 100/100/100/100 | 100 | 100 | 1; Acme, Baker, Cedar |
| C: Promise £300 | 1,000 | 200 | 300 | 500 | 0 | 500 | 50 | 83.333…/100/100/100 | 91.7 | 91.7 | 1; Acme, Baker, Cedar |
| D: credit £150 | 1,000 | 200 | 300 | 500 | 150 | 350 | 50 | 58.333…/100/100/100 | 79.2 | 79.2 | 1; Acme, Baker, Cedar |
| E: qualifying payment £200 | 800 | 200 | 100 | 500 | 150 | 350 | 50 | 58.333…/100/100/0 | 69.2 | 69.2 | 2; Baker, Acme, Cedar |
| F: dispute resolved | 800 | 0 | 100 | 700 | 150 | 550 | 370÷7 | 91.666…/100/100/0 | 85.8 | 85.8 | 1; Acme, Baker, Cedar |
| G: Promise cancelled | 800 | 0 | 0 | 800 | 150 | 650 | 53.75 | 100/100/100/0 | 90 | 90 | 1; Acme, Baker, Cedar |
| H: credit £800 | 800 | 0 | 0 | 800 | 800 | 0 | 53.75 | Not scored | — | — | Excluded; Baker, Cedar |

For example, E reconciles £700 old AmountDue − £200 dispute − (£300 commitment
− £200 qualifying paid) = £400 old actionable, plus £100 young = £500 invoice
actionability, minus £150 credit = £350 To chase. The payment is not deducted again.
Each A–H state is read four times, asserting identical complete returned state
and unchanged backing tables.

# H. Portfolio / benchmark interactions

Changing Acme's older-invoice dispute from zero to £500 changes the portfolio
monetary total £1,900 → £1,400, maximum customer £1,000 → £600 and weighted mean
775÷19 → 475÷14 days. Untouched Baker's E/U changes 60/36.774… → 100/44.2105…;
base score changes 49.2 → 71.1. Its own £600 and 30-day age remain unchanged.

In a five-customer portfolio at ages 25/30/35/40/45 with historical medians zero,
credit-covering the oldest customer retains the five-observation P50=35/P90=43
context and 35-day weighted mean. Fully promising that invoice then removes its
ageing evidence: four observations use fallback anchors 16.5/30 and mean 32.5.
The unchanged 25-day customer's score rises 74.1 → 81.8. Cancellation exactly
restores the earlier scorer inputs. Deferring another customer changes queue
membership while all scorer inputs and benchmarks remain unchanged.

# I. Action History / eligibility interactions

The production authenticated `createActionHistory` / `readLatestActionHistory`
workflow records and reads a future-dated follow-up. Replaying its stable action
ID creates no second row. Acme disappears operationally while its accounting,
all captured scorer inputs/results and portfolio values remain identical.

At the return-date boundary, Acme returns. Comparison against the same evaluation
time without the event proves the score is identical. This comparison permits
ordinary invoice ageing across midnight; it does not incorrectly freeze dates.
A previously created, now-due `reviewed_no_chase` event is retained as history and
has no current scoring or queue effect. New V1 follow-ups must be future-dated;
no unsupported history-only action type or same-day creation policy was invented.

# J. Founder-override interactions

Safe, Priority and Do not chase each run through ordinary debt, dispute+Promise,
credit and payment states. Underlying base scores are 100 / 91.7 / 79.2 / 69.2.

| Override | Expected and actual final scores |
| --- | --- |
| Safe | 40 / 36.7 / 31.7 / 27.7 |
| Priority | 160 / 146.7 / 126.7 / 110.7 |
| Do not chase | 0 / 0 / 0 / 0 |

All pass. Active ordering changes with the adjusted scores. Do not chase keeps
recalculated accounting and base-score diagnostics and remains excluded from the
active selector. No multiplier or application order changed.

# K. Zero-crossing / idempotency results

Positive → zero → positive transitions pass for full dispute/resolution, full
Promise/cancellation, credit coverage/removal and provider payment/reopening.
A £0.000000000000000001 balance remains actionable, crosses zero under exact
credit and returns after credit removal. No stale/missing active row, negative
amount, NaN or Infinity appears.

Full invoice suppression removes invoice ageing evidence; full customer-credit
coverage retains it. Repeated production-path reads are identical and do not
consume dispute coverage, Promise coverage or credit.

Payments below recorded dispute/Promise/combined coverage pass for dispute only,
Promise only, both, credit only and all three. A newly observed payment dated
before Promise creation changes AmountDue and canonical recency without
satisfying the later commitment; coverage caps against the new balance.

# L. Isolation results

The combined dispute+Promise+credit+payment state is unchanged after inserting
colliding foreign owner, tenant and provider identifiers across organisations,
customers, invoices, payments, disputes, Promises, credit and Action History.
Retained old accounting generations coexist with the held promoted generation.
An owned dispute mutation leaves foreign colliding records unchanged.

Applying a dispute and Promise to Baker changes only Baker's economics; Acme's
money remains unchanged while portfolio-dependent scoring may legitimately change.
Local database suites independently verify persistence ownership, immutable
history, unique Active commitments, invoice uniqueness and concurrent revision guards.

# M. Golden regression scenarios retained

`tests/xero/cross-feature-interaction-certification.test.mjs` retains 15 top-level
scenarios (28 test results including subcases), including:

- Dispute creation/edit/resolution/reactivation/full suppression.
- Promise paid coverage, terminal history and subsequent commitment.
- Customer-credit zero/excess coverage and restoration.
- Complete A–H dispute+Promise+credit+payment journey with repeated reads.
- Overlapping invoice suppression and each credit pairing.
- Payment-under-coverage matrix and evidence-driven terminal lifecycle.
- Multi-invoice weighting and uncapped invoice-count bonus changes.
- Five-customer benchmark/ranking changes and restoration.
- Actual Action History server workflow with score invariance and expiry.
- Founder interaction matrix, tiny/ordinary zero crossings and scoped collisions.

`tests/xero/test-helpers/interaction-journey-fixture.mjs` provides synthetic
transport/state transitions while delegating monetary/scoring/lifecycle decisions
to production functions. The existing dispute journey observer additionally
captures actual scorer results. Phase 1/2 tests and reports are preserved.

# N. Defects found and corrections

**None.** No production files changed. During fixture development, a numeric
Promise revision conversion, unsupported same-day Action History creation and
two hand-calculated order expectations were corrected in test code. These were
fixture/oracle issues, not production defects or policy changes.

No migrations or environment-variable names were added or changed.

# O. Tests executed

| Command | Result |
| --- | --- |
| `node --test tests/xero/cross-feature-interaction-certification.test.mjs` | 28 passed, 0 failed |
| `node --test tests/xero/cross-feature-interaction-certification.test.mjs tests/xero/accounting-actionability-certification.test.mjs tests/xero/scoring-mathematics-certification.test.mjs tests/xero/scoring-queue-certification.test.mjs` | 89 passed, 0 failed |
| `RUN_SUPABASE_INTEGRATION=1 node --test tests/database/accounting-evidence.integration.test.mjs tests/database/invoice-disputes.integration.test.mjs tests/database/invoice-promises.integration.test.mjs tests/database/invoice-promises-server.integration.test.mjs tests/database/promise-reconciliation.integration.test.mjs` | 99 passed, 0 failed, 0 skipped |
| `pnpm test` | 1,311 tests: 1,188 passed, 0 failed, 123 opt-in integration skips |
| `pnpm lint` | Passed |
| `pnpm typecheck` | Passed |
| `pnpm build` | Passed; 97 pages generated |
| `pnpm security:sqlcheck` | Passed |
| `git diff --check` | Passed |

The full suite includes disputes, Promise, credit, Action History, customer
history, prioritisation, queue eligibility, score invariance and multi-currency
regressions. The first database attempt could not access the Docker socket in
the sandbox; the authorized local rerun passed all 99 tests. No unrelated test
failures remain. The build emits the existing Node `module.register()` deprecation
warning.

# P. Bounded limitations

**Automated interaction certification:** real production calculations, customer
and invoice routes, Actions benchmark/scoring/ranking and Action History server
workflow, with deterministic GBP invoices and mocked database/auth transport.
Expected arithmetic is explicit; the tests do not contain a replacement scorer.
Other currencies remain covered by the existing regression suites.

**Database-backed certification:** 99 tests against disposable databases in the
local Supabase Docker container, replaying the repository migrations. These prove
real persistence, revisions, isolation, reconciliation, concurrent commands and
rollback boundaries. The complete A–H route journey is not one fully database-backed
browser/Xero sync session. Its Promise persistence and latest-action RPC transport
are emulated; those journey assertions alone are not SQL atomicity evidence.

**Provider/live limitations:** no fresh Xero-backed Test data, hosted reconciliation,
deployed-version or browser certification was performed. No hosted schema was
modified. This bounded phase does not re-certify every possible concurrent or
malformed provider event sequence or extend the existing numeric contract.

# Q. Phase 3 conclusion

Within these boundaries, integrated current product behaviour is sufficiently
certified to proceed to explanation/suppression/legacy-path regression. Phase 4
was not implemented. Approved accounting, scoring, lifecycle and queue policies
remain unchanged.
