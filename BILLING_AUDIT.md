# Billing enforcement audit

Audit date: 2026-09-06

## Pre-fix state machine reconstructed from the repository

This section records the implementation as it existed before the audit fixes.

1. `GET /api/collections/actions` authenticated the caller and selected the most
   recently updated active Xero connection, or an explicitly requested active
   tenant owned by that user.
2. A local `subscriptions` row was treated as paid only when its status was
   `active` or `trialing` and `current_period_end` was either null or later than
   the application server's current time. `stripe_price_id` was not checked.
3. An unpaid user's allowance was the total number of
   `billing_usage_days` rows for the selected Xero tenant. It was therefore a
   tenant allowance, despite UI copy and the product requirement describing a
   user allowance.
4. Access was allowed only while that count was less than five. The collection
   queue was loaded and returned, then the current UTC date was inserted with an
   upsert on `(tenant_id, usage_date)`.
5. Consequently the first request on distinct UTC day five was allowed and
   returned data, but the response's recomputed entitlement said access was
   exhausted. Any refresh later on that same UTC date was rejected. Day five
   was not a full usable day.
6. No tenant meant no usage was recorded. Paid requests did not record usage.
   Repeated requests on the same tenant and UTC date were deduplicated by the
   database unique constraint.
7. Loading `/dashboard` in a JavaScript-enabled browser caused the collection
   client to call `GET /api/collections/actions`, so a successful dashboard load
   counted. The page itself did not enforce access server-side.
8. Every other collections mutation/read endpoint, Xero sync/raw endpoint, and
   canonical-data server page lacked the usage entitlement check. Authenticated
   users could also call Supabase's Data API directly for their own canonical
   Xero rows, collection actions, and overrides because table grants and RLS
   policies explicitly allowed it.

### Pre-fix subscription states

| Local Stripe status | Main collection entitlement | Other helper |
|---|---:|---:|
| `active` | paid when period end was null or future | paid only with future period end |
| `trialing` | paid when period end was null or future | paid only with future period end |
| `past_due` | unpaid | paid with future period end |
| `unpaid` | unpaid | unpaid |
| `canceled` | unpaid | unpaid |
| `incomplete` | unpaid | unpaid |
| `incomplete_expired` | unpaid | unpaid |
| `paused` | unpaid | unpaid |
| missing row | unpaid | unpaid |

Cancellation scheduled at period end remained `active` in Stripe and therefore
retained access until `current_period_end`. The success URL did not grant access.
The application relied on webhook delivery to update the local cache. Created
and updated subscription webhooks retrieved current Stripe state, which made
duplicates and reordering for the same subscription mostly harmless, but an
event for an older subscription belonging to the same customer could overwrite
the user's newer subscription row.

## Intended model used by the fixes

- Five distinct UTC calendar dates are usable per authenticated user. The same
  five-date ceiling is retained for each Xero tenant as a reset-abuse defense,
  so neither adding another tenant to the same account nor recreating an account
  against an exhausted tenant restarts the allowance.
- A request on a date already recorded for that user remains usable, including
  all repeated requests on usage day five. The first request on a sixth distinct
  UTC date is rejected before protected work or protected data access.
- Any direct invocation of a billable server surface claims/checks the day at a
  common server boundary. Account, privacy, authentication, Stripe webhook,
  Xero OAuth connection management, and billing-management endpoints remain
  available because they are not product functionality being sold.
- `active` and `trialing` are entitled only for configured paid price IDs and a
  valid future paid-through timestamp. All payment-problem and terminal statuses
  are not entitled.
- Stripe's signed webhooks populate the local entitlement cache. Cache writes
  prefer the newest Stripe subscription creation time so late events for an old
  subscription cannot replace a newer subscription.

The product previously described usage as tenant-scoped in `ARCHITECTURE.md`,
while the stated commercial requirement is user-scoped. This audit treats the
explicit requirement ("A user can use the product for up to 5 usage days") as
authoritative and updates the implementation documentation accordingly.

## Post-fix behavior matrix

| # | Scenario | Required and implemented result |
|---:|---|---|
| 1 | Brand-new user | Zero consumed days; first protected request may claim a day. |
| 2 | First dashboard use | The protected queue request atomically records UTC day 1, then returns data. |
| 3 | Multiple visits on one date | One row/count; every request remains allowed. |
| 4 | Second distinct date | Atomically records day 2 and allows it. |
| 5 | Dates 3, 4, and 5 | Each date is recorded once and is usable. |
| 6 | Immediately after claiming date 5 | Access remains allowed for the rest of that same UTC date. |
| 7 | First request on date 6 | Rejected with HTTP 402 before protected work or data access. |
| 8 | Direct protected-page navigation | Server page redirects an exhausted unpaid user to pricing. |
| 9 | Direct protected API request | Server returns HTTP 402; the browser UI is not trusted. |
| 10 | Repeated sessions on one date | Still one usage date, independent of session count or sign-in cycles. |
| 11 | Crossing midnight | The first protected request after UTC midnight attempts to claim the next date. |
| 12 | UTC versus user/business timezone | UTC is authoritative; user and Xero business timezone are not consulted. |
| 13 | Requests around midnight | Dates immediately before and after UTC midnight are distinct. |
| 14 | Artificial time advancement | Injected `Date`/usage date tests advance time instantly, with no sleeps. |
| 15 | Parallel first requests | User and tenant advisory locks plus uniqueness produce one consumed date. |
| 16 | Active subscription | Allowed only for a configured paid price and future `current_period_end`. |
| 17 | Trialing subscription | Same entitlement requirements as active. |
| 18 | Cancel at period end, still paid through | Stripe remains active; access continues strictly before period end. |
| 19 | At/after paid-through time | Denied even if a stale local row still says active. |
| 20 | Past due | Denied. This is the conservative rule inferred from the primary pre-fix gate. |
| 21 | Unpaid | Denied. |
| 22 | Canceled | Denied. |
| 23 | Incomplete | Denied. |
| 24 | Missing local subscription | No paid entitlement; free-day rules apply. |
| 25 | Local cache temporarily disagrees with Stripe | Signed-webhook cache is authoritative locally; a cached grant is bounded by its paid-through timestamp. |
| 26 | Free user reaches limit then subscribes | Remains blocked until trustworthy paid state is cached, then allowed. |
| 27 | Payment succeeds and webhook activates | Signed webhook retrieves Stripe state and activates only if policy requirements pass. |
| 28 | Successful payment, delayed webhook | Exhausted user remains blocked; no optimistic entitlement is granted. |
| 29 | Checkout success return before webhook | Visiting the return URL cannot grant entitlement. |
| 30 | Paid user cancels at period end | Continues through the already-paid period while Stripe status remains active. |
| 31 | Canceled user reaches period end | Denied by status and/or paid-through boundary. |
| 32 | Previously paying user resubscribes | A newer Stripe subscription replaces the old cache row and can grant access. |
| 33 | Duplicate webhook delivery | Reapplying the same subscription state is idempotent. |
| 34 | Out-of-order webhook delivery | Same-subscription updates retrieve current Stripe state; older subscriptions cannot replace a newer one. |

The original day-five behavior was ambiguous in code: one request worked and
later requests on that date did not. The product wording “up to 5 usage days”
most naturally means five fully usable dates, so the implemented and tested
rule is “dates 1–5 are usable; the first new date 6 is blocked.”

Stripe does not prescribe the commercial rule for `past_due`. This audit keeps
the primary gate's existing conservative behavior and removes a conflicting
legacy helper that granted `past_due`. A Stripe subscription whose actual
status is `paused` is denied. Stripe's separate `pause_collection` setting can
leave status active; because the application does not store that setting and no
commercial rule exists for it, such an administrator-initiated pause continues
to follow the active/future-paid-through rule.
