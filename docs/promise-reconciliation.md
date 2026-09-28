# Atomic Promise reconciliation — Phase 5B

Structured Promises now reconcile at authoritative Xero generation promotion.
Authenticated Promise CRUD (Phase 6) and canonical queue actionability (Phase 7)
are implemented. There is still no Promise editor/history UI. Legacy
`promised_to_pay` contact outcomes no longer suppress the queue. Unapplied cash is outcome evidence only.

## Prepare, decide, commit

`promoteXeroGenerationRun` delegates to the internal server-only
`promoteXeroGenerationWithPromises` path:

1. `prepare_invoice_promise_reconciliation` checks the candidate run's exact
   lease/fence and owner/tenant, then holds a coherent snapshot. It returns the
   complete Active Xero Promise set, exact decimal text payment/cash evidence,
   organisation timezone/base context and invoice identity/valuation context.
   Terminal Promises are excluded. An empty Active set skips evidence loading.
2. `preparePromiseReconciliation` binds the held invoice identity/currency,
   calls `qualifyPromisePayments`, then `resolvePromiseOutcome`. It adds no
   lifecycle rules. Resource counts describe the entire held generation, so
   payment/cash arrays are not silently restricted to a subset of records.
3. `promote_xero_sync_run_with_promises` locks the generation and tenant,
   rechecks the entire Active ID/revision set and an exact evidence digest,
   and calls the retained fenced collections-readiness promotion contract.
4. Inside that same transaction, certified nonterminal payment facts are
   recorded or terminal resolver results are applied through the existing
   atomic Promise command. Failure rolls back both publication and Promise
   writes, including lifecycle events. Successful readers cannot observe half
   the transaction.

The prepared observation is **conditionally authoritative**: its Phase 5A
`status=succeeded` / `authoritative=true` inputs describe what will become
committed only if the publication transaction succeeds. They are not published
accounting data or persisted success markers. At commit, generation authority,
readiness and every relevant fact are checked again.

A generation without complete `promise_accounting_evidence_v1` resources and
normalized timezone is supplied as a non-authoritative candidate to Phase 5A.
Its resolver returns technical defer with no certified evaluation. With any
Active Promise in the locked tenant set, commit rejects publication with
`promise_evidence_not_ready`: accounting and Promise state both remain unchanged,
and generation-sync uses its existing safe failure mechanism. With zero Active
Promises, the existing collections promotion rules remain unchanged; Promise
evidence readiness is not a general accounting prerequisite. Missing invoice identity or
incompatible currency invalidates payment qualification rather than fabricating
zero debt. Cash-only FX uncertainty within an otherwise ready observation can
return defer while retaining independently certified payment facts.

## Persistence matrix

- `kept`, `missed`, `unclear` with a required transition: use the existing
  system `resolve` command. Persist the exact paid total, generation/time,
  terminal status/reason/resolver version and the **unchanged Phase 5A evidence
  summary** in one terminal event. SQL validates binding, not lifecycle policy.
- `retain_active`, or `defer` with `payment_evaluation_valid=true`: use
  `record_invoice_promise_evaluation`. It accepts only owner/tenant/Promise,
  expected revision, generation, exact nonnegative paid amount and evaluation
  time. Only paid amount/evaluated generation/evaluated time change. Normal
  revision and updated-at triggers apply. No lifecycle event is appended.
- Invalid payment evaluation or terminal input: no Promise write.

Evaluation provenance must be a succeeded active generation with ready evidence,
owned by the exact owner/tenant. Evaluation timestamps bind to the resolver's
payment or all-resource completion observation (millisecond precision, matching
JavaScript instant precision). No raw provider data or duplicate evidence summary
is stored on the operational row. No new persistence fields were needed.

## Concurrency, retries and idempotency

All supported Promise commands acquire a tenant advisory transaction lock
before Promise row/command locks. Promotion acquires the existing generation
state/run locks, then that same Promise tenant lock. The complete sorted Active
ID/revision set is an equivalent consistency token: no additional revision table
or cache is necessary. Creates, edits and cancellation cannot slip through the
commit check. A changed set/revision aborts publication without applying stale
proposals. A newly created Promise's own creation baseline governs qualification;
a collection completed before its creation is not valid for it.

The server reloads/recomputes against the **same canonical candidate generation**
up to three times on a preparation race. It never refetches Xero for a Promise
race. Each preparation/commit respects the existing lease/fence; exhaustion
leaves publication unsuccessful. Empty-set preparation is guarded again at
commit, so a concurrent create also triggers recomputation.

Successful repeat/ambiguous promotion is detected from the exact run's committed
status and completion timestamp under generation locks. It returns
`already_promoted` without replaying events or revising rows. Nonterminal exact
same-generation/paid/time evaluation is a no-op even on an uncertain stale retry;
changed facts require the expected Active revision. A new generation is material
new provenance and increments revision when a valid evaluation is recorded.
Terminal commands use a deterministic generation/Promise/expected-revision
command UUID, plus existing command fingerprints and one-terminal-event integrity.

## Security and workload

All RPCs are service-role-only with fixed search paths. Renamed original
promotion/Promise command functions and snapshot/lock helpers have no application
execute grant, preventing bypass. Existing RLS, direct-write revocations,
immutability, privacy cascades and decimal constraints remain intact.

Normal preparation and commit use two application RPCs, batch-load evidence and
invoice contexts, and run cheap pure functions. Commit writes only Active
Promises with certified results. Empty Active sets avoid payment/cash/invoice
loading. There are no per-Promise network reads, scorer calls, extra provider
requests, callbacks, cron jobs or eventual reconciliation windows.

## Next boundary

Phase 6 must provide authenticated create/edit/cancel/read behaviour and build a
certified creation payment baseline from a held authoritative accounting snapshot.
It must use exact decimal projections and the existing revision/idempotency
commands. Phase 5B does not expose those user operations.
