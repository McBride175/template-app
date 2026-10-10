# Phase 5D — Priority Invoice Intelligence

Implemented on `develop` from `f97fb74`. See [the official programme sequence](ui-programme.md).
This is the compact Priorities invoice context previously proposed as Phase 5B.2.
The former Phase 5D disputes redesign is now Phase 5F. No later phase is implemented.

## Collection workflow

Priorities remains the working environment. Customer identity and authoritative
customer **To chase** still lead; the same four outcomes, follow-up controls,
notes, Undo, retry, Previous/Next and Back to #1 remain available here.

**Invoices requiring attention** shows at most three open accounting receivables
with a known positive native outstanding amount and a valid due date strictly
before the queue's server-supplied evaluation date. Sorting is due date ascending,
then invoice source ID for ties. This is conversation context, not a second
priority score or a new definition of eligibility. Neither server order nor the
input invoice batch is modified. Invoices due today/future and retained settled
records are not mixed into the normal overdue list. Missing evaluation date
produces a truthful unavailable explanation rather than a browser-clock guess.

Rows show reference, due date, labelled Outstanding and concise active dispute
and Promise coverage. Partially covered balances are never described as wholly
covered; full coverage does not mean paid. No amounts are summed, no invoice net
To chase is invented and customer credit is never allocated across invoices.
Unknown accounting/date/currency records and dispute balance-review warnings
remain visible outside the disclosure. Zero displayed overdue records explicitly
allows other debt or commitments. Terminal promises remain in Customers.

Desktop/tablet use two columns within the focused customer: invoices beside the
existing action panel. Phones start folded, with an accessible **Invoices**
control and visible **View all invoices** link. Expanding reveals the same small
list. All controls remain in normal document flow; no fixed overlay or nested
scrolling is introduced. The scoped action spacing is compact on phones; outcome
semantics, ordering and minimum touch targets are unchanged.

Matched synthetic fixtures measured first-action top before/after:

| Width | Before | After | Change |
| --- | --- | --- | --- |
| 320px | 629.75px | 675.75px | +46px |
| 390px | 597.75px | 643.75px | +46px |
| 768px | 732.75px | 732.75px | None |
| 1440px | 658px | 658px | None |

Phone expansion and genuine warnings naturally add height. Loading leaves the
queue/actions interactive; desktop placeholder rows limit movement as supporting
context arrives. No blank portfolio or blocked action workflow waits on invoices.

## Data and component boundaries

- `QueueInvoices` is a read-only compact view. It reuses exact `promiseMoney`,
  UTC `promiseDate`, existing InvoiceDisputeView and semantic feedback/primitives.
  It does not import InvoicePromise, invoice editors or mutation handlers.
- `priority-invoices` performs explicit display filtering/ordering only, using
  existing decimal comparison and supplied accounting classification. The result
  is memoised per invoice batch/date; action-note keystrokes do not sort it again.
- `usePriorityInvoices` reads the existing authenticated endpoint:
  `GET /api/collections/invoice-disputes?tenantId=…&customerSourceId=…`.
  One batch is requested only for the selected customer; there is no per-invoice
  read, portfolio prefetch, accounting-refresh intent or new API contract.
- `CollectionActionsClient` retains queue/mutation ownership. Accepted queue
  metadata supplies G/F/evaluation date for invoice cache identity. Projection P
  alone does not invalidate invoices on a priority or action-only change.
- `queue-navigation-context` constructs internal links and validates opaque source
  IDs (nonempty, trimmed, at most 200 characters, no control characters).

The mounted queue has a four-customer-batch, 60-second maximum reuse cache. Keys
include tenant, source ID, financial generation/epoch/evaluation date and local
invalidation revision. It is neither global nor persisted. Selection/financial
changes abort in-flight reads; a monotonic request guard and visible-result key
also reject late responses even if transport ignores cancellation. Cache reuse
avoids another read when returning to a recently viewed customer. Unmount discards
it. Accounting-completion and existing scoped Promise/dispute actionability
signals invalidate batches; other-tenant financial signals do not. Retry reloads
invoice context independently. Existing queue refresh/reconciliation still runs
through its original owners; the invoice loader never invokes it.

This existing endpoint supplies no response version. The presentation therefore
uses established G/F/date invalidation signals, not a claim of atomic equality
between independently fetched queue and invoice snapshots. Customer To chase
remains the queue's authoritative amount throughout.

## Deep dive and return

View all invoices opens:

`/customers?tenantId=…&customerSourceId=…&queueCustomerSourceId=…#customer-invoices`

The established customer/tenant/fragment mechanism still focuses the selected
invoice section after loading. The new optional parameter contains only the
originating durable customer ID. Customer selection and history links preserve
that origin even when another account is investigated. Back to Priorities returns
to `/dashboard?tenantId=…&queueCustomerSourceId=…#collection-actions`.
Direct queue-history links also carry origin context.

On queue mount or browser history navigation, selection is matched to the latest
eligible server-supplied rows under the same tenant. Changed rank is respected.
Missing/deferred/removed customers fall back to the current eligible head, with
an explanatory message (or the truthful empty state). There is no stale-index
restoration, score persistence, queue snapshot or change to eligibility.
Ordinary queue steps replace the URL's selected ID rather than adding browser
history entries. Existing Back to #1 remains the same selection mechanism.
There is no promise to preserve unsaved action notes across a full navigation.

## Local certification

- **277 focused component/financial regression checks passed**, zero failures or
  skips: exact amounts, credit boundaries, disputes, Promise lifecycle and
  reconciliation, eligibility, queue response ordering, initial bootstrap,
  selected-customer transport, cache expiry/eviction/invalidation, late-response
  cancellation, retry, identity restoration/fallback and existing action workflows.
- Additional legacy source-contract group: **67 passed, 2 failed**, no skips.
  Both failures are proven present at the approved `f97fb74` baseline: the founder
  context check expects “Find a customer” inside the pre-extraction client rather
  than CustomerBrowser; the historical Phase 7.5 test freezes customer invoice UI
  against `23d0037`, before the approved Phase 5C presentation migration. Neither
  represents a Phase 5D financial regression. Historical tests were not weakened;
  reconcile these obsolete UI-source assumptions in Phase 5J.
- A final focused UI run passed **39 checks**, zero failures/skips; it overlaps the
  regression set and is not additive.
- **53 isolated Chromium layout checks passed**, no retries/skips, covering the
  existing shell/queue/mobile/customer layouts and six new invoice checks at
  320/390/768/1440px. Final invoice checks were rerun after the chevron refinement.
- Compiled local Test application smoke: **8 passed, 5 skipped**, no retries.
  Two authenticated reads lack a designated safe Test session; three financial
  mutation journeys lack failure-safe fixtures. All remain intentionally disabled.
- Targeted agent-browser/axe priority-region audits: **zero violations and zero
  incomplete checks**, desktop and expanded phone. Keyboard disclosure, 44px
  actions, warning visibility and no horizontal overflow are covered by Playwright.
- ESLint, application and Storybook TypeScript, production application build,
  static Storybook build (**78 stories**) and SQL safety passed. Eight new pure
  stories cover normal/many/loading/error/no overdue/coverage/unavailable/long
  multicurrency invoice states. No service client or credentials enter Storybook.

Tests use fictional fixtures and mocked transport only; no personal session or live
accounting data is used. Initial checks caught excessive 320px disclosure height
and the need to isolate the secondary invoice read in old bootstrap-only fixtures;
both were corrected without changing API/state contracts or increasing waits.
One application typecheck raced Next's regeneration of ignored `.next/types`; it
passed when rerun after the build. The final build includes application type validation.

## Performance and hosted limitations

Local synthetic DTO parse/filter/sort measurements (20 measured iterations,
95th percentile; uncompressed JSON) were:

| Records | Payload | Parse | Select/order |
| --- | --- | --- | --- |
| 10 | 8.6KB | 0.03ms | 0.06ms |
| 100 | 85.9KB | 0.33ms | 0.53ms |
| 1,000 | 859.9KB | 1.53ms | 3.45ms |
| 5,000 | 4.30MB | 7.83ms | 17.44ms |

These measure browser-side work with representative synthetic fields, **not**
Supabase/Vercel latency, actual transfer compression or a real customer's payload.
The endpoint internally pages at 1,000 records and can return a large batch.
Selection-only fetching, four-entry cache and cancellation constrain unnecessary
work but do not bound the server response. A safe authenticated Preview read of
a representative large customer remains necessary before hosted performance
certification. If its measured cost is unacceptable, request approval for a bounded
read-only projection; no speculative backend extension is part of this phase.

Host review must also verify selected-customer loading, actual accounting/financial
invalidation, rapid selection, deep dive/Back/Forward, deferred-customer fallback,
mobile disclosure and four outcomes. WebKit/native Safari and live authenticated
mutation flows remain unverified. No push/deployment is included in this checkpoint.

## Evidence

Synthetic desktop, 320/390px phone and tablet screenshots, folded/expanded context,
large/multicurrency balances, full/partial coverage, loading/empty/error/unavailable,
action callback and queue selection/return evidence are outside Git at:

`/Users/admin/.codex/visualizations/2026/10/09/01a1226e-541c-7c20-a789-88721f8de175/yuohme-5d-qa/`

Transport and durable-ID restoration are certified through real-client mock tests;
Storybook's selected-index screenshots are presentation evidence, not hosted
cross-route or authenticated mutation certification.

## Official Phase 5E handoff — Global Promises Workspace

Reuse `PromiseCommitment`, `promiseMoney`/`promiseDate`/`promiseOutcome`, the
customer Promise section, fixed-term summaries and existing editor/history
presentation. `customer-detail` and selected-customer `invoice-disputes` expose
current/latest commitments; existing `invoice-promises` reads and customer unified
history expose invoice-scoped lifecycle detail. None is a portfolio-wide Promise
worklist projection. Do not repeatedly fetch every customer to manufacture one.

A global Promises workspace needs a separately reviewed aggregation/read contract,
including active/terminal scope, tenant/entitlement/currency authority, deterministic
ordering/pagination, unavailable evidence, and bounded payloads. Any API or global
navigation addition belongs to that approved phase. Preserve existing commands,
fixed original terms, terminal restrictions, idempotency, reconciliation and scoped
refresh signalling. Reuse durable customer/tenant invoice deep links and lightweight
return context; do not persist financial state or change the collection ranking.

Phase 5F owns full dispute worklist organisation and actions. Shared Promise/dispute
summaries here do not begin that redesign. Scoring, accounting, credits, Promise and
dispute rules, action behaviour, Xero, auth/billing, schema, shell, theme and approved
brand files are unchanged; no dependency or environment-variable configuration is added.
