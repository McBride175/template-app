# Customer accounting basis and financial features (Phase 3.3)

This path is internal and **not activated on existing queue/customer routes**. No provider calls, portfolio persistence, background jobs or page changes are introduced. Existing accounting and operational tables remain authoritative; deleting all three derivative tables loses no business information. Authenticated ownership and entitlement resolution remain the calling server boundary's responsibility. Service-role access is not a substitute for that boundary.

## Locations and flow

- `supabase/migrations/20261003073300_customer_feature_materialization.sql`: additive tables, five service-only RPCs, private scope/certificate helpers.
- `lib/collections/customer-materialization.ts`: version constants, exact credit-completeness gate, unchanged Phase 3.1 calculator invocation, portfolio metadata merger.
- `lib/collections/customer-materialization-server.ts`: explicit basis preparation, single/bounded-set/portfolio ensure, bounded retry, optional metrics.

```text
Succeeded canonical G (existing xero_sync_tenant_state authority)
    -> set-based build_collection_customer_bases
    -> immutable per-customer basis + verified full-generation manifest
       + current targeted disputes / active authoritative Promises
       + current certification + UTC evaluation date
    -> calculateCustomerFinancialFeatures (unchanged)
    -> short G/rCustomer/certificate publication fence
    -> dated per-customer feature slot
```

There is no duplicate generation pointer. A manifest proves population completeness, never current authority. Empty tables are harmless because live routes do not use them. Legacy null-G accounting receives a typed not-ready result from the new ensure API.

## Source-to-basis-to-calculation map

All source queries filter owner, tenant, `source_system='xero'`, and succeeded G. Exact monetary/rate numerics are cast to decimal text exactly as in the live loader. Array order follows the original loader's source-ID order; organisation order follows retrieval time descending.

| Authoritative source | Basis fields | Existing calculation dependency |
|---|---|---|
| canonical_customers | source_id, name, email, is_customer, is_supplier, status | Normalized identity, display, inclusion, duplicate-identity merging |
| canonical_organisations | base_currency_code, source_timezone, country_code | Global currency gate, organisation timezone/fallback |
| canonical_invoices | user_id, tenant_id, source_system, source_id, customer_source_id | Ownership, exact dispute/Promise joins, customer association |
| canonical_invoices | type, status | Current ACCREC/AUTHORISED population and historical PAID population |
| canonical_invoices | issue_date, due_date, fully_paid_date | Latest dates, overdue ages, weighted ages, six-month historical window/lateness |
| canonical_invoices | transaction_currency_code, organisation_base_currency_code, xero_currency_rate | Exact currency conversion, health and native breakdowns |
| canonical_invoices | total_native, amount_paid_native, amount_due_native, amount_credited_native, amount_due_base | Gross/overdue, disputes/Promises, actionability; credited-history and partial-payment neutrality |
| canonical_invoices | currency_conversion_status, currency_conversion_failure_reason | Null/invalid FX and review population, including financially covered invoices with unknown gross FX |
| canonical_payments | invoice_source_id, customer_source_id, payment_date | Explicit customer first, otherwise receivable invoice association; last payment and recent partial flag |
| canonical_customer_credit_evidence_exact | sync_run_id, user_id, tenant_id, source_system, source_kind, source_id, customer_source_id | Certified generation/scope/evidence identity, duplicate-free complete credit population |
| canonical_customer_credit_evidence_exact | provider_type, status, residual_state, remaining_credit_native, currency_code, organisation_base_currency_code, xero_currency_rate | Existing exact customer-level credit deduction and unsupported/unavailable states |
| Source inventory | customer/invoice/payment/credit counts, global per-kind credit counts | Completeness and certificate count validation; no unknown-to-zero coercion |
| Original source order | projection_order, invoiceOrdinals | Customer insertion order / future tie behaviour and currency-issue order |
| xero_customer_credit_validations | Not stored as immutable accounting; freshly read certificate identity | Current contracts, readiness, reason, consistency and initial resource counts |
| invoice_disputes / invoice_promises | Excluded from immutable basis; read from current authority for rebuilding customer | Existing effective coverage and financial lifecycle semantics |

All historical invoices are retained, **not just the current six-month window**, so UTC rollover can reuse the basis. Payment amounts, raw provider responses, action history, priorities, operational notes/events and scoring results are excluded: the existing financial feature calculator does not need them. Promise qualifying-paid amounts come from the current authoritative Promise row; this path neither repeats reconciliation nor invents a second payment resolver.

## Storage, completeness and versions

`collection_customer_bases` is keyed by scope/G/normalized customer/basis version. It holds the minimum lossless calculation input JSON plus relational completeness/count/order columns. It is insert-only through the service RPC; conflicting builds do not overwrite it. The empty source identity is an internal **unassigned bucket**, preserving unassigned/non-collectible source counts and empty-portfolio organisation metadata without inventing a customer.

`collection_basis_manifests` records verified full-generation totals and basis population count. Full preparation aggregates source rows in PostgreSQL, without REST row-limit truncation, then checks stored counts against canonical populations in the same transaction. Targeted preparation creates complete customer bases but does not claim full-generation completeness.

`collection_customer_features` has one slot per scope/G/customer/basis version/feature version, replacing superseded dates and financial revisions. Queryable financial columns (gross, disputed, promised, pre/post-credit To chase, credit, age/history/deterioration/last-payment and health) are generated from the same payload, preserving numeric/null semantics without a second financial implementation. Stored `result` is the entire Phase 3.1 `CustomerFinancialFeaturesResult`, plus invalid-invoice ordering metadata. Exact decimal strings, nullable amounts, review/currency health/context and source counts survive JSON round-trip. The unchanged contract does not export weighted-age numerator/denominator as separate values; the complete invoice basis retains everything needed to recalculate them. No second implementation adds reconstructed numeric features.

Versions: `customer_basis_v1`, `customer_features_v1`. Increment basis version for an incompatible basis structure/source contract; increment feature version for incompatible feature structure or financial calculation semantics. Ship a forward migration updating supported SQL versions/RPCs together with constants. Readers compare the RPC's declared versions with application constants and fail closed on mismatch; a code-version change alone cannot silently accept v1 derivatives. Commit SHA is not a validity key.

## Validity and publication

A feature hit requires matching scope, current succeeded G, rCustomer, requested UTC date, both calculation versions and exact consumed certificate identity. F fences complete multi-batch portfolio assembly; P is intentionally irrelevant to financial features. Priority/Action History/note-only changes do not rebuild features. Consumers must independently overlay current operational projections.

Normally rCustomer is exactly the Phase 3.2 source revision. If whitespace-normalized canonical identities alias one customer, validity uses the **sum of their monotonically increasing source revisions**, with an expression index. This avoids an alias evading invalidation and adds no new counter. Overflow fails closed. Existing dependency rows are not service-deletable.

Credit rows are G-bound and immutable under existing fenced writers. Certification can defensively change under the same G; its canonical JSON identity includes scope/G, contracts, readiness, reason, consistency and initial observation metadata/counts. The digest is a change token, not a security credential. Count-only changes are detected even where Phase 3.2 deliberately leaves F/r unchanged. Ready credit must match complete per-kind source counts; missing/mismatched evidence remains unavailable, never zero. No invoice-proportional credit allocation is introduced.

Build features outside database transactions. Publication locks tenant accounting state then the existing financial advisory scope (the same order as financial mutations/promotion), shares-locks certification, verifies G/r/certificate, validates result structure/scope/counts and publishes the entire bounded batch atomically. A stale G, changed r, changed certificate or older-date builder is rejected without overwriting newer slots. The builder retries at most three times, otherwise returns typed not-ready. Browser closure has no effect on committed derivatives. A feature result is valid at its read snapshot; no read can promise that authority will never change afterward.

For large populations, pages are explicitly bounded at 500 and feature read/build/publication batches at 100. Every page/build must match held G/F/certificate; final validation prevents mixed populations. Feature misses read **stored bases**, targeted disputes and active Promises only. Warm hits do not load canonical inputs or operational rows. Duplicate computations are allowed; unique immutable basis keys and fenced feature slots make them safe. No lease/job system is needed for these bounded builds. Full-generation basis extraction is one set-based RPC; it is not one API request chain per customer.

## Retention, failures and privacy

One feature slot bounds dates/revisions automatically. Explicit `prune_collection_customer_materialization` deletes at most 500 basis rows per call, normally retaining current and previous succeeded G. It never deletes active G or any authoritative row; incomplete pruned historical manifests are removed immediately. The operation is manual/lazy preparation maintenance, not scheduled or hooked into live requests. Invoke repeatedly until no removable rows remain. Without invocation, historical generations accumulate; operational scheduling is outside this unit.

A missing/corrupt manifest, stale scope, failed source extraction, invalid Promise context or repeated publication race never serves old results as current. A partial derivative population returns not-ready; explicit basis preparation can repair disposable missing rows. Existing live loaders remain available and unchanged. No fallback silently converts failures into financial zero.

All derivative tables have auth-user and generation cascade relationships; feature rows cascade with basis deletion. Owner erasure removes every derivative. Generation deletion removes its derivative population. RLS is enabled with no browser policies/grants, and only service-role SELECT. Writes occur only through scoped SECURITY DEFINER RPCs with fixed `pg_catalog` search path. Private functions/schema are not executable by browser or service roles. No browser/user-editable dependency counters or materialization API is introduced.

## Certification and measurements

- Frozen Phase 3.1 expectations remain unchanged; all 89 scenarios also compare full financial result and JSON round-trip through per-customer bases.
- Disposable PostgreSQL tests cover migration replay, complete source populations beyond 1,000 rows, cache reuse, G/r/date/certificate invalidation, aliases, current Promises, credit, payment association, stale and concurrent publication, blocked mutation race, grants/RLS, cross-owner access, deletion/erasure and bounded cleanup.
- `tests/database/customer-materialization.scale.mjs` is an explicit local-only benchmark at 100/500, 1,000/5,000 and 10,000/50,000 customer/invoice sizes, with one payment per customer. It reports total time, calculator CPU, database function execution, adapter waiting, round trips and storage.
- Metrics are optional internal instrumentation and do not emit user telemetry. Canonical-read counters distinguish extraction/count verification in the cold RPC; warm/financial/date paths have zero canonical invoice/payment/evidence reads. Adapter wait includes Docker/psql process launch, serialization and local transfer: it is **not hosted network latency**. Local SQL time and JS calculation time are recorded independently.

No speed claim is made for current production pages: this unit certifies reusable features, not compact queue/scoring reads. Bulk feature transfer remains O(customers); cold accounting work/storage is O(invoices + payments + credit rows), financial rebuild is customer-local, UTC rollover computes all dated customer outputs from bases. Benchmark/base-score persistence and operational overlays are deliberately absent.

Final local measurements and provenance are preserved in `customer-materialization-local-baseline.json`. All three sizes completed. An intermediate 1,000-customer warm probe took 48.39 seconds (48.01 seconds SQL). Explicit context/revision batching alone did not resolve it. `EXPLAIN ANALYZE` of a fresh-statistics generic plan showed broad basis/feature joins before page-key filtering: 500,500 feature index scans, approximately 501 rows each. Lateral complete-primary-key probes now bind each page customer before lookup. The diagnostic statement fell from 60,704ms to 76ms, with 500 one-row feature probes; an integration test guards that plan shape. Final 1,000-customer warm read was 0.499 seconds total / 0.142 seconds SQL.

Final 10,000-customer cold/rollover totals were 32.04/25.86 seconds, with 226/224 bounded RPC calls; warm full-feature transfer was 4.08 seconds / 22 calls. One-customer financial rebuild was 0.425 seconds / four calls and reused accounting. These single-run local figures include Docker/psql adapter overhead and are full feature-population builds/transfers, not certified hosted queue latency. Bulk request consolidation/compact scored reads are outside this unit.

The `WithIdentity` ensure variants additionally return the captured scope/G/F/UTC date/basis version/feature version/certificate identity (and customer revisions for targeted results). Later portfolio publication must fence **this captured identity**; rereading a newer head after receiving older features would incorrectly relabel them. Ordinary result-only wrappers preserve the exact Phase 3.1 result shape and make no additional requests. No portfolio publication or persisted score state is implemented here.

Portfolio probes also perform one metadata-only active-Promise membership check against the stored current-G bases, preserving the live calculator's rejection of orphan/mismatched invoice context even when other customer features are warm. This fetches no operational financial payload and reads no canonical invoices/payments; `operationalIntegrityChecks` records it separately. Targeted operational reads include both invoice association and customer association, so malformed customer identity cannot silently omit an invoice's Promise. Invalid authoritative fixtures are rejected, not materialized as zeros.

Final validation: 1,717 default-suite tests (1,534 passed, 183 opt-in skipped, zero failed); 29/29 disposable-database materialization tests; 87 existing dependency/Promise/reconciliation/queue database tests also passed. All 20 canonical migrations replayed locally. Lint, TypeScript, SQL security check, production build and whitespace/diff checks passed. Hosted integration and hosted migrations were not run. All 22 pre-existing programme files remained byte-identical; branch and HEAD stayed develop / 806b5420a87749665d9de28957970275c54924f8.
