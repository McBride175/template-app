# Application Architecture

This document is the high-level source of truth for environments, deployment, database workflow, security boundaries, and external integrations. Read it before making architecture, database, authentication, or deployment changes.

## Environments

| Environment | Application | Supabase | External-service intent |
|---|---|---|---|
| Local | `http://localhost:3000` | Test project `rbmxegyiwntomhpbepnu` (`Template app test`) | Test/sandbox credentials where the provider supports them |
| Vercel Preview | `develop` branch and other unassigned branches; per-deployment URL | Test project `rbmxegyiwntomhpbepnu` | Stripe test/sandbox mode; other provider applications may intentionally be shared with Production |
| Vercel Production | `main` branch; `https://template-app-inky.vercel.app` | Production project `sswyxbugbdoadktyaows` (`McBride175's Project`) | Stripe live mode; reviewed Production credentials/configuration |

`develop` is the active pre-launch development branch. Its pushes create Vercel Preview deployments and do not automatically deploy to Production. Vercel's configured Production Branch is `main`.

The deployment currently serving the public Production alias was manually promoted/rebuilt from historical `test-stripe@ed5ae80`. That historical source does not change the automatic Production Branch, which remains `main`. During pre-launch, Production may intentionally lag significantly behind `develop`; promoting development code is a deliberate future release decision.

Use the same environment-variable names everywhere and scope their values in `.env.local` or Vercel. Never infer an environment from a secret prefix alone, and never commit an environment file.

## Deployment

- Local and Vercel Preview deliberately share the Test Supabase project.
- Vercel Production uses the separate Production Supabase project.
- `develop` is the sole authoritative active development branch. Its stable branch alias is `https://template-app-git-develop-james-mcbrides-projects.vercel.app`; individual Preview deployment URLs remain immutable.
- Pushes to `main` are eligible for automatic Production deployment. Pushes to unassigned branches, including `develop`, create Preview deployments instead.
- Preview URLs are dynamic. OAuth and email links must use the request origin or `NEXT_PUBLIC_SITE_URL` rather than a hard-coded Preview hostname.
- A deployment is not ready merely because the application build succeeds: its Supabase schema, Auth redirects, webhooks, OAuth callbacks, and environment-scoped credentials must also be ready.
- Database changes go to Test first. Production receives the same reviewed forward migration only after Test validation.

## Database workflow

The canonical schema starts at:

`supabase/migrations/20260813205201_baseline_current_schema.sql`

The pre-baseline SQL files are preserved under `supabase/migrations_legacy/`. They are historical evidence, not an executable migration chain.

Rules:

1. The canonical baseline is the source of truth for an empty application database.
2. Every later schema change gets a new 14-digit timestamped, forward-only migration in `supabase/migrations/`.
3. Never edit a migration after it has been applied to a shared environment.
4. Do not make manual hosted SQL changes without representing the same change in Git.
5. Validate a clean local replay, then Test, before a reviewed Production rollout.
6. Do not run `db push`, migration repair, or hosted SQL without explicit authorization and an exact project-ref preflight.

At baseline creation time, neither hosted project has a reconciled migration ledger. Test already contains most schema objects from manual SQL; Production has no public application schema. A later controlled reconciliation must align Test and record the baseline appropriately, while Production should receive the verified baseline normally. Do not blindly replay the archived migrations or the baseline over Test's existing objects.

## Database model

### Core and billing

- `subscriptions` caches Stripe subscription state, keyed by `user_id`. Stripe customer and subscription IDs are unique. `current_period_end` is nullable for valid transient states.
- `stripe_customers` maps Stripe customer IDs to Supabase users for server-side webhook resolution.
- `notes` provides authenticated user-owned CRUD.
- `billing_usage_days` records at most one free-use day per authenticated user and UTC calendar date. Tenant history is also retained so changing accounts cannot reset an already exhausted Xero organisation. The service-role-only `claim_billing_usage_day` function serializes each user/tenant claim and atomically enforces the five-day limit.

Stripe remains authoritative for subscription state; the Supabase subscription row is a cache used for UI and entitlement checks. Only `active` and `trialing` rows for a configured Basic or Pro price with a future `current_period_end` grant paid access.

### Support and privacy

- `support_tickets` stores support submissions. The contact route inserts through the service role, including for signed-out users.
- Email-delivery metadata is intentionally not persisted. `sent_at`, `resend_message_id`, and `email_error` were unused optional scaffolding and are not part of the canonical schema.
- `user_privacy_preferences`, `privacy_requests`, `privacy_request_events`, and `privacy_exports` support GDPR/UK GDPR workflows.
- Privacy routes authenticate and authorize the caller in application code, then use the service-role client for database operations.

### Xero and collections

The final Xero design contains only:

- `xero_oauth_grants`: encrypted grant-scoped tokens and refresh locks
- `xero_connections_public`: per-user/per-tenant public connection metadata, grant linkage, auth state, and tenant auto-sync locks
- `xero_sync_tenant_state`: authoritative per-user/per-tenant active and latest generation pointers and successful-sync freshness
- `xero_sync_runs`: fenced generation ownership, lifecycle, and promotion history
- `xero_sync_run_steps`: trusted resource, mapping, and validation manifest evidence
- `xero_sync_run_validations`: versioned promotion-readiness evidence bound to a run and fence
- `xero_raw`: immutable user/tenant/run-scoped provider snapshots, plus transitional legacy rows
- `canonical_organisations`: explicit Xero organisation identity, base currency, country, timezone, and source retrieval metadata
- `canonical_customers`, `canonical_invoices`, and `canonical_payments`: normalized accounting data
- `canonical_payment_evidence`, `canonical_unapplied_cash_evidence`: exact generation-scoped payment/remaining-cash evidence, independent of collections amounts
- `xero_accounting_evidence_observations`: resource completeness and fetch-start provenance for later Promise use
- `canonical_credit_note_evidence`: exact generation-scoped AR credit-note residual evidence, separate from Promise cash
- `xero_customer_credit_validations`: generation-scoped credit-note traversal and ordered observational stability evidence, with fenced ready/unavailable certification
- `customer_overrides`: user-controlled collection priority overrides
- `invoice_disputes`: user-authored invoice dispute state keyed by user, tenant, provider, and provider invoice ID independently of Xero sync generations
- `invoice_promises`, `invoice_promise_events`: invoice-level commitment storage and immutable lifecycle history; service-only atomic commands, atomic accounting-promotion reconciliation and canonical collections actionability; no Promise editor/UI yet
- `xero_scheduled_sync_runs`: internal scheduler lock and cadence state
- `collection_actions`: user-owned action history

The legacy `xero_connections`, transient `xero_connection_secrets`, tenant-scoped refresh-lock RPCs, and orphaned `set_updated_at_xero_connections()` function are not part of the final architecture.

An invoice dispute is not attached to a generation-specific `canonical_invoices.id`. Its
recorded native amount and last-reviewed native balance persist independently;
effective disputed and collectible amounts are derived from the current
authoritative invoice snapshot. A zero or absent current invoice does not
automatically resolve the user-authored dispute. Customer summary loads tenant-owned
disputes once, joins them by durable provider invoice ID, and uses the dispute
domain derivation before current-debt scoring. Gross accounting balances remain
separate from collectible balances. Customer Exposure uses certified customer-level
overdue To chase; actionable invoice counts and weighted overdue age remain invoice-derived.
Portfolio Exposure benchmarks use the customer-level amount while ageing benchmarks
retain the pre-credit invoice population;
historical paid-invoice timing and payment recency remain unchanged.
Collections recommendation amounts and actionable invoice counts are explicit
collectible fields; existing outstanding balances and invoice counts in the
customer and actions APIs retain gross accounting meaning. The customer list's
balance sorts and overdue filter also use gross accounting data, while the
recommendation queue uses collectible debt. Gross base totals are nullable
when any contributing open invoice lacks a trustworthy valuation; a known
subtotal is never presented as a complete total. Gross FX validity is checked
independently from collectible scoring health, and currency-review native
"invoiced outstanding" remains gross.

The customer collections page provides invoice-level dispute entry and an
explicit bulk full-dispute action for selected or all eligible current invoices.
Ordinary bulk controls exclude explicitly resolved disputes; those require
Reactivate before they can be included again.
`/api/collections/invoice-disputes` reads the held authoritative customer
snapshot and delegates every mutation to the authenticated dispute domain.
The server validates provider invoice IDs, ownership, open receivable state,
and the current native AmountDue before writing. Existing-row mutations require
the dispute's monotonic revision and use conditional writes; only explicit
Reactivate changes a resolved row back to active. Bulk full disputes validate
every selected invoice for the same customer, then use one service-role-only
transactional database function to check all revisions, preserve existing notes,
and write the complete set or none. The invoice-management API returns an
explicit native-currency DTO without unvalidated base amounts. Customer and actions
data is reloaded after mutation; a saved-but-unrefreshed state is retained above
the customer list and hides stale mutation controls. No score is calculated in the browser. The
priority queue links to customer invoice context. No customer-wide dispute
record is created by this flow.
The shared editor also reloads canonical data after a rejected stale accounting
amount, non-open invoice, or unavailable invoice; it closes the rejected form
without replaying its input or reporting a successful save.

`/disputes` is an authenticated, non-indexable invoice dispute worklist. Its
dedicated read endpoint holds one authoritative snapshot, loads tenant-owned
disputes once, and joins invoices/customers in bounded identity batches. It does
not run the scorer. Missing invoices remain visible; retained generations may
provide explicitly labelled last-known names/references/currency only, never
current balance or settlement evidence. The DTO keeps native recorded/effective/
collectible amounts separate and validates comparable base values through the
existing gross currency-health classifier. Active is the default; needs-review,
resolved, accounting-settled, unavailable and all views are derived filters.
Search, customer, amount/overdue-age sorting and bounded pagination use URL state
and stable dispute-ID tie breaks. The worklist shares the customer invoice
editor and existing revision-safe mutation API. Save/conflict outcomes survive
failed reloads, and stale controls are withheld until fresh worklist data loads.

Canonical application reads resolve one authoritative snapshot per user and tenant. A non-null
`xero_sync_tenant_state.active_sync_run_id` is authoritative only when it references that exact
user/tenant's succeeded run; all related organisation, customer, invoice, and payment reads are
then scoped to that exact `sync_run_id`. A missing tenant-state row or an explicitly null active
pointer uses only the transitional legacy `sync_run_id IS NULL` rows. An invalid non-null pointer
fails closed and never falls back to legacy data. The resolved snapshot is held for the full logical
read so concurrent promotion cannot mix generations. Status freshness follows
`last_successful_sync_at` for promoted generations and the latest legacy raw fetch only in legacy
mode.

Manual, automatic, and scheduled synchronization use one authoritative generation lifecycle. A
sync acquires a tenant-scoped fenced run, imports a complete immutable raw snapshot, maps a
generation-scoped canonical snapshot, passes `collections_readiness_v2`, records current-fence
validation evidence, and atomically promotes the run. Success is reported only after promotion.
Normal sync never dual-writes the transitional legacy cache. Any failure before promotion leaves
the previous active generation authoritative; for a tenant with no active generation, only explicit
legacy `sync_run_id IS NULL` data can act as the transitional fallback. The same-run
reacquisition/revalidation operator is recovery tooling and is not part of normal sync execution.

Xero token, auto-sync, and scheduler RPCs are `SECURITY DEFINER`, have a fixed `pg_catalog, public` search path, and are executable only by `service_role`. The scheduled candidate RPC is the final stale-aware three-argument version.

### Currency data contract

Transaction/native currency, organisation base currency, and SaaS subscription billing currency are separate concepts. Xero invoice amounts remain available in their transaction currency, while derived base-currency amounts use the connected organisation's explicit ISO currency code.

Normal generation sync retrieves Xero `Organisation` metadata as the authoritative organisation and base-currency source. The retained legacy sync can also retrieve `Organisation/Actions` for a `UseMulticurrency` diagnostic, but that diagnostic is neither part of normal generation ingestion nor a currency-safety gate. Xero `CurrencyRate` is transaction-currency units per one organisation base-currency unit, so a foreign invoice is converted with `base = native / CurrencyRate`. If transaction and base currency match, conversion is identity and no rate is required or invented. A foreign invoice with a missing, zero, negative, or otherwise unusable rate retains its native data but has null base amounts and an explicit incomplete conversion reason. A foreign rate of exactly one is valid and is not rejected merely for being unusual.

Canonical conversion preserves native decimal precision and rounds foreign-derived base amounts to eight decimal places using half-away-from-zero rounding. Conversion is deterministic from the raw invoice plus canonical organisation metadata and does not use an external or current-market FX provider. It does not attempt to recreate Xero's realised or unrealised gain/loss accounting.

Base-currency conversion is an accounting/scoring correctness layer: it is always performed and never disabled by subscription tier. Product access is a separate entitlement. For that entitlement, the collections portfolio is `multi_currency` only when its current positive, open `ACCREC` population contains more than one valid invoiced currency; Xero `UseMulticurrency`, settled or historical invoices, country, and base currency do not determine the mode. The existing five distinct UTC usage days evaluate both modes. After that allowance, Basic permits single-currency collections and Pro permits single- or multi-currency collections. Because mode is derived from current receivables, Basic access is restored automatically when foreign exposure settles and the open population returns to one currency.

All cross-invoice and cross-customer monetary collections prioritisation operates in the authoritative Xero organisation base currency. Native invoice currency remains source/accounting context and must never be directly aggregated with another currency. Gross customer balances retain canonical `amount_due_base`; collectible balances subtract the effective dispute through the canonical dispute domain. Balance-weighted overdue age uses collectible base amounts in both its numerator and denominator. Exact PostgreSQL numeric strings are summed before one controlled conversion to JavaScript numbers at the dimensionless scoring boundary.

The collections currency-health gate evaluates open, positive collectible `ACCREC` obligations before aggregation. Healthy data produces the complete ranking. An isolated incomplete or inconsistent conversion on collectible debt degrades the result: every customer affected by such an invoice is excluded in full from scoring and exposed separately for review, while safely valued customers are ranked using provisional portfolio metrics calculated only from that safe population. A fully disputed FX-invalid invoice contributes no collectible debt and does not degrade scoring, but its gross base balance remains explicitly unavailable. Missing or conflicting authoritative organisation base currency makes the ranking unavailable because no reliable common monetary unit exists. Collectible unconvertible debt is never treated as zero, interpreted in native units, or assigned a guessed rate. Paid historical invoices do not degrade the queue when only their dates are used for historical lateness.

Currency access and currency health are independent contracts. Currency access continues to use gross positive open Xero receivables, including disputed invoices. A paid Basic user with a current multi-currency population is denied the normal collections read and mutation APIs with a structured Pro-required response, without filtering foreign invoices or changing canonical data. Free-allowance and Pro users continue into the existing healthy, degraded, or unavailable currency-health flow. Single-currency presentation stays unchanged; allowed multi-currency presentation leads with organisation-currency equivalents and shows compact invoiced-currency amounts as secondary context without exposing exchange rates.

### Pure invoice actionability (Phase 4)

`lib/collections/invoice-actionability.ts` provides the canonical pure calculation:
current invoice → existing dispute derivation → fixed Promise derivation → To chase.
`deriveInvoicePromise` consumes only operational status, fixed commitment and an
already-certified paid total. Active coverage is capped by post-dispute native debt;
terminal commitments supply zero coverage. No date/clock check expires a Promise.
The canonical `activePromisedCoverageAmountNative` and `toChaseAmountNative` are exact
decimal strings. Base coverage is the existing post-dispute base remainder minus
the final To-chase valuation, preserving reconciliation without independently
rounding each component. Missing/invalid current accounting data leaves To chase
unavailable. See `docs/invoice-actionability.md` for the input/output contract.
Customer aggregation and invoice DTOs now consume this domain (Phase 7). Outcome
reconciliation runs at certified generation promotion. Unapplied cash has no actionability
effect. Legacy collection-action `promised_to_pay` no longer suppresses customers;
explicit `action_type = postponed` still suppresses until its next-action date.

### Generic Action History persistence (Phase 2)

`collection_actions` retains legacy contact/postponement rows and now also stores
customer-level V1 `action_type = outcome` records. V1 writes accept only
`no_response`, `message_sent`, `responded_no_commitment`, and
`reviewed_no_chase`, with a bounded optional note and required date-only
`next_action_date`. The durable key is owner, Xero tenant, provider (`xero`),
and Xero ContactID; no generation-specific canonical UUID is stored. The server
uses the authoritative organisation timezone for its default next day and
custom-date validation, falling back to UTC if timezone metadata is unavailable.

`/api/collections/action-history` authenticates and scopes create, latest,
bounded customer-history, and delete operations. Create requires a caller-stable
action UUID for retry deduplication and validates the current owned canonical
customer. History reads include V1 rows only; legacy rows remain stored and
available to existing consumers and privacy export. This persistence phase does
not change queue eligibility, portfolio benchmarks, scoring, or invoice
Promise/Dispute authority.

### Action History queue eligibility (Phase 3)

The Actions queue first loads authoritative customer accounting and operational
coverage, builds monetary and invoice-ageing populations, and calculates
portfolio benchmarks and customer scores. A shared eligibility decision then
applies the latest V1 outcome's `next_action_date`, legacy postponement, existing
same-day legacy action, founder `do_not_chase`, and no-actionable-debt rules.
V1 dates expire on the Xero organisation's calendar date (UTC fallback); legacy
postponement retains its existing UTC return-date comparison. Temporary
deferrals are removed before the response limit. The same decision feeds queue
counts and first-value/founder selectors; Customers browsing and direct reads
remain unaffected.

The server-only `latest_collection_queue_actions` RPC uses indexed, per-customer
latest V1 and legacy lookups in bounded batches. It returns no score input.
Failure to read required Action History data fails the Actions queue closed.

### Action History recording experience (Phase 4)

The priority card presents four V1 outcome buttons. An optional note and
follow-up timing are separate disclosures; the default request omits the date
so the server calculates tomorrow. The queue response supplies organisation-
calendar presets for custom timing. A confirmed write removes the customer
from the displayed card immediately, followed by one authoritative queue
reload for current eligibility, counts and the next card. Undo deletes the
stable V1 action ID and reloads the queue before restoring focus. A failed or
uncertain create retains the same ID for retry. Previous/Next only navigate.

The queue's bounded latest-action RPC also returns a short V1 note excerpt for
compact recent activity. Retained legacy actions are labelled as legacy facts,
and invoice Promises and Disputes remain in their own interfaces. The persistent
founder override is displayed as Never chase; its stored `do_not_chase` value
and scoring behaviour are unchanged.

### Customer collection history (Phase 5)

`/customers/[customerSourceId]/history` reads one owned current customer by
durable Xero source ID in the held authoritative tenant snapshot. A dedicated
service-role-only, security-invoker SQL function projects V1 and retained legacy
`collection_actions`, immutable `invoice_promise_events` joined to their
authoritative Promise, and only created/currently-resolved Dispute timestamps.
It orders by timestamp and namespaced event ID and returns a bounded keyset
page. Current invoice numbers are resolved in one snapshot-scoped batch solely
for display; missing references fall back to the provider invoice ID. Dispute
ownership is established only through an invoice in the held snapshot, and
conflicting retained customer identities suppress the milestone. A missing
current invoice or ambiguous ownership makes that Dispute milestone unavailable
rather than inventing historical customer ownership. Promise and Dispute storage is never
copied into generic actions. The history endpoint is independent of queue
ranking and actionability. Only V1 generic actions may be deleted here, through
the existing scoped Action History delete contract; the page then reloads
history without mutating queue state.

### Structured Promise recommendation inputs (Phase 7)

One paginated, owner/tenant/provider-scoped Active operational Promise read supplies
an invoice identity map. Numeric SELECT casts return exact commitment/paid text;
no payment baselines, evidence, events or resolver enter scoring reads. A final
snapshot check rejects reads spanning promotion, so live Promise evaluation state
cannot be combined with balances from another generation. Missing Active invoice
context fails closed rather than asserting zero debt.

Canonical invoice To chase is summed into customer `to_chase_*` fields and the
existing `collectible_*` compatibility aliases. Effective disputed and active promised
coverage totals remain separate from retained gross accounting values. Invoice-level
To chase drives weighted age, actionable invoice counts and current relative
deterioration; certified customer-level overdue To chase drives Exposure and monetary
queue eligibility. The 50/25/15/10 scorer,
bonuses, overrides, payment recency and historical payment baseline are unchanged.
Fully covered debt leaves the chase queue; terminal commitments supply no coverage.
FX health evaluates positive To chase; plan entitlement still evaluates gross invoices.
Invoice To chase remains invoice-derived; queue and first-value operational
eligibility use the customer net amount without allocating credit to invoices.
Legacy contact rows are retained
without backfill; their date is historical and does not schedule monetary suppression.
Phase 8 adds invoice Promise editing and bounded lifecycle history; unified Action History remains separate.
See [the integration contract](docs/promise-collections-integration.md).

### Pure Promise evidence resolution (Phase 5A)

`promise-payment-qualification.ts` consumes complete canonical exact payment evidence
and the immutable creation baseline. It recomputes an uncapped paid total using
durable non-baseline invoice payments within the organisation-local creation/deadline
calendar window. `promise-outcome-resolution.ts` returns a versioned pure decision:
retain Active, Kept, Missed, Unclear or technical defer. Terminal commitments never
transition again. Cash only vetoes a negative outcome; no allocation or actionability
effect exists. Negative resolution needs complete ready evidence with all resource
starts on/after the next-local-day boundary; early Kept needs complete payment proof.
The functions themselves do not call database writers or sync. Phase 5B now
consumes them at atomic accounting promotion; queue actionability is integrated through Phase 4; Promise UI is provided in the customer invoice context. See `docs/promise-outcome-resolution.md` for the exact
contracts and Phase 5B persistence handoff, including nonterminal evaluation support.

## Database access model

Promise persistence is intentionally stricter than direct service-role CRUD.
`invoice_promises` and `invoice_promise_events` permit service-role SELECT only;
`apply_invoice_promise_command` writes commitment/lifecycle changes; the bounded
`record_invoice_promise_evaluation` writes only certified nonterminal evaluation fields. It atomically
checks expected revisions, updates operational state and appends immutable events.
A partial unique index permits one active commitment per durable invoice identity.
Terminal commitments cannot be edited or reactivated. Deferred integrity checks
require the last event's terms/status to agree with the operational record; event sequence is
independent of operational revision. Auth-user erasure cascades both tables.
Sync-run provenance is retained as UUID values rather than retention-coupled FKs,
with owner/tenant checks when the command first uses it. Accounting promotion now reconciles this storage from certified evidence.
Collections reads now use canonical structured Promise actionability; legacy
promise contact outcomes no longer suppress the queue. See `docs/invoice-promises-persistence.md` for the command contract.

RLS is enabled on every application table. Grants are explicit rather than relying on Supabase's broad default privileges.

| Access | Tables |
|---|---|
| Authenticated user SELECT | `subscriptions`, `xero_connections_public` |
| Authenticated user CRUD | `notes` |
| Service role only | `stripe_customers`, `support_tickets`, all privacy tables, `xero_oauth_grants`, `xero_scheduled_sync_runs`, `xero_sync_tenant_state`, `xero_sync_runs`, `xero_sync_run_steps`, `xero_sync_run_validations`, `billing_usage_days`, `xero_raw`, canonical Xero tables, `customer_overrides`, `collection_actions`, `invoice_disputes` |
| Anonymous browser | No direct application-table access |

User-accessible tables have `auth.uid() = user_id` policies. Server-only tables have RLS enabled, no browser policies, and explicit revocation from `anon` and `authenticated`. Service-role credentials are server-only and bypass RLS. Billable server routes authenticate the user, atomically claim/check the current UTC usage date, and only then query service-role-only product data with explicit `user_id` and `tenant_id` filters.

## Authentication and Google OAuth

Supabase Auth is the identity system of record. Browser/server session clients use the public Supabase URL and anon key; the Next.js proxy refreshes cookie-based sessions.

Google sign-in flow:

1. The login page calls `supabase.auth.signInWithOAuth({ provider: 'google' })`.
2. Google returns through Supabase Auth.
3. The application callback `/auth/callback` exchanges the authorization code for a session.
4. The user is redirected to the application.

Application code controls the application callback and post-login redirect. Supabase controls provider enablement, Site URL, and allowed redirects. Google Cloud controls the OAuth client and Supabase callback URIs.

Preview and Production may use the same Google OAuth client if every required Supabase callback URI and origin is configured. Because Test and Production are separate Supabase projects, both project callback URLs must be accounted for even when the Google client is shared.

Public email/password sign-in and signup, magic links, and password recovery support Cloudflare
Turnstile through `NEXT_PUBLIC_TURNSTILE_SITE_KEY`. The browser passes the completed challenge as
Supabase Auth's `captchaToken`; Supabase validates it with the environment's Turnstile secret.
That secret belongs only in the Supabase Auth dashboard, never in this repository or Vercel.
Google OAuth and authenticated direct password updates do not use the CAPTCHA token.

Supabase Auth email transport is configured in Supabase rather than application code. Production
must use reviewed custom SMTP and an authenticated Auth sending domain; the built-in sender is
Test-only. Operational ownership and the hosted-testing guard are in
`AUTH_EMAIL_OPERATIONS.md`.

## Stripe

Stripe is authoritative for customers and subscriptions.

- Checkout is created by authenticated server routes.
- Stripe webhook signatures are verified before processing.
- Webhook handlers use service-role writes and idempotent cache application because events can arrive more than once or out of order. Cache replacement compares Stripe subscription creation times so events for an older subscription cannot replace a newer subscription row.
- `checkout.session.completed` retrieves the signed session's subscription from Stripe and caches its actual status, price, and item period end. Visiting the checkout return URL does not grant access.
- Preview uses Stripe test mode and a Preview webhook secret. Production uses live mode and its own Production webhook secret and Price IDs.
- Checkout success/cancel URLs are derived from the request origin.

## Xero

Xero OAuth uses `XERO_CLIENT_ID`, `XERO_CLIENT_SECRET`, `XERO_REDIRECT_URI`, and `XERO_TOKEN_ENCRYPTION_KEY`. The callback route is `/api/xero/callback`. Tokens are encrypted before storage in `xero_oauth_grants`; plaintext token tables are not permitted.

The code supports one Xero configuration per deployment environment. Preview and Production may intentionally share one Xero developer application if that application's redirect configuration supports both environments. Separate applications are not assumed or required by the code.

Manual, Dashboard automatic, and scheduled synchronization all call the authoritative generation-sync orchestrator with service-role database access. Internal sync endpoints require an internal/cron secret, and scheduled sync is disabled unless explicitly enabled. Fenced ownership, current-contract validation evidence, and promotion targets are server/database controlled rather than browser supplied.

Public Xero disconnect revokes the selected connection/grant linkage but does not purge accounting
snapshots or generation history. The route explicitly rejects `purgeData: true`; a future purge
would require a separate atomic contract covering generation state, validation evidence,
collection metadata, and both generation and legacy snapshots.

### Atomic Promise reconciliation (Phase 5B)

Certified candidate evidence is prepared in one held owner/tenant/generation
snapshot. Internal `lib/xero/promise-reconciliation.ts` delegates all qualification
and lifecycle decisions to Phase 5A, then commits those proposals through
`promote_xero_sync_run_with_promises`. Existing fenced promotion, Promise
paid/evaluation updates and terminal events succeed in the same transaction.
The complete Active ID/revision set and evidence digest are revalidated under
shared tenant/generation locks; stale proposals recompute against the same
canonical generation at most three times, without extra Xero requests.
Nonterminal evaluations append no lifecycle event. With any Active Promise in
the locked tenant set, unready Promise evidence rejects publication and retains
the previous accounting/Promise state. With zero Active Promises, ordinary
accounting promotion rules remain unchanged. Repeated/uncertain committed
promotion is a read-only no-op. Empty Active sets skip evidence loading.

Authenticated Promise CRUD and customer-summary/queue integration are implemented;
Promise editor/history UI is not. Unapplied cash remains outcome-only and is never
allocated. See [the reconciliation contract](docs/promise-reconciliation.md).

### Canonical accounting evidence (Phase 3A)

Generation sync independently observes full Payments, Overpayments and Prepayments,
including paginated catch-up. Exact monetary tokens use lossless JSON parsing and
PostgreSQL numeric storage; service-only exact read views return decimal text.
The existing authorised payment-recency projection and `collections_readiness_v2`
promotion contract remain unchanged. Evidence resource failures record unavailable
streams rather than zero cash, without making Promise readiness a general promotion prerequisite: it is required
only when the locked tenant set contains Active Promises. Fenced evidence persistence failures still fail the candidate.
`promise_accounting_evidence_v1` readiness requires three complete resource observations,
matching mapped/source counts, an authoritative succeeded generation, and normalized
organisation timezone. Each resource records collection start and successful completion;
promotion time is not evidence of a post-deadline fetch. Xero timezone enums use pinned
Unicode CLDR Windows/territory data to produce validated IANA zones, with no fallback
for unknown context. Missing foreign cash FX remains explicit unavailable valuation.
Promise creation baselines and automatic lifecycle reconciliation consume this
evidence; unapplied cash remains outcome-only, with no allocation or cash UI. See `docs/canonical-accounting-evidence.md` for the contract and
local disposable database tests. Phase 3B hosted Test certification is complete.

### Customer-credit evidence, certification and summary contract (Phases 1–5)

The generation importer also fetches AR credit notes without a status filter and
persists their exact `RemainingCredit`, lifecycle, customer and currency context in
`canonical_credit_note_evidence`. `canonical_customer_credit_evidence_exact` combines
that source with existing receive overpayment and prepayment residuals for the
customer-summary calculation. It is not read by Promise reconciliation. A separate
`xero_customer_credit_validations` records credit-note traversal and the fresh invoice
exact-money contract. After all initial invoice and credit observations complete, one
bounded verification sweep fully traverses authorised AR invoices, then all three
credit resources. Normalised identity, status, currency, due-date, exact residual and
provider-version signatures must match the initial evidence. Certification checks original
provider rate tokens before shared mapping can normalize an invalid rate to null;
explicit invalid rates or non-unit base-currency rates withhold credit certification
without changing Promise evidence or ordinary sync. A fenced, generation-scoped
certificate records ready or a bounded unavailable reason; later accounting evidence
writes invalidate ready certification. This is observational stability, not a
transactional Xero snapshot. The held-generation customer-summary loader reads the
certificate once and exact combined credit evidence in bounded pages, then calls the
pure calculation per customer after invoice To chase and ageing have been derived.
`invoice_to_chase_overdue_base_decimal` keeps pre-credit invoice actionability distinct
from `customer_to_chase_overdue_base_decimal`; ready zero, unavailable and unsupported
currency remain separate states. Existing `to_chase_*` and `collectible_*` fields retain
their pre-credit meaning. Total/future invoice actionability and weighted lateness are
unchanged. Phase 4 passes customer net overdue to Exposure, its portfolio monetary
benchmarks, queue monetary eligibility and first-value selection. The portfolio age
and relative-deterioration reference populations retain invoice-derived overdue
actionability, even when credit removes a customer from the operational queue.
The browser's overdue-only filter consumes the server's customer net amount. Customer
summary, actions and first-value displays use that same amount without browser credit
arithmetic. A positive applied deduction may show one compact “Xero credit deducted”
line; invoice amounts remain unchanged and no invoice-level To chase is displayed.

## Resend

The contact route always attempts to persist a support ticket first, then sends a notification through Resend when the inbox and API key are configured. Email failure does not discard the ticket.

Preview and Production may intentionally share a Resend account and verified sending domain. The sender in `SUPPORT_FROM_EMAIL` must be permitted by that account. No database email-delivery metadata is maintained.

## Vercel

Vercel provides Preview and Production deployment scoping and supplies `VERCEL_ENV`, `VERCEL_URL`, and `VERCEL_GIT_COMMIT_SHA`. The application uses `VERCEL_URL` as a fallback origin and `VERCEL_ENV` for environment-sensitive behavior.

Environment values—not variable names—must differ where required. In particular, Production must use the Production Supabase project and Stripe live configuration, while Preview uses Test Supabase and Stripe test configuration.

## Environment variables

`.env.example` is the complete variable-name inventory. It contains no values. Broad groups are:

- Application URL and Vercel-provided runtime metadata
- Supabase public/session and server-only service credentials
- Cloudflare Turnstile public site key (the secret is held by Supabase Auth)
- Stripe keys, Price IDs, and webhook secret
- Resend/support sender and inbox
- Xero OAuth, token encryption, internal access, and sync tuning
- Retention/scheduling secrets
- Privacy administration, export signing, and policy metadata

Google OAuth has no direct Google secret in application code; provider credentials live in Supabase and Google Cloud dashboards.

## Important failure modes

- A missing or stale database schema must fail validation rather than be hidden by legacy-table fallbacks.
- Unpaid billing usage writes/counts fail closed so a database error cannot silently grant unlimited free access. A valid cached paid-through entitlement does not depend on reading the free-usage ledger, avoiding an unnecessary paying-user lockout during a partial ledger failure.
- Protected collection and Xero data is not directly readable or writable by browser Data API roles; otherwise a valid session token could bypass Next.js route enforcement.
- Stripe events are unordered and duplicated; webhook handlers must remain idempotent.
- Xero refresh and sync operations are concurrent; grant, tenant, and scheduler locks must remain service-only.
- Dynamic Preview URLs require explicit OAuth/dashboard planning.
- `supabase/.temp/` is local generated metadata and must never be committed because it can silently restore a hosted project link.

### Authenticated Promise server operations (Phase 6)

`/api/collections/invoice-promises` provides scoped create/edit/cancel and bounded
invoice/history reads, used by the customer invoice UI and structured actionability. Creation validates
one held evidence-ready authoritative generation and snapshots only the invoice's
known payment IDs; fixed amount and organisation-local date are server validated.
Financial edits use the existing pure qualifier/resolver; an immediately Kept edit
commits its terms and ordered lifecycle events together. Note-only/cancellation
avoid evidence-array reloads. A new forward migration adds service-only snapshot
preparation and atomic multi-event request commands, using the existing promotion
state-row/Promise-tenant locking and event-backed idempotency. No browser grants,
API status setter, Reactivate, scoring or legacy cutover are added. Automatic
promotion reconciliation remains operational; structured Promises feed canonical queue actionability and the invoice UI. See `docs/invoice-promises-server.md` for the API and retry
contract. Promise privacy export is included before user-facing rollout.


### Invoice Promise presentation (Phase 8)

Customer invoices expose compact fixed-commitment controls and bounded lifecycle
history. Monetary rows display server-derived Outstanding / Disputed / Promised,
with zero adjustments hidden. To chase is shown at customer level. Edits use current revisions; blank/zero
amount means cancellation. Terminal outcomes are read-only and Unclear is passive.
Financial saves refresh one invoice and one scoped customer summary, then invalidate
an open queue for one complete ranking fetch; notes do neither. Creation snapshots,
resolver/reconciliation decisions and scoring weights remain server/domain owned.
Privacy export now includes owned Promise terms/notes/status/timestamps and meaningful
immutable events, paginated without command/baseline/resolver internals. No Promise
worklist or unified timeline is added. See `docs/promise-customer-experience.md`.

### Collection dependency metadata (Phase 3.2)

The additive Phase 3.2 migration defines `collection_dependency_heads` for tenant financial epoch F and projection
revision P, scoped by owner, provider tenant and source.
`collection_customer_financial_revisions` stores rCustomer under the same scope
plus customer source ID. These are disposable-calculation invalidation metadata,
not accounting or scored state. G remains the existing authoritative active
accounting generation pointer. Sparse rows read as zero; legacy/null-G accounting
must not be reused as an immutable generation.

Private database triggers advance versions in the existing domain mutation and
accounting-publication transactions. Effective financial changes advance rCustomer,
F and P; priority/Action History and displayed note/review changes advance P only.
Generation publication advances F/P without mass customer revision changes.
No current read route calls the new internal dependency reader. No materialization,
cache, worker, refresh redesign or API/UI change is enabled. See
[the dependency foundation contract](docs/collection-dependency-foundation.md)
for classifications, locking, security, date validity and local validation.
This phase validates the migration locally; it does not imply a hosted rollout.

### Dashboard compact bootstrap (Performance Phase 3.8)

The Dashboard reads one authenticated bootstrap instead of a status-gated rich
queue GET. With the programme schema installed, it combines scoped access and
connection/generation context, the existing free-use claim, the Phase 3.5 queue
projection, and a final G/F/P/access fence. Only interactive Dashboard card fields
are returned; the Priorities table explanations are omitted. The existing guarded
entry auto-sync runs independently after useful bootstrap data. A bounded metadata
observer can detect an in-flight attempt's completion without polling Xero.
Explicit unmigrated/legacy compatibility preserves current authoritative reads;
it is not the certified fast path. See `docs/performance/dashboard-bootstrap.md`
for contracts, security, request counts, testing and measurement limits. No hosted
programme migration or refresh-policy rollout is implied by this change.
