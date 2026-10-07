# Shared collection request context (Phase 5.3)

## Runtime and authentication

`vercel.json` sets `arn1` for future deployments of this source. This prepares future Production placement; it does not move an existing deployment. Production adoption requires its separately authorized release. Shared Vercel project defaults are not changed.

`lib/auth-api-boundary.ts` is an exact allowlist of eight audited API routes. Their proxy branch returns NextResponse.next before creating an Auth client. Each route still verifies getUser, directly or in its domain server helper. No identity header, browser claim or getSession result is trusted. `lib/supabase-server.ts` already writes refreshed/cleared/rotated cookies in Route Handlers. Protected pages retain proxy getUser and cookie refresh; OAuth callback and Stripe webhook matcher behaviour is unchanged.

API inventory: Dashboard bootstrap and collection actions/customers/customer-detail/override authenticate directly; collection action-history/invoice-promises/invoice-disputes authenticate in their server domain helper. Other collection, billing, privacy and Xero authenticated APIs retain proxy behaviour. Internal retention/sync routes remain secret-authenticated; contact remains intentionally public; Stripe and OAuth callbacks retain their existing signature/state/session boundaries. These unaudited routes are not exempted by a broad /api matcher.

## Database context

`read_collection_access_context` is a service-role-only, fixed-search-path STABLE read function. Its nested STABLE reads use the calling statement snapshot at READ COMMITTED, so G/F/P, owned connection, subscription and organisation cannot come from different concurrent database snapshots. It is not a lock, lease or permission to reuse identities after a mutation.

The context contains owned connection/grant status, authoritative cached subscription, validated active generation/success timestamp, latest run/freshness, F/P, organisation metadata and tenant-wide gross currency population. It uses the existing Dashboard context implementation. Invalid active pointers fail closed; null-G legacy remains explicit. Requested foreign tenants never grant access; the status context may describe the user's other owned connection, matching existing Dashboard behaviour.

Gross currency gating uses the exact positive open ACCREC, nonblank-customer population and valid three-letter currency normalization. The database aggregates count/distinct currencies and transfers no invoice history. This is a thin generation-scoped SQL aggregation, not a new persisted currency authority. Unknown financial valuation remains governed by the existing currency-health layer; an empty currency set does not assert valid monetary state.

Paid policy stays in TypeScript and must match the database's configured-price/status/paid-through result. Paid access skips the free ledger. Free users retain a separate claim_billing_usage_day transaction with its existing five distinct UTC day, user/tenant identity, lock and replay semantics. A later domain command failure cannot roll back the claim. No browser entitlement is accepted.

## Integration and fences

The four read routes and Priority/Action History/Promise/dispute preparation consume explicit request context. Promise/dispute use a server-only branded snapshot adapter after the exact scope and succeeded-run verification. They retain domain preparation, digest, revisions, evidence, receipt replay, commit locks and post-commit reconciliation checks. Pre-mutation F/P is never reused as post-mutation current state.

Paid warm queue and detail: context + existing two projection/detail RPCs = three database operations, plus one route Auth. Existing final G/F/P/customer fences are retained. Dashboard keeps initial and final access contexts plus two projection RPCs (four DB operations), plus one route Auth. Onboarding/failure paths have fewer operations; free paths add an independently committed claim.

The ordinary list uses context + feature population + overrides (three DB operations for one warm population chunk). Features/overrides start concurrently only after granted access and a usable gross-currency context. Legacy fallback retains its original sequential currency gate. Large populations still require bounded feature chunks and existing validity checks.

Missing access RPC only uses explicit staged-rollout compatibility. Transport failures, malformed context and entitlement mismatches fail closed. No process cache or global request identity is introduced.

## Validation

Frozen domain/DTO tests retain their original access test doubles through an explicit test-only adapter. New real-context tests separately replay all canonical migrations into disposable PostgreSQL and verify context parity, paid/free claims, exhaustion, tenant isolation, invalid generations, gross currency population and service-only execution. API tests verify all eight routes deny unauthenticated valid requests and that the installed SSR client refreshes expired API cookies without proxy Auth.
