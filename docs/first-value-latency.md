# First-value latency model

This document defines the backend boundary used to measure Yuohme's first-value path. It does not include browser rendering.

## Authoritative boundaries

- **T0** — Xero OAuth callback or explicit organisation selection has resolved a usable tenant.
- **T1** — the automatic generation sync is requested after entitlement and tenant-lock checks.
- **T2** — the fenced generation has been acquired and execution starts.
- **T3** — Xero retrieval starts.
- **T4** — the initial and catch-up Xero retrieval waves complete.
- **T5** — raw resource persistence and canonical mapping/persistence complete.
- **T6** — manifest and currency/readiness validation complete.
- **T7** — the promotion transaction completes.
- **T8** — the authoritative snapshot is resolvable. T7 and T8 share the successful promotion-RPC boundary because that transaction atomically updates the active generation pointer before returning.
- **T9** — collections data reads start.
- **T10** — the prioritised response, successful empty state, or explicit currency/plan block is ready for serialization.

The primary metric is T0→T10. Import readiness is T0→T8 and result assembly is T8→T10. Controlled operators that do not execute OAuth must report T1→T8 instead of relabelling it as T0→T8.

## Minimum first-value dataset

| Dataset/component | Classification | Why it blocks first value |
| --- | --- | --- |
| Organisation | REQUIRED BEFORE FIRST VALUE | Supplies and validates the accounting organisation and base currency required for authoritative currency handling. |
| Contacts | REQUIRED BEFORE FIRST VALUE | Supplies stable customer identity and the display name/email needed for an intelligible chase recommendation. |
| AUTHORISED ACCREC invoices | REQUIRED BEFORE FIRST VALUE | Supplies current exposure, overdue amount/count, due dates, urgency, and transaction/base-currency values. |
| PAID ACCREC invoices | REQUIRED BEFORE FIRST VALUE | Supplies the historical lateness baseline used by the current scoring engine. Omitting it would change scoring semantics. |
| AUTHORISED ACCRECPAYMENT payments | REQUIRED BEFORE FIRST VALUE | Supplies payment recency and recent partial-payment signals used by prioritisation and explanations. |
| Base-currency conversion status/rates | REQUIRED BEFORE FIRST VALUE | Ranking must fail closed or degrade explicitly when a credible common-currency comparison cannot be made. |
| Canonical generation persistence | REQUIRED BEFORE FIRST VALUE | The application reads only the validated, promoted authoritative snapshot. |
| Manifest/readiness validation and promotion | REQUIRED BEFORE FIRST VALUE | These preserve source reconciliation, FX correctness, fencing, and promotion-only authority. |
| Customer overrides (default Normal when absent) | REQUIRED FOR CORRECTNESS BUT CAN BE DERIVED DIFFERENTLY | Existing overrides affect ranking; absence is safely inferred as Normal. Its read can run concurrently with collection actions after the snapshot-derived currency gate passes. |
| Collection actions/suppression state | REQUIRED BEFORE FIRST VALUE | Future postpone/promise states suppress customers and today's actions determine the actionable queue. |
| Organisation action metadata (`USEMULTICURRENCY`) | NOT USED IN FIRST VALUE | The current first-value currency context is derived from canonical invoice currencies; generation import does not fetch this metadata. |
| Accounts and unrelated Xero resources | NOT USED IN FIRST VALUE | The generation first-value importer does not request them and prioritisation does not consume them. |
| Detailed secondary history or optional product metadata | SAFE TO ENRICH AFTER FIRST VALUE | Only data not read by the current aggregation, scoring, explanation, suppression, or currency checks qualifies; none was moved in this phase. |

Founder adjustment is not a blocking provider dataset: when no customer override exists, the ranking engine uses the existing Normal default. No scoring signal was removed or deferred.

## Telemetry contract

Events use the `[first-value.latency]` structured-log prefix. Durations use the monotonic clock; `observed_at` supplies the cross-request wall-clock boundary. Correlation is limited to operational user, tenant, and generation identifiers. Logs contain counts and durations only—never OAuth tokens, credentials, customer names, invoice contents, or other accounting data.

The controlled operator is hard-locked to Test project `rbmxegyiwntomhpbepnu`, requires `--execute`, and refuses ambiguous connection selection. It reports only aggregate counts and timings.
