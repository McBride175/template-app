# Product accounting refresh (Phase 7.5)

This is the final implemented Preview/Test refresh contract. Earlier Phase 7.1–7.4
documents retain certification history; where their phase boundaries differ, this
document and `ARCHITECTURE.md` describe current behaviour.

Compute follows actual Yuohme usage, not the existence of an accounting connection.
Cron only dispatches, retries and recovers already-accepted jobs. No connection-age
scan, periodic intent creation or last-activity maintenance schedule is enabled.

## Entry-point cutover

| Entry | Previous behaviour | Durable behaviour | Usage-day claim |
|---|---|---|---|
| Dashboard | Browser auto-sync POST executed Xero; useful bootstrap separate | Useful bootstrap renders, then shared activity signal | None for signal/status; collection use retains entitlement |
| Priorities, Customers/detail/history, Disputes | Ordinary collection reads | Shared mounted product boundary plus trusted collection interaction clicks | Existing product entitlement unchanged |
| Account | Entry auto-sync and request-bound manual Sync now | Shared status/manual Refresh; settings entry itself is not activity | None for refresh/status |
| /start | Browser auto-sync, generation-status observer | Durable onboarding acceptance, current derivative status, background completion | None for preparation |
| OAuth callback | Grant/connection update only | Exact resolved organisation accepts reconnect; ambiguous selection deferred | None |
| Organisation selection | Owned selection then /start | Owned selection accepts onboarding; /start joins it | None |
| /api/xero/sync/auto, /api/xero/sync | Request-bound provider/import/publication | Compatibility delegates to opportunistic/manual admission | None |
| Internal sync/scheduled-sync/operator CLI | Secret/service-only direct recovery tools | Retained explicitly for operator recovery; no schedule configured | Not ordinary product access |

## Authority and policy

POST /api/accounting/refresh authenticates getUser(), resolves an owned connection,
and invokes service-only accept_product_accounting_refresh. That transaction locks
the existing connection, observes existing work before cooldown, checks the promoted
run's snapshot_as_of (not publication time), and delegates coalescing/idempotency to
the certified acceptance RPC. Opportunistic due threshold is 60 minutes. Manual
refresh bypasses age but respects five-minute start/publication spacing and provider
backoff. Reconnect/onboarding cannot bypass a blocked or retrying job.

Returning onboarding can create derivative-only work against an already-promoted
run when today's derivatives are missing. It never mistakes provider retrieval or
promotion alone for first-value readiness. Current preparation validity remains
G/F/date/version/evidence based. Existing lazy product ensures remain unchanged.

Acceptance commits before best-effort immediate dispatch; Cron recovers a missed
signal. There is no provider wait in product POST. Status derives connection health,
control work, authoritative generation/observation and computed derivative readiness.
Default scope resolves a unique owned active connection; disconnected history is
retained separately. Multiple active organisations require selection. Account also
publishes its owned selected scope to the shared status observer.

Public responses omit owner, epoch, attempts, worker identities and leases. Clients
cannot supply job, generation, worker mode, authority or owner.

## Observation and UX

One shared product boundary serves Dashboard, Priorities, Customers/detail/history,
and Disputes. It signals actual mounted navigation and trusted clicks within product
content, excludes the status control and public/settings pages, and throttles signals
per organisation for 30 seconds. Prefetches do not mount the boundary. Status polling,
scope observations and completion broadcasts never signal activity.

Accepted work is observed after two seconds, then every five seconds while active
or retrying, for at most five minutes. Timers are cancelled on unmount/hidden tabs;
visibility return and explicit checks re-observe durable state. Responses are ordered
within the observer. Completion broadcasts reload existing product readers; no score
or financial computation runs in the browser.

Fresh/aging data gets compact age/control presentation. Materially stale data gets a
non-blocking recent-payment warning; very/extended stale data also asks users to
verify payment activity. Reconnect and attention states retain the last good data.
Age alone never disables collection use. Reconnect/temporary auth failure permits
retained promoted accounting reads through the existing owned access context;
ordinary paid/free/currency entitlement still applies. Explicit disconnect remains
separate. This is a read-admission correction, not a materialization change. No new visual palette or animation is added.

Accounting maintenance does not claim a free UTC usage day. Existing collection
reads/mutations continue to enforce the five-day and Basic/Pro currency entitlements.
An exhausted user can maintain accounting but cannot use protected collections.

## Lifecycle and authorities

The durable lifecycle is `queued → running → preparing → complete`. Provider
failure before promotion follows the provider retry policy and leaves the prior
generation authoritative. Atomic promotion commits accounting and Promise outcomes
together, then moves work to derivative preparation. Preparation retries use their
own 1/5/15/60-minute sequence, never call Xero and never roll back successfully
promoted accounting. Existing lazy read-time feature/calculation ensures remain a
recovery fallback.

`complete` means the promoted generation is authoritative and the required
customer-feature population plus both normal portfolio calculation variants are
valid for current G/F/UTC-date/version/evidence identity. It does not freeze later
financial mutations; ordinary validity checks still apply.

Publication requires three distinct authorities: the refresh-worker attempt lease,
the accounting connection epoch/grant, and the existing generation lease/fencing
token. None substitutes for another. Loss of any relevant authority prevents stale
publication.

## Freshness policy

Authoritative observation age is classified once in the shared domain helper:

- fresh: less than 2 hours;
- aging but usable: 2 hours to less than 6 hours;
- materially stale: 6 hours through 24 hours;
- very stale: over 24 hours through 7 days;
- extended stale: over 7 days.

The approximately 60-minute opportunistic due threshold deliberately precedes the
first warning threshold. Age alone never makes a valid generation unusable, and
ordinary content continues from the current generation while refresh runs.
Reconnect, missing/corrupt authority and other safety failures are separate states.

## Provider boundary

Acceptance, coalescing, dispatch, attempts, retries, status and preparation
orchestration use provider-neutral accounting identities. Xero is the only
implemented provider. Xero OAuth, requests, mapping and evidence remain within the
Xero execution boundary. Future connectors can enter the same orchestration without
changing scoring, queues, Promises, disputes or operational history; no speculative
QuickBooks/Sage framework has been built.

## Programme performance outcome

Vercel functions run in `arn1`. Dashboard and other useful reads render independently
of provider work. Final hosted Test measured the real Xero execution pipeline at
about 8.2 seconds and derivative preparation below one second; both execute after
the product acknowledgement. An idle dispatcher tick performs bounded database work
in a few milliseconds and emits no worker request. Programme profiling showed that
remote/data-access waiting was the historical material bottleneck; benchmark and
base-scoring CPU was not.

## Rollout

Only Test migration/application and exact arn1 Preview certification are authorised.
Existing worker Test-project/authentication gates remain. Real Xero dispatch is enabled
explicitly in Test after local certification. Production configuration, scheduling and
main remain untouched. No new environment-variable name is required.

Phase 7.5 was certified at `8f41004745d93de097cdfeb412bfe0fc68bf6de6`
with the Test migration ledger at 32 and the full enabled suite at 2,327 passing.
The accounting-refresh/performance programme is closed in Preview/Test.
There is no additional Phase 7 work. Production rollout is outside this programme
closeout and remains part of the application's later overall launch.
