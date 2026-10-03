# Reusable portfolio benchmarks and base scores — Phase 3.4

This is a server-only certification path. Existing queue/customer routes remain authoritative and do not import it. Empty new tables have no product effect. No accounting, operational mutation, Xero, entitlement, priority or Action History command changes are made.

## Architecture and identities

```text
Phase 3.3 complete certified customer features, with captured G/F/date/evidence identity
  -> unchanged calculatePortfolioBenchmarks
  -> unchanged calculatePortfolioBaseScores
  -> compact structured customer results + complete benchmark manifest
  -> atomic publication fenced against current authority
  -> reusable manifest / targeted score / bounded complete compact population
  -> (later unit) current priority + Action History projection
```

`lib/collections/portfolio-materialization.ts` adapts existing pure contracts and restores exact structured explanation evidence without recomputing base scores. `lib/collections/portfolio-materialization-server.ts` provides `ensurePortfolioBaseCalculation` and read-only `readPortfolioBaseCalculation`. Calling server boundaries must resolve authenticated ownership and entitlement first; service-role scope parameters do not replace authorization.

Identity includes owner, tenant, provider, G, F, UTC date, basis/feature versions, `collection_scoring_50_25_15_10_v1`, scope `collections`, overdueOnly, `portfolio_base_v1` and consumed credit-certification digest. P is excluded: priority/history/financially irrelevant metadata cannot affect base calculations. Same-G certification changes must invalidate even if F is unchanged. Model/version changes require a new forward migration updating SQL support and constants together, not a commit-SHA key. Unsupported scope/model fails closed.

## Exact populations and dependencies

| Layer | Current authoritative inputs and population |
|---|---|
| Invoice eligibility | Remove actively disputed/promised customers with nonpositive collectible outstanding |
| Invoice scope | Above population; overdueOnly filters positive exact pre-credit invoice To chase |
| Ageing/reference | Invoice scope restricted to positive pre-credit invoice To chase, even where customer credit removes monetary queue membership |
| Monetary/scoring scope | Exclude positive invoice overdue with no positive exact customer net overdue To chase; overdueOnly further filters positive net overdue |
| Exposure | Customer net overdue To chase maximum and total over scoring scope; total share remains explanation evidence and a positive-total guard |
| Urgency | Invoice-weighted customer overdue ages; portfolio weighted mean weighted by pre-credit invoice To chase; maximum customer weighted age; current invoice-count bonus/fallback |
| Deterioration | Ageing population with positive invoice overdue, finite relative lateness >3 days; fewer than five material observations uses absolute fallback. Otherwise exact linear-interpolated P50/P90, midpoint >=16.5, high >=30 and >=midpoint+13.5 |
| Payment recency | Customer-local last-payment days and existing bands; no portfolio benchmark |
| Display | Priority, Action History, date-local suppression and result limits are excluded from all preceding populations |

Currency-unavailable guard matches the current route: no benchmark/base-score population is fabricated. Degraded currency/review state remains explicit. Exact decimal totals and current numeric arithmetic/rounding are unchanged. Current weights remain 50/25/15/10. Credit remains customer-level, never proportionally invoice-allocated.

## Storage and completeness

Migration `20261003122754_portfolio_base_materialization.sql` creates:

- `collection_portfolio_calculations`: unique full financial identity, publication UUID, ready-only complete flag, feature-basis/customer/scored counts, exact benchmarks, currency/source/population metadata, build dependency provenance and checksums. No competing generation pointer.
- `collection_portfolio_base_scores`: separate customer rows under calculation UUID, original population order, consumed customer revision, compact scorer input, component scores, rounded weighted score, validity, structured numeric explanations, membership flags and queue-required financial display fields. Generated relational scores/net amount support later targeted/ordered access. No invoice/payment arrays, complete feature copies, formatted reason/breakdown prose, founder adjustment or Action History.

Primary keys support full-calculation and targeted lookup; retention index scopes published calculations. Customer order is persisted to preserve stable fallback tie behaviour; exact net amount/name remain available for the existing comparator. Structured explanations restore the same `BaseCustomerScore`, including one cheaply generated payment-day label, then existing presentation code can apply any override. No second scorer exists.

Row-count and stored payload-digest verification detects missing/corrupted customer rows; manifest checksum detects altered benchmark/metadata payload. A checksum is integrity metadata, not a signature or alternate accounting authority. Financial dependency validity assumes authoritative writers preserve the existing G/F/r/certification contracts; privileged manual source tampering that disables those contracts is outside ordinary supported writes.

## Build and atomic publication

Warm ensure uses one identity/manifest RPC: zero feature transfer, feature reconstruction, benchmark computation or base rescoring. Read surfaces support manifest-only, <=100 targeted customers and <=2,000 rows per keyset page. Single-page reads share one SQL snapshot. Multi-page assembly verifies calculation UUID at every page and the final current-identity fence.

On miss, the Phase 3.3 bulk ensure provides the complete population and its captured identity. Benchmarks/base scores compute outside long transactions. Publication takes the existing state-row then financial advisory lock order, locks certification/current feature slots, checks G/F/evidence and all feature revisions/date/versions/completeness, then inserts manifest and all score rows in one transaction. No incomplete staging table or pending manifest is exposed. Duplicate builders return the existing valid calculation ID. Stale builders reject and ensure retries at most three times. Older dates cannot replace newer published date state; reads always bind the requested UTC date.

A genuine financial miss rebuilds only affected customer features through Phase 3.3. Exact benchmarks are recomputed from the complete stored feature population. `comparePortfolioBenchmarkDependencies` compares exposure maximum/positive-total guard, total-share evidence, urgency mean/max and deterioration mode/anchors. Publication provenance records those changes against the preceding valid financial calculation when available. This implementation deliberately rescores **all compact rows** on a financial miss, refreshing share explanations and complete contexts. It does not implement component copying: measured CPU is small, and the simpler exact pass is easier to trust. Peer invoices/payments and unchanged customer features are not rebuilt.

UTC rollover rebuilds dated features from the same accounting bases, then creates a dated calculation. G replacement builds new-G features and calculations; it never relabels old scores or rolls accounting authority backward.

## Failure, security, erasure and retention

A process dying before publication leaves no state. SQL publication failure rolls back manifest and all rows. Missing/corrupt derivatives cause a miss and normal ensure rebuilds; incomplete/stale feature inputs cannot publish. Financial/promotion races reject; P-only races do not. Multi-page reads spanning a financial replacement return typed transition rather than mixed current results.

RLS is enabled without browser policies/grants. Service-role SELECT only on tables; writes use scoped SECURITY DEFINER functions with fixed pg_catalog search_path. Private helpers are revoked from browser/service roles. RPCs bind scope/current G; no caller-supplied calculation UUID can retrieve another owner's rows. User and generation erasure cascade, manifest deletion removes only its score derivatives. Authoritative accounting/features are never pruned here.

Explicit `prune_collection_portfolio_calculations` removes a bounded number of superseded calculations, retaining two latest per scope/mode/model plus a current matching identity if necessary. It is maintenance/lazy invocation, not cron or a live-request hook. Uninvoked cleanup allows history to accumulate; one calculation per epoch/date cannot be retained indefinitely operationally. No lease/worker system was introduced; duplicate CPU is preferable to additional coordination at this stage.

## Certification and local baseline

`tests/xero/portfolio-materialization.test.mjs` compares the full Phase 3.3 basis-to-feature path with existing benchmark/base outputs across frozen fixtures, including exact explanation reconstruction for every override. Additional real feature changes prove maximum/share/urgency/deterioration peer dependencies and customer-local payment recency.

`tests/database/portfolio-materialization.integration.test.mjs` certifies migrations, complete publication, G/F/evidence/date invalidation, P-only invariance, rollback, stale/concurrent builds, corruption recovery, security, erasure and bounded retention. `tests/database/portfolio-materialization.scale.mjs` is explicit disposable-local certification at 100/500, 1,000/5,000 and 10,000/50,000 customers/invoices. It measures feature preparation separately, validation/publication, benchmark/base CPU, bytes, score rows, features rebuilt and actual RPC counts. Docker/psql adapter time is not hosted network latency. No hosted integration or schema rollout is authorized here.

Current live routes and all previous programme files are preserved. Later queue projections, mutation/UI fast paths, background freshness and page redesign are outside this unit.

## Final measured performance limits

The final single-run local baseline is `portfolio-calculation-local-baseline.json`. At 1,000 customers, warm manifest lookup was 83.5ms total / 4.3ms SQL; targeted score lookup 101.3ms / 6.0ms SQL; complete compact population 411.7ms / 42.4ms SQL. SQL lookup goals were met; the adapter-inclusive targeted lookup exceeded 50ms. Full score transfer was 2.37MB versus 3.23MB full features (about 27% less). At 10,000 customers, warm manifest lookup was 109.5ms / 13.0ms SQL, targeted score lookup 151.3ms / 27.9ms SQL, and complete compact population 1.664s / six RPCs / 23.72MB, versus the Phase 3.3 warm full-feature baseline of 4.084s. Warm, priority and Action History paths transferred no customer features and performed no benchmark/base calculations.

Misses remain substantial at 10,000 customers: cold portfolio calculation from valid features 14.791s (feature ensure 4.355s, publication SQL 6.103s); one-customer financial recalculation 8.147s (one feature rebuilt, no canonical reads; feature ensure 4.191s, publication SQL 2.160s); UTC rollover 34.472s (same accounting bases, all dated features rebuilt; feature ensure 27.032s, publication SQL 4.042s). Benchmark plus base-scoring CPU was only about 78ms cold / 60ms financial / 89ms rollover. Atomic publication is bounded and performs no provider/network work inside the transaction, but is **not uniformly a short lock hold at 10k**. This is a remaining contention/cold-build limitation, not a hidden performance success. Existing live writes/reads do not call it. No hosted latency certification is claimed.

Final checks: 1,827 default-suite tests (1,625 passed, 202 opt-in skipped, zero failed); 76/76 disposable database regression tests (28 dependency, 29 customer-feature, 19 portfolio); final portfolio parity/dependency/ordering suite 91/91. All 21 canonical migrations replayed locally. Lint, TypeScript, SQL/security check, production build and diff/whitespace checks passed. Build emitted the existing Node module.register deprecation warning. No hosted integration, new environment variables, commits, pushes, deployments or live-route activation. All 32 pre-existing programme files remained byte-identical; develop / 806b5420a87749665d9de28957970275c54924f8 unchanged.
