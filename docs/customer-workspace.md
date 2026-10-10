# Phase 5C — Customer workspace

Locally complete on develop, 10 October 2026. Baseline: `76ab215`.
Customers is the detailed investigation and management environment. Priorities
remains the primary collection environment; compact invoice context there is
reserved for Phase 5B.2. No dashboard, queue, global navigation or later phase
is implemented by this checkpoint.

## Workspace and navigation

A contextual 320px customer browser and dominant selected-account area share
ProductShell's existing desktop width. They scroll with the document. On phones
and tablets the browser becomes an accessible Change customer disclosure above
the overview, so switching does not require reaching the bottom of the invoices.
Search remains local; the eight existing gross-balance/age/name sort options,
overdue filter, 200-row server window and tenant/customer URL semantics remain.
There was no customer pagination control to migrate; the existing limit remains.

The overview leads with identity and server-supplied customer To chase, then
paired gross outstanding/overdue and payment-behaviour signals. Zero To chase
explicitly allows remaining outstanding debt. Native currency amounts, invoice
counts, ageing, historical sample and disputed amounts remain in financial
details. The existing priority adjustment is available through a disclosure.
Customer credit is shown only as the supplied **Xero credit deducted** amount;
this DTO does not expose an available-credit balance or aggregate Promise total.
Neither is invented or calculated in the browser.

Invoices, Promises and View history provide local/customer navigation. The
Promises section reuses current/latest commitments from the already loaded
invoice batch, with fixed terms, received amounts and current coverage. Earlier
commitments remain in each invoice's existing bounded Promise history. Management
links return to the associated invoice editor; no global Promises worklist exists.

Invoices use structured rows with reference, issued/due dates, separate accounting
and dispute status, and canonical Outstanding/Disputed/Promised coverage. Details,
notes and dispute controls expand within each invoice; material balance-review
warnings remain outside the disclosure. Bulk disputes are disclosed only in the
customer workspace. Existing full/partial/resolve/reactivate/confirm/note operations
and eligibility are retained. Promise entry/edit/cancel/retry/history controls
remain available with 44px targets and invoice-specific accessible landmarks.
Customer credit is not apportioned to invoices, so invoice rows do not present
an invented net To chase figure.

History retains its original route, server ordering, cursor pagination, deletion
permissions, legacy read-only events and UTC timestamps. Invoice links carry
customer/tenant context and a fragment; selected-detail loading focuses that
invoice, or the selected customer otherwise, with reduced-motion support.
Back to Priorities carries the tenant and existing collection-actions fragment.
It does **not** guarantee restoration of the originating queue selection.

Customers outside the current bounded list can still be investigated through
a deep link. Their priority setting is shown read-only until the current list
contains that account, avoiding an inaccurate editable value after a list refresh.
Existing context confirmation and save handlers are unchanged.

## Component boundaries

| Component | Responsibility |
| --- | --- |
| CustomerBrowser / CustomerSelectionPanel | Controlled discovery; mobile disclosure |
| CustomerOverview | Financial identity, behaviour, customer links and context slot |
| InvoiceFrame / InvoiceAmounts / InvoiceDetails | Reusable invoice metadata/coverage and detail disclosure |
| PromiseCommitment / InvoicePromisePanel | Shared commitment summary and controlled editor/history presentation |
| CustomerPromises | Current/latest customer commitments from the existing invoice batch |
| CustomerTimeline / CustomerHistoryView | Ordered event presentation, scoped links and history layout |
| customer-format / customer-workspace-types | Existing display helpers and unchanged row/sort types |

CustomerCollectionsClient retains data/state ownership, request cancellation,
response ordering, list patches and scoped financial reconciliation.
InvoicePromise retains command IDs, validation, lifecycle/conflict/retry state
and refresh decisions. CustomerInvoiceDisputes retains revision-safe mutations
and bulk eligibility. CustomerHistoryClient retains reads, cursors and deletion.
Pure stories import presentation components only, not these live feature clients.

## Certification and evidence

- Financial/domain regression run: **548 passed**, zero failures/skips. Frozen
  calculation parity, credits, multi-currency, Promise lifecycle, disputes,
  reconciliation and Action History were included.
- Final focused UI/render run: **80 passed**, zero failures/skips. This overlaps
  the regression set; totals are not additive. Real clients with safe mocked
  transport verify two independent initial list/detail reads, zero reads for
  search or close, one scoped detail read for selection, original sort/filter
  parameters, context save/revert and invoice/section-fragment focus.
- Isolated Chromium responsive suite: **47 passed** with no retries/skips.
  After the final accessibility/history extraction, all **20 customer checks**
  passed again with no retries/skips. Widths: 320, 390, 768 and 1440px.
- Guarded compiled-application smoke: **8 passed, 5 skipped**, no retries.
  Two authenticated read journeys lack a designated safe Test session; three
  financial mutation journeys still lack failure-safe fixtures. None was enabled.
- ESLint, application and Storybook TypeScript, production build, static
  Storybook build and SQL safety check passed. The catalogue contains **70 stories**,
  including 14 customer states. Source audit confirms unchanged API/domain,
  theme, brand, shell and queue files and unchanged mutation/fetch handlers.
- Targeted agent-browser axe checks of customer and history main content found
  **zero violations and zero incomplete checks**. A repeated Promise landmark
  name found during review was corrected with invoice-specific naming.

Initial browser checks exposed an ambiguous repeated-amount selector and an
oversized multi-story check that timed out while expensive regressions ran.
Selectors were scoped and rendering checks split into focused groups; waits and
retries were not increased. Final application typing also caught a missing
history type import after extraction; it was restored before the final build.

Screenshots, test logs, source hashes and audit results are outside Git at:

`/Users/admin/.codex/visualizations/2026/10/09/01a1226e-541c-7c20-a789-88721f8de175/yuohme-5c-qa/`

Evidence includes all four workspace widths, mobile discovery, invoices, Promise
editing/terminal states, history, loading, empty and unavailable states. These are
fictional component views and mocked client verification. Live authenticated
hosted data, hosted mutation latency, WebKit and native Safari remain uncertified.
No live customer data, credentials or personal browser profiles were used.

The implementation adds no API requests, portfolio refreshes or new loading
waterfall for presentation. Opening invoice Promise history retains its existing
on-demand reads. No hosted latency improvement is claimed. No migration,
dependency or environment configuration is added, and no push/deploy occurs.

## Phase 5B.2 handoff — compact invoice context in Priorities

Use the existing read endpoint:

`GET /api/collections/invoice-disputes?tenantId=…&customerSourceId=…`

It can retrieve **only the selected customer's invoice records**, enforcing
existing user/tenant/entitlement/currency checks and holding accounting authority.
An optional `invoiceSourceId` narrows to one invoice. Invoice reads, dispute joins
and current/latest Promise presentation are already scoped; no global All Invoices
route or API is necessary. Tenant-wide access/currency metadata checks remain.

The alternative `GET /api/collections/customer-detail` already supplies overview
plus invoices in one coherent bootstrap and is appropriate if both are required.
For minimal queue invoice context, the invoice endpoint avoids requesting an
unneeded customer overview. The compact Dashboard queue payload contains no
invoice batch; do not fabricate context from weighted customer ageing.

Reuse InvoiceFrame/InvoiceAmounts for data wording and metadata, and
PromiseCommitment for commitment meaning. The future compact list needs a smaller
view that exposes reference, due date/age, outstanding and concise commitment or
dispute indication, without importing editors or bulk actions. Label the deep
link **View all invoices** and use:

`/customers?tenantId=…&customerSourceId=…#customer-invoices`

The invoice DTO includes open rows and retained settled/unavailable operational
records. Phase 5B.2 must select relevant context using established server states;
it must not invent invoice ranking or redefine customer actionability. Due date
is available; a ready-made invoice overdue-age field is not in this DTO.

Queue restoration needs a small, separate Phase 5B.2 frontend change. Prefer a
validated tenant plus durable customer-ID return parameter, find that ID in the
latest authoritative eligible queue, and fall back explicitly if it is no longer
eligible. Do not persist array indices, financial values or alter ordering.
Existing `restoreCustomerSourceId` already restores by identity for Undo, but is
currently in-memory and does not consume navigation return parameters. Browser
Back may restore some browser state; this phase does not rely on that guarantee.

No API change is required to start the compact selected-customer read. Risks:
rapid queue switching needs cancellation and late-response guards; customer invoice
sets can be large because the endpoint pages internally at 1,000 rows and returns
all relevant records rather than a compact bounded preview. Avoid per-invoice
requests, prefetching the entire queue or triggering accounting refresh. Measure
the hosted path before deciding whether a smaller bounded DTO is justified; any
API extension belongs to a separately reviewed follow-up.

## Phase 5D handoff

The shared frame, amount labels, disclosure and Promise presentation can be reused.
Worklist filtering, ordering, counts and membership reloads remain its existing
contract. Workspace-only disclosure must not become an accidental worklist rewrite.
Full disputes information architecture, grouping and operational efficiency remain
Phase 5D work. No later phase has begun.
