# Dashboard bootstrap — Phase 3.8

## Contract and scope

Starting revision: `e790c1f9430e6a0f69b23419385b1ca04308963f`, `develop`, clean working tree. Phases 3.1–3.7 were committed and pushed before this unit. This unit makes no provider, scoring, financial-reconciliation, or refresh-policy changes.

The Dashboard is an interactive Next-to-chase card window, not a static top-five widget. Preserve its existing 200-card window, Prev/Next/swipe, outcome/follow-up/note, Undo, and founder context. Preserve currency-review presentation and access gates. A compact contract must therefore retain card/action fields and schedule/eligibility metadata, while dropping Priorities table score explanations and accounting breakdown fields.

Before:

```
client getUser → status GET → mount collections → rich queue GET → cards
```

After, with the ordered programme schema:

```
one bootstrap GET / one server getUser
  → scoped connection/subscription/generation/F/P context
  → existing locked usage-day claim (free returning users only)
  → Phase 3.5 persisted financial calculation + current overlay
  → exact queue window + compact card fields
  → access/G/F/P fence
  → current useful cards + independent operational status

independently after initial bootstrap:
  unchanged guarded auto-sync request
  → bootstrap refresh after completion
```

The 200-card limit is a display window, never a scoring/benchmark population. No browser scoring or approximate ranking is introduced. On a healthy 10k portfolio, the database/server still examines the complete compact rank population, but the browser receives at most 200 card rows. Existing currency-review rows remain intact; a heavily degraded portfolio can still have a larger review panel.

## Files and database

- `app/api/dashboard/bootstrap/route.ts`: authentication, no-store response, schema compatibility, timing headers and structured latency event.
- `lib/dashboard/bootstrap-server.ts`: context/access, typed readiness, financial projection and final fence.
- `lib/dashboard/collection-projection.ts`: explicit Dashboard card allowlist.
- `lib/dashboard/bootstrap-client.ts`: fetch, customer-generation/revision/request-order guards, metadata observation.
- `app/dashboard/DashboardOnboardingClient.tsx`: independently controlled status and card state; no status→child queue GET waterfall.
- `app/collections/actions/CollectionActionsClient.tsx`: optional supplied projection/refresh callback; ordinary Priorities behavior retained.
- `supabase/migrations/20261003192904_dashboard_bootstrap_context.sql`: additive service-only stable context RPC, no new tables, pointers, financial formulas or counters.

Apply after Phase 3.2–3.6 migrations. No migration was applied to hosted Test/Preview or Production in this unit. No environment-variable names were added or changed.

## Access and consistency

Context scopes every query to authenticated owner and requested/selected tenant. Grant scopes are validated using the existing classifier. The context RPC is SECURITY DEFINER, owned by the migration role, with fixed `pg_catalog` search path, fully qualified objects, and execution only for `service_role`; browser roles cannot invoke it.

Paid access uses existing configured price IDs, paid-through expiry and plan policy. It never reads or claims the free ledger. Free returning users invoke the existing locked `claim_billing_usage_day`; first-value onboarding, insufficient permissions and invalid generation do not claim a day. Billing failure fails closed.

The projection uses the existing Phase 3.5 service, including its own score/detail digest and G/F/P checks. The final context read verifies access digest, G/F/P and returned P. Races retry up to three times, then yield preparing; no old financial generation is labelled current. A context digest deliberately excludes auto-sync lock metadata so observing a refresh cannot spuriously invalidate unchanged financial state.

Context and collections have independent failure states. Failed/running refreshes retain a valid active generation. An invalid active pointer fails closed. Missing/stale calculations use the existing certified ensure path. Schema/legacy compatibility is explicit (`X-Dashboard-Compatibility: schema-or-legacy`), not a certified fast path: it uses existing authoritative readers, preserves onboarding before queue access, and retains the old status gate in that exceptional path. It never serves an invalid persisted calculation. Hosted performance improvement requires the ordered schema rollout.

Client request sequence plus G/F/P prevents old bootstrap or mutation projections from restoring stale financial state. Tenant changes abort/reset obsolete loads. A preparing/unavailable collection has a retry control, not a false empty-queue result.

## Refresh observation

The existing entry auto-sync helper, debounce, endpoint and server policy are unchanged. No provider request occurs inside the useful-content bootstrap. The browser starts the existing entry trigger only after its bootstrap is available; successful or failed attempts prompt a coherent bootstrap reread.

A known in-flight attempt, including one started in another window, is observed every five seconds for at most five minutes through `readinessOnly=true`. This returns one owner-scoped context read, no queue/feature population, no usage claim and no Xero call. Promotion/revision change or attempt completion triggers a full bootstrap reread. Observation is cancelled on unmount/tenant change; an observation failure retains prior valid content. Visibility return and manual refresh remain recovery paths after the bounded observer stops. This is browser observation, not a durable background job or a future refresh scheduler.

## Measurement methodology

`tests/database/dashboard-bootstrap.scale.mjs` replays all migrations into a uniquely named disposable local Docker PostgreSQL database, constructs deterministic 100/500, 1,000/5,000 and 10,000/50,000 portfolios and exercises the actual Dashboard GET handler. Authentication is a local fixture identity, **not** Supabase Auth HTTP; actual authentication/network/browser cost remains uncertified. All connection/subscription/usage/projection reads execute real SQL, including final fences and serialization. Paid and free warm measurements use three samples; the median is reported. The unchanged customer-list route is measured separately through a local SQL adapter, including access queries.

Counters include every application database request: four paid warm RPCs; five free warm RPCs; two onboarding context RPCs; three blocked free-context/claim RPCs; one known-refresh metadata RPC. Add one real Auth request in deployment. None of the warm projection requests reconstruct canonical invoices/payments, customer features, benchmarks or scores.

RPC waiting includes Docker/psql process startup, transfer and decode. SQL execution is separately recorded where the helper can measure it. Application time is the remaining route service time, not independently profiled rendering or isolated CPU. Tests/browser DOM use deterministic mocked network/provider results; they do not certify a real authenticated browser or hosted latency.

The initial scale attempt overlapped heavy verification and was interrupted because contention invalidated its timing baseline. Retain and label isolated measurement results separately. Historical Phase 1 Dashboard navigation (~7.11s), status (~1.87s) then queue (~3.59s) are hosted/runtime evidence, and must not be presented as directly comparable to local Docker figures.

## Certification boundaries

Frozen recommendation fields/counts cover all 89 original scenarios without golden regeneration. Local integration covers paid/free/no-data/grant recovery, failed/running refresh, calculation miss, P/G/access changes, role denial, owner erasure and deliberately corrupted pointer recovery. React DOM tests exercise the actual Dashboard and card component, initial request count, provider-independent useful content, completion observation, stale responses and preparing recovery.

Phase 3.7 financial mutation costs (~1.5–2.0s at 1k, multi-second at 10k) remain. Customer-list cost is measured, not redesigned. Test/Preview migration, deployment, real Supabase/Auth/PostgREST latency, real authenticated browser and hosted end-to-end certification remain separate and unperformed here.

## Isolated local baseline (2026-10-03)

Raw samples and provenance: `docs/performance/dashboard-bootstrap-local-baseline.json`.

| Customers / invoices | Paid warm p50 | Free warm p50 | Paid/free RPCs | Browser bytes (paid) | Paid customer list / DB requests |
|---|---:|---:|---:|---:|---:|
| 100 / 500 | 290.3ms | 430.5ms | 4 / 5 | 99,819 | 292.5ms / 4 |
| 1,000 / 5,000 | 322.5ms | 461.5ms | 4 / 5 | 197,326 | 833.3ms / 7 |
| 10,000 / 50,000 | 637.7ms | 723.2ms | 4 / 5 | 197,333 | 4184.3ms / 25 |

At 1k, paid waiting/application remainder was 301.0/20.5ms; free was 438.4/21.7ms. Measured SQL execution summed to 31.4ms paid and 35.9ms free; the rest of waiting includes Docker/process/transfer/decode. Auth was a fixture, so real Auth latency is not included. Paid 1k meets the 400ms local goal; free 1k misses it. Both 10k medians meet the sub-second local goal.

The 1k calculation-only miss recovered synchronously in 1838.3ms across 12 application DB requests, with one portfolio rebuild, zero feature rebuilds and zero canonical reads. The warm rich queue row payload was 772,801 bytes versus 197,326 bytes for the entire compact bootstrap.

The list exceeds its 500ms goal at 1k and remains multi-second at 10k: full dated feature population transfer/chunking still dominates despite a 200-row browser limit. No customer-list architecture change was made. At 10k the list transfers about 32.3MB database→server, versus about 2.79MB for the Dashboard; the Dashboard browser response remains about 197KB.

Local database certification: 106 existing programme cases plus 13 final Dashboard cases pass. All 24 forward migrations replay into fresh disposable databases. Browser evidence is actual React DOM with mocked network, not real authenticated browser timing. Hosted readiness is conditional on ordered Test migrations/deployment and end-to-end verification; the free 1k target miss, list gap, Auth/browser gaps and Phase 3.7 costs remain explicit.

Final enabled suite: 2,034 tests, 1,789 passed, 245 opt-in database cases skipped, zero failures. The 106 existing programme database cases and 13 final Dashboard database cases were separately enabled and passed against disposable PostgreSQL. Lint (zero warnings), TypeScript, SQL/security check, production build and `git diff --check` passed. No frozen financial/scoring expected value was changed.

An uncertain auto-sync HTTP result also prompts a bootstrap read, without repeating the provider command: this discovers a run/generation which may have committed despite a lost response. The bounded observer and visibility/manual recovery do not establish a durable refresh scheduler.
