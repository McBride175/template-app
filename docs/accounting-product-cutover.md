# Product accounting refresh (Phase 7.5)

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

## Rollout

Only Test migration/application and exact arn1 Preview certification are authorised.
Existing worker Test-project/authentication gates remain. Real Xero dispatch is enabled
explicitly in Test after local certification. Production configuration, scheduling and
main remain untouched. No new environment-variable name is required.
