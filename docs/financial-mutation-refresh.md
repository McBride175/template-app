# Phase 3.7 — financial mutation continuation

## Authority and scope

The Promise/dispute command remains authoritative. No migration, financial formula, currency/credit rule, command identity, dispute revision, promotion lock, or dependency trigger changes in this unit. The `reconcile: true` response extension composes the certified Phase 3.3–3.6 services; it does not introduce a second financial calculation. Programme migrations must exist before the new derivatives can be certified. Hosted projects were not changed.

## Before and after

Before:

- Promise monetary/date save → committed receipt → invoice/detail GET plus scoped customer-summary GET → financial-change event → queue GET.
- Dispute save → invoice reload → broad customer-summary/list reload → stale UI hides the invoice child → possible remount invoice request.
- Worklist dispute save → worklist-specific refresh (not customer summary).

After, on a warm financial mutation:

```text
Existing authenticated command + atomic domain/version transaction
  → durable rCustomer/F/P invalidation
  → ensurePortfolioBaseCalculation
      → existing accounting basis + one stale customer's operational inputs
      → exact Phase 3.1 features
      → complete compact feature population / exact benchmarks and base scores
      → G/F/evidence-fenced atomic publication
  → readCustomerDetailBootstrap (selected current invoice display + overlays)
  → optional readCollectionQueueProjection (only for a registered open window)
  → final G/F/rCustomer/P/evidence/date identity check
  → committed receipt + verified detail/window response
  → replace customer detail and existing list row, without a refresh GET
```

The detail child remains mounted when reconciliation is unavailable, with unsafe controls disabled. Its key changes only with customer selection. Current selected invoice display is an intentional current-generation read, not accounting-history reconstruction.

## Server interfaces

`lib/collections/financial-mutation-reconciliation-server.ts` supplies the server-only coordinator and continuation type. Command functions accept a trusted optional continuation, invoke it only after a verified commit/receipt replay, and retain their original returned command DTO. A continuation failure cannot turn a committed save into a failed mutation.

`/api/collections/invoice-promises` strips only the opt-in projection fields before passing the otherwise strict intent into the existing command parser. `/api/collections/invoice-disputes` passes the existing intent plus a trusted callback. The customer identity comes from the committed Promise or validated canonical invoice, not a caller-supplied customer override. Bulk disputes use the already validated customer scope.

The response extension is:

```text
ok: true
committed: true
original Promise/dispute command result
reconciliation:
  reconciliationReady: true
  tenantId / customerSourceId
  detail (same projection as initial selected-customer loading)
  G / F / rCustomer / P / UTC date / evidence / financial calculation ID
  optional queue projection, tagged with its overdueOnly scope
  non-sensitive stage/request/rebuild metrics
or:
  reconciliationReady: false
  reason: budget | unavailable | schema
```

HTTP stage timings distinguish command-through-commit, reconciliation and total elapsed time. The coordinator's DB call count is continuation-only, not authentication/command overhead. `GET /api/collections/financial-reconciliation` uses the existing tenant/entitlement/currency authorization boundary and performs idempotent derivative recovery without reissuing a command. Responses are not cached.

## Metadata classification

Durable F still decides financial validity. Effective no-op amounts/caps reuse the current calculation when F remains unchanged. Notes/reviews are known metadata by existing domain semantics. A Promise edit is provably metadata when before/after status, commitment amount and qualifying paid total are identical; a date edit that triggers an existing lifecycle/payment change is not classified as metadata.

For domain-proven metadata, use **read-only** financial lookup. A missing/stale calculation yields committed-but-not-ready and explicit recovery, rather than secretly building a portfolio as part of a note save. On a valid metadata hit there is no feature transfer/rebuild, benchmark calculation, or base-score calculation. Promise replay retains its original receipt semantics and may recover an unfinished financial continuation, with no new mutation/version increments.

## Consistency and recovery

The portfolio publisher retains its existing G/F/feature/evidence transaction fence. Detail retains its snapshot and rCustomer/P fence. The coordinator verifies that detail, calculation and optional queue refer to the same held financial identity and operational revision, then checks current dependencies. Races retry at most three times within the foreground budget. Currency entitlement is rechecked against the returned current detail context when the authorized command supplies its entitlement.

The continuation has a maximum 10-second budget. It aborts PostgREST requests and prevents later stages; an already executing database statement can still finish under its existing fence. No stale detail or queue payload is returned on timeout. The command itself is never rolled back or repeated by recovery. Lost Promise responses reuse the same command UUID, return the existing committed receipt and reconcile current state.

Customer response ordering uses G/F/rCustomer/P/date and the current selection. Older financial responses cannot replace newer values; an older unavailable response cannot invalidate a newer ready mutation. In-flight list responses are patched with newer affected-row state instead of overwriting it. Queue events carry authoritative same-window projections; registered scope mismatches and other tabs use the fast current queue read. Local storage contains only tenant/nonce notification metadata.

## Lists and worklist

Ordinary Promise/dispute operational changes preserve customer-list gross balance/age/name sorting and gross overdue filtering. The existing displayed row is replaced in place. Generation replacement or currency-review membership transitions still request the complete correctly sorted list window; that rare correctness fallback is explicitly retained rather than guessing the next row. Full-population list optimization remains outside this unit.

The Disputes worklist retains its own bounded window reload for membership, ordering and counts. It does not fetch broad customer summaries or route through a customer page. A retained dispute with no current invoice can still be committed/resolved under existing semantics; its selected-customer continuation may be unavailable while the worklist refresh succeeds.

## Local evidence and limitations

See `financial-mutation-local-baseline.json` for all 27 observations, including failures. These are command-fixture plus continuation measurements, not hosted HTTP or real-browser timings. The Docker RPC adapter launches a process per operation, so DB waiting includes transport/process overhead. No hosted or real-browser performance claims are made.

| Customers / invoices | Financial ready observations | Metadata observations | Continuation RPCs |
|---|---:|---:|---:|
| 100 / 500 | 0.829–1.414s | 0.340–0.653s | 10 financial / 4 metadata |
| 1,000 / 5,000 | 1.563–2.018s ordinarily; create outlier 3.899s | 0.383–0.506s | 12 / 4 |
| 10,000 / 50,000 | 8.495–11.637s including command; four budget misses | 0.664–1.078s | 30 ready financial / 4 metadata |

Successful detail responses are 6.1–6.4KB in the synthetic fixtures. Normal financial changes rebuilt exactly one customer feature, with zero canonical basis/invoice/payment/evidence reconstruction and no unaffected feature rebuild. Metadata rebuilt zero. Financial publication still rescored all compact score rows exactly; no approximate/incremental scoring was introduced.

At 10k, the existing full feature-population transfer consumes several seconds and publication SQL remains costly (about 1.7–3.4s where completed). Benchmark/base CPU remains comparatively small. Profiling does not justify treating score-row publication alone as the entire bottleneck; no speculative shared-score-row schema was added. The ≤1s/≤400ms goals are not certified by these observations.

Client JSDOM/component tests cover no second GET, committed-not-ready recovery, retained detail, and stale response rejection. A running authenticated browser session and hosted mutation latency were not certified. The new unit adds no migrations or environment variables and does not touch Dashboard/Xero/freshness/Production.

## Final validation and provenance

- Branch: `develop`; starting/ending HEAD: `806b5420a87749665d9de28957970275c54924f8`.
- Starting dirty paths: 72; ending dirty paths: 90. Of the 72 prior programme paths, 66 remain byte-identical. Six required integration edits preserve and extend the prior implementation. No files were staged, reset, committed or pushed.
- Full enabled suite: 1,991 tests; 1,759 passed, 232 opt-in tests skipped, zero failures.
- Programme disposable-PostgreSQL regression: 105/105 passed, zero skipped.
- Final Promise command/reconciliation disposable-PostgreSQL run: 52/52 passed, zero skipped. This includes the final 12 reconciliation cases and original Promise replay/conflict/security contracts.
- Final targeted client/domain run: 108/108 passed.
- Lint, TypeScript, production build, SQL security and `git diff --check` passed.
- All 23 existing canonical migrations replayed into isolated fixture databases. No hosted integration was enabled and no new migration was introduced.

Correctness and refresh-path implementation are locally certified. End-to-end hosted/browser latency and the requested SME latency targets remain uncertified; the baseline records the target misses and all four 10k committed-but-not-ready observations.

The baseline JSON includes the complete Phase 3.7 file manifest separately from preserved prior programme paths, stage measurements, validation totals and evidence limitations.
