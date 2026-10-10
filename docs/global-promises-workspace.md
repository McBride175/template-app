# Phase 5E — Global Promises Workspace

Phase 5E adds `/promises` as an authenticated operational worklist. Priorities
remains the primary collections environment; Customers remains the invoice and
detailed Promise investigation environment. Routine Promise management is now
available in place on Promises, as recorded in the Phase 5E correction below.
No later programme phase is implemented here.

## Product contract

Active is the default. Commitments sort by promised date ascending, then durable
Promise ID: elapsed dates precede today and upcoming commitments. History contains
Kept, Missed, Unclear and Cancelled; specific outcome filters are available.
History sorts by promised date descending, then ID. These are display orders,
not new collection rankings or lifecycle decisions.

An elapsed Active promise is **Date passed · Still active**, never automatically
Missed. Today and upcoming labels use the held organisation's stored IANA timezone
(or the existing pinned Xero/CLDR normalizer), with the server's current instant.
There is no browser-timezone or UTC fallback. Missing/invalid timezone produces
an explicit unavailable date context; date filtering then requires All dates.
Opening or refreshing the list never reconciles a Promise or starts accounting
refresh/scoring.

Each row shows customer, invoice reference, native promised amount/currency,
promised date and actual lifecycle/date label. Payment progress, current invoice
context, notes and recorded resolution date are available by disclosure. Qualifying
payment is the stored exact amount; missing evidence stays Unavailable, never zero.
No currency totals, FX conversion, inferred outstanding commitment, credit
allocation or new financial calculation is introduced.

Desktop uses a restrained divided list with aligned columns. Mobile keeps search
and Apply available and places commitment/date controls behind Filters. Selected
values survive closing the disclosure. All actions and disclosures retain 44px
minimum targets; long identities and exact amounts wrap. Material unavailable
warnings remain visible outside disclosure. Active/history choice is labelled in
the collapsed filter control. Search submits explicitly rather than on keystrokes.

## Read architecture and security

`GET /api/collections/promises` accepts tenantId, status, date, q, page and pageSize.
`lib/collections/promise-worklist.ts` validates/normalizes URL state and provides
public DTO/navigation helpers. The server-only projection is in
`lib/collections/promise-worklist-server.ts`.

Access reuses `authenticateDisputeTenant`: verified server `getUser`, the existing
owned collection access/free-use claim, exact requested tenant check, subscription
and currency entitlement, and one authoritative Xero snapshot. The Promise read
model itself has no writes; the established free-use access claim still applies.
A missing tenant resolves the existing owned default; invalid/blank or foreign
tenants fail. There are no new credentials, environment variables, browser grants,
privileged SQL functions or migrations.

The normal read consists of one bounded organisation lookup, one Promise page
with exact count, and two batched current-snapshot identity lookups. Operational
rows are explicitly owner/tenant/Xero scoped. Only the current page's customer and
invoice IDs are hydrated, with customer/invoice ownership checked. Names/references
absent or ambiguous in the held snapshot remain unavailable (durable invoice IDs
provide fallback labels); retained accounting generations are not used as current
balance evidence. A final authoritative snapshot check rejects concurrent promotion.
There are no per-row API/database requests, portfolio loads or queue payload changes.

Pagination defaults to 25, maximum 50, with deterministic date/ID ordering.
SQL applies status/date/search filters and the page range. Offset pagination
represents the current live worklist; changes between pages can naturally move
rows, and Refresh list/First page recover a changed page. It does not freeze or
persist financial state.

Search uses two current-snapshot, owner/tenant/provider-scoped literal substring
lookups for customer names and invoice references (201-row detection bound), then
one filtered Promise query. Exact durable customer/invoice IDs also match.
Each identity lookup supports up to 200 matches: broader queries explicitly ask
for a narrower search rather than silently truncate. Historical entries without
current identity labels can be found by their durable IDs. This limitation avoids
loading retained accounting portfolios or adding a new search projection in V1.
Search patterns and opaque IDs are escaped independently for their query contexts.

Numeric SELECT casts return decimal strings. Public projection whitelists business
fields; it excludes owners, baselines, evidence arrays, internal generations,
command fingerprints and resolver metadata. Invalid/missing finance is explicit.
Responses are private/no-store. Errors contain no internal/customer evidence.

## Client and navigation

`PromisesClient` performs one worklist GET on mount or applied URL change, with an
AbortController and sequence/URL guards. Old-tenant/filter results cannot display.
Accounting updates and existing tenant-scoped Promise financial signals reload
only this worklist. The new Promises navigation link explicitly disables route prefetch; no Promise
data is prefetched by ProductShell or Priorities. Notes-only
changes are visible on normal return/reload; no new cross-window notification layer
has been added.

The initial Phase 5E implementation used Manage promise/View promise links carrying tenant, durable customer/invoice IDs and a
validated `/promises` return URL to the existing `/customers?...#invoice-ID` focus
convention. InvoiceFrame reveals the invoice; the existing Promise editor retains
all permissions, revision/idempotency, retry and lifecycle control. Terminal records
remain read-only through that editor. Multiple historic commitments on one invoice
are investigated through its existing bounded Promise history, rather than a new
independent historical editor.

Back to Promises preserves applied filters and page. That context survives customer
history and Back to Customers; it permits only a normalized same-tenant Promises
URL, never an arbitrary redirect. Browser Back/Forward uses normal App Router/URL
state. Existing queue origin/Back to Priorities context remains separate and unchanged.

## Local certification

Certification completed locally on 10 October 2026. Fixtures are fictional and
deterministic; local simulation is not authenticated hosted certification.

- 498 focused unit/integration/security regressions passed, zero failures/skips:
  Promise lifecycle, qualification/reconciliation, exact actionability/customer
  credit, invoice management, scoped financial refresh, queue eligibility/response
  ordering, access/tenant/auth and customer/shell navigation.
- Final focused worklist/customer check: 32 passed; final navigation/controller
  check: 17 passed. No unfinished financial fixtures enabled.
- Six final Promises Playwright specs passed, zero retries/failures/skips. These
  cover 320/390/768/1440px, date/status distinctions, mixed currencies, long values,
  44px controls, compact first-entry positioning, keyboard disclosure, mobile
  menu/navigation, filters retaining values, pagination and deep links.
- Existing shell/customer/priority-invoice layouts: the initial 43-spec run had
  42 passes and one customer-test failure because the new primary Promises link
  made an unscoped selector ambiguous. Scoping it to Customer views resolved it.
  The final targeted seven-spec run passed without retries; the 36 unaffected
  specs passed in the original run. One earlier filter attempt was interrupted
  by a Storybook page reload during concurrent builds and passed on retry; the
  final isolated run passed without retry. This is recorded separately from app
  defects; waits/retries were not increased.
- Guarded local production smoke: 8 passed, 5 skipped, zero failures/retries,
  including Promises destination-preserving sign-in and signed-out API rejection.
  Two skips need a designated Test session; three need safe action/dispute/Promise
  mutation fixtures. These are the same five disabled journeys, not passed tests.
- agent-browser compact inspection plus axe-core 4.12.1 WCAG A/AA audits:
  desktop and final mobile worklist each had zero violations/incomplete checks.
  A whole-shell audit had zero violations and one incomplete closed-dialog
  aria-controls check; the existing dialog relationship/focus is verified by
  shell tests. This is not a full assistive-technology audit.
- Lint has zero warnings/errors; application and Storybook TypeScript, production
  build, Storybook build (88 stories, eight new Promises stories), SQL safety and
  diff-whitespace checks pass. Existing Vite build diagnostics are not
  application build failures.

Visual evidence is saved outside Git in the local `promises-workspace` review
folder: desktop, 320/390/768px layouts, mobile, history, long values, loading,
empty, error and unavailable states plus scoped accessibility JSON. The first
ordinary mobile entry starts within 440px; exceptional warnings deliberately
remain ahead of the list. Screenshots contain only fictional fixtures.

Synthetic retrieval measurements at 20 and 5,000 stored commitments used four
bounded table reads in both cases (organisation, Promise page, customer batch,
invoice batch), plus the existing access/snapshot fences. Approximate fake-query
and projection time was 1ms and 4–8ms under concurrent local test load; JSON was
10,013 and 12,486 bytes. Search adds two bounded identity lookups, not a per-row
waterfall. These measure request count/payload and local projection only, not
Supabase query plans, network latency or hosted performance.

Remaining certification: real authenticated hosted reads/management/return flow,
representative tenant query latency and search plans, WebKit/native Safari and
mobile Safari. Playwright Chromium is installed; WebKit is not installed and no
new dependency/browser was installed. No hosted test session was invented.
Production, environment settings, Promise engine, accounting/scoring, queue
bootstrap/actions and approved branding were not changed.

## Official Phase 5F handoff — Disputes Workspace Redesign

Reuse the compact search/secondary-filter disclosure, divided responsive worklist,
explicit unavailable-state presentation, URL filtering/pagination and validated
customer/invoice return-link pattern. Promise presentation uses existing
`promiseMoney`, `promiseDate` and `promiseOutcome`; lifecycle/status/date context
remain distinct.

The Disputes read/editor contracts and accounting-versus-operational state remain
separate from this worklist. No bulk dispute/action redesign is included. Keep
current scoped financial invalidation, mutation controllers and ownership fences;
do not infer settlement or Promise outcomes from missing accounting context.

Before hosted certification, push only with approval, verify the exact develop
Preview SHA/unique URL, and use designated safe Test sessions. Verify same-tenant
management/return links and native/mixed currencies with real Test fixtures,
measure query latency/search plans and pagination under representative tenant
sizes, and inspect Safari/mobile Safari. No hosted latency or Safari certification
is claimed from the local synthetic timings or Chromium checks.

## Phase 5E correction — Manage Promises in place

This correction keeps the official programme numbering unchanged. Phase 5F remains
Disputes Workspace Redesign and has not begun.

Manage promise now opens one native modal dialog on Promises. The compact list
keeps a separate View invoice link beside Payment progress; the dialog also offers
View invoice in Customers with the existing validated tenant/customer/invoice and
return URL. Active commitments offer Edit promise, Cancel promise and Promise
history. Cancellation opens the existing blank-amount cancellation form for explicit
submission. Historical commitments show their own authoritative recorded terms,
notes and history, without edit/create/cancel controls, even when another commitment
on the same invoice is currently Active. An elapsed Active commitment remains Active.

`PromiseManagement` loads the existing selected-invoice GET only on demand:
`/api/collections/invoice-disputes?tenantId=…&customerSourceId=…&invoiceSourceId=…`.
It matches the durable invoice and Promise identity. Older historical commitments
use the existing bounded invoice Promise history GET when the selected record is
not current/latest. No incomplete worklist DTO is converted into an invoice DTO.
Unavailable accounting/currency values remain explicit. A four-entry, 60-second,
page-local cache includes tenant/customer/invoice/Promise identity and a terms
signature. Accounting/financial signals and committed changes invalidate it.
Abort/sequence/mount guards reject stale reads and old-tenant results. No requests
are added to initial loading, ProductShell or Priorities, and no per-row waterfall,
new API, migration or accounting refresh is introduced.

The existing `InvoicePromise` controller and `InvoicePromisePanel` own every
mutation, revision, amount/date/note validation, command ID, conflict, history and
retry. Optional host callbacks report draft/save/uncertainty and committed results;
Customer Workspace retains its existing defaults. The new host prevents closing,
Escape, changing retry terms or following the invoice link while saving or uncertain.
A definite unsaved edit requires discard confirmation when closing the dialog or
leaving for Customers. Native dialog containment, 44px controls, scroll locking and
restoration, focus restoration to the originating row (or heading after removal),
and a browser unload warning protect the editing surface. There is no custom motion
or separate mobile editor.

Financial saves retain existing tenant-scoped invalidation and refresh one selected
invoice followed by one current filtered worklist. Own financial signals do not
start a duplicate worklist fetch during mutation. Note-only saves refresh just the
worklist; they do not reload accounting, invoices or a portfolio. Background list
refresh leaves the mounted editor and draft intact. Filters, page and search URL
state remain unchanged; the list stays visible during reload. Cancellation can
remove an Active row without unmounting the manager. A committed response stays
saved if either read refresh fails, with a distinct refresh warning and read retry;
uncertain saves retain their original command identity and draft for retry.

### Correction certification

Local synthetic verification on 10 October 2026:

- 62 final controller/worklist tests passed, zero failed/skipped. This includes real
  existing controllers with mocked requests: edit amount/date/note, cancellation,
  note-only request counts, conflict, uncertain retry identity, saved-but-refresh-failed,
  disappearing row, historical target, context retry, cache reuse, tenant cancellation,
  background draft preservation and current Customer Workspace behaviour.
- Broader Promise/domain/accounting/queue/access regression: 554 passed, two existing
  failures, zero skips (556 tests). Both failures in `collections-queue-status.test.mjs`
  rely on pre-extraction queue presentation: a fake hook-slot/tree assertion expects
  inline amounts and another regex expects an old inline complete-today expression.
  They reproduce independently; their test and `CollectionActionsClient` are unchanged.
  No queue/scoring or unrelated test rewrite is included in this correction.
- 35 Customer Workspace/Promises responsive Chromium checks passed with no retries,
  including 320/390/768/1440px, editing/history/cancellation, removal fallback focus,
  filter retention, navigation and existing invoice density/draft behaviour. An initial
  new test incorrectly followed position #1 after a date edit reordered the worklist;
  its locator was corrected to durable invoice identity. No waits/retries were raised.
- Guarded local production smoke: 8 passed, 5 skipped, no failures/retries. The same two
  designated-session and three unsafe financial-mutation journeys remain disabled.
- agent-browser targeted desktop/mobile editor inspection and scoped axe-core 4.12.1
  WCAG A/AA audits: zero violations or incomplete checks in both visible editors.
- Lint, application/Storybook TypeScript, production/Storybook builds, SQL safety and
  diff whitespace checks pass. No dependencies or environment variables changed.

Screenshots live outside Git in the local `promises-management` review folder:
desktop/mobile editor, responsive editing and cancellation, worklist/history/loading/
empty/error and existing Customer Workspace regression evidence. Storybook exercises
the real controlled panel/dialog with fictional callbacks; controller transport and
financial behaviours are separately mocked integration tests, not hosted mutations.

Measured request contracts: one initial worklist GET; one targeted invoice GET on
ordinary Manage (zero on unchanged cached reopen); one additional bounded history GET
for an older commitment; note save = one existing POST plus one worklist GET; financial
save = one existing POST, one targeted invoice GET and one worklist GET. No global
refresh or reconciliation is started by opening Manage. These are verified request
counts, not hosted latency claims.

Hosted authenticated edit/cancel/history, real Test permissions/accounting refresh,
native Safari/mobile Safari and WebKit remain to certify after an approved push.
Chromium/local synthetic certification does not certify those environments. No
Promise engine, financial calculation, lifecycle, API contract, branding, navigation,
Production configuration or later phase changed. Phase 5F can reuse the modal host
pattern while retaining the distinct existing dispute controller and semantics.
