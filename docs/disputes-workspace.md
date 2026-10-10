# Phase 5F — Disputes Workspace Redesign

Phase 5F starts from local `develop@15288d3`, preserving the unpushed Phase 5E
management correction. It adds compact dispute presentation and routine in-place
management. Phase 5G remains Account, Connections & Onboarding and is not begun.

## Product and presentation

`DisputeWorklist` is a divided, aligned operational list: customer/invoice identity,
**Effective disputed** in invoice currency, actual operational status and Manage.
The invoice identity is a separate 44px investigation link. Review, settled-versus-
unresolved and unavailable-accounting warnings remain visible outside any disclosure.
Ordinary open-state jargon and nested invoice cards are absent.

Mobile uses a small three-column row with a compact status line; desktop aligns
identity, amount, status and Manage. Long names/references/amounts wrap naturally.
Search and Apply stay accessible; secondary status/customer/sort controls collapse
on mobile, retaining selections and displaying the current status/filter count.
Existing GET names, status categories, search/customer semantics, sort order,
page-size bounds and server page clamping are preserved. Applied navigation uses
normal App Router URL state; there is no financial state persisted in navigation.

Resolution is an operational decision, not payment. A settled accounting invoice
can retain an unresolved dispute. Missing/invalid accounting values are unavailable,
not zero or inferred settlement. Native amounts are not summed across currencies.
Existing exact base-currency ordering and unavailable-valuation placement remain
server owned. Customer credit is never allocated to disputes/invoices.

## Shared controller and management

`DisputeManagement` opens the shared native `ManagementDialog` and mounts the
existing `InvoiceDisputeList` once, independent of visible worklist rows. Its
`managementOnly` presentation uses the extracted controlled `DisputeManagementPanel`,
with no InvoiceFrame nesting or bulk controls. Customers uses the same controller,
panel and existing invoice disclosure; customer bulk eligibility/commands remain
unchanged. The Promise dialog delegates to the shared shell with its original labels,
retry guidance and focus selector; no Promise functionality is added.

The controller still owns POST construction, revisions, full/partial intent,
note/resolve/confirm/reactivate commands and certified reconciliation. Partial
validation keeps the existing eight-decimal/positive/current-balance limits and now
uses the existing exact decimal comparator instead of binary-number comparison.
Money presentation reuses the existing exact formatter. No backend financial
formula, mutation API, lifecycle, entitlement, schema or accounting evidence rule
changes. A synchronous pending guard prevents double submissions.

On opening a known customer's record, one existing selected-invoice GET supplies
current authoritative context, including available Promise coverage. Initial page
loading has no extra requests or per-row editor loading. An accounting-unavailable/invalid record, or an orphan without
customer identity, retains its already-authoritative worklist DTO; actions still follow the existing invoice-state eligibility rules. Accounting-
unavailable records retain note/explicit resolution rather than financial editing. It is not turned
into a synthetic financial invoice.

A ready reconciliation supplies the updated selected invoice directly; one worklist
read updates membership. Financial operations retain tenant-scoped queue invalidation
with the existing ready payload; note/review metadata does not trigger a new queue
refresh. Opening Manage never requests scoring, accounting refresh or reconciliation.
Fallback/recovery reads use one selected invoice and the current worklist, without
loading a customer portfolio. Accounting-unavailable/orphan records recover through that existing worklist read.
Their allowed note/resolution operations refresh the operational record only; a
missing financial reconciliation does not manufacture available balances or enable
financial editing/reactivation. Restored identity is adopted from the owned read.
Abort, sequence, URL, tenant and mounted guards reject stale results. Background
worklist updates never replace an active draft's invoice/revision. No global state
layer, prefetch, new endpoint or dependency is added.

The existing dispute API **does not have Promise command-ID idempotency**. This
phase does not invent it. An uncertain response keeps the editor/draft mounted and
locked, with **Check current dispute** performing reads only. It never automatically
reposts a mutation. After authoritative recovery users review the actual current
record before another operation; recovery does not assert that the earlier command
committed or failed. Revision checks remain authoritative for subsequent operations.
This is separate from a confirmed response followed by failed reconciliation/read:
that change stays saved, its returned operational record is retained, financial
figures are identified as last loaded, and unsafe follow-up controls stay disabled
until current context is restored. Read retries never repeat the write.

Native dialog focus containment/Escape, 44px controls, scroll locking/restoration,
origin-row or heading fallback focus, unsaved-discard confirmation and browser unload
warning protect the editing surface. Pending/uncertain writes block closing and
invoice navigation. No custom animation or separate phone editor is introduced.

## Investigation and return

Separate View invoice links use durable tenant/customer/invoice identity and a
normalized same-tenant `/disputes` return URL. Customers exposes Back to Disputes;
customer-history links and Back to Customers retain that context too. External,
foreign-tenant, wrong-workspace and fragment-bearing return values are rejected.
Existing queue/Promise return contexts remain distinct. A row leaving Active after
resolution does not unmount the manager or discard its success state; filters,
sort, page and scroll remain in place. Server page clamping remains unchanged.

## Local certification

All UI fixtures are fictional. Storybook renders the shared controlled panel/dialog
without feature controllers or service clients. Its Save/Resolve previews expressly
make no request and do not fabricate committed financial outcomes. Actual controller
operations are verified separately with mocked authenticated API boundaries and
existing financial/domain tests. This is not real hosted mutation certification.

Certification on 10 October 2026:

- **554 bounded financial/domain/security tests passed**, zero failures/skips:
  dispute API/server/lifecycle, exact actionability and customer credit, Promise
  lifecycle/reconciliation, scoped financial responses, auth/tenant/currency
  entitlement and queue eligibility/order. This run precedes the final narrow
  unavailable-record/incomplete-response guards; those are covered below.
- **101 final controller/customer/Promise regressions passed**, zero failures/skips.
  Real React/JSDOM tests exercise the existing controllers with mocked API boundaries:
  full/partial/note/resolve/confirm/reactivate, exact large-number validation, conflict,
  synchronous save lock, uncertain/incomplete responses, saved-but-refresh-failed,
  read recovery, disappeared row, orphan/unavailable operational management, retained
  filter/page/draft, late tenant responses, and existing customer bulk/Promise behaviour.
  Two old global-worklist shape/hook-slot tests were migrated to these real controller
  integration checks; their former hide-on-refresh-failure expectation contradicts
  the required retained-manager behaviour. Assertions were replaced with stronger
  retained/locked manager, read retry, no replay and stale-response checks.
- **52 Chromium responsive regressions passed**, no failures/retries/skips: new
  Disputes plus existing Customers, Promises and mobile patterns. Final focused
  Disputes rerun: **7 passed**, no retries, at 320/390/768/1440px including keyboard
  focus containment/Escape, filters, safe deep links, mixed currencies, Promise
  coverage, warning states and before/after measurements. Counts overlap.
- Guarded local production smoke: **8 passed, 5 skipped**, no failures/retries.
  Two designated-session checks and three unfinished financial-mutation journeys
  remain disabled. No real authenticated/financial writes were enabled.
- agent-browser mobile worklist, management dialog and partial editor inspection;
  scoped axe-core 4.12.1 WCAG A/AA audits each reported **zero violations/incomplete
  checks**. These are scoped local audits, not a full assistive-technology audit.
- Lint, application and Storybook TypeScript, production/Storybook builds, SQL safety
  and whitespace checks pass. Storybook has 16 focused Disputes states, including an
  earlier-presentation reference. No dependencies/environment variables changed.

All **four documented baseline failures** were checked and remain outside this
phase: `founder-context.test.mjs` expects Find a customer inline rather than in
CustomerBrowser; `accounting/refresh-server.test.mjs` freezes migrated invoice UI
against `23d0037`; two `collections-queue-status.test.mjs` checks expect pre-extraction
hook slots/inline markup. The old founder/frozen-invoice assumptions are already
false at `15288d3`; the unchanged queue checks reproduce independently. Baseline
runs were 25 passed/2 failed and 52 passed/2 failed respectively. None was weakened.
A 225-check isolated UI/source baseline passed but did not include these four files.
An optional full default-suite attempt was stopped for severe local memory contention;
its incomplete output is not claimed as a completed pass. The required financial
regression was then run with two workers and passed. An overlapping build/browser
attempt was also stopped/retried in isolation; final results above are completed runs.
Initial new-test issues (an underestimated invoice-read count and foreign names in a
new-tenant mock's customer options) were corrected to reflect the actual existing
access read and scoped fixture, without changing application behaviour or retries.

Before/after density uses a controlled reproduction of the previous nested worklist,
not an authenticated Safari capture. At 390px ordinary rows measured **696 → 79px**;
at 1440px **532 → 61px** (approximately 89% reduction). Exceptional warnings add
natural height. At 390×844 the ordinary rows allow about six complete entries after
header/filters; desktop 1440×900 allows about ten. This is an ordinary-row estimate;
long identities and review warnings reduce the count. Evidence outside Git is in
the local `disputes-workspace` folder: before/after, 320/390/768/1440px list,
partial editor, review, resolved and unavailable management, long values,
loading/empty/error and accessibility reports.

The server still loads tenant-wide disputes, active Promise context and identity
batches before applying existing filters/pagination. Synthetic 20/5,000-record
measurements retain a bounded 25-row HTTP projection: 16,725 bytes at 20 records;
20,954 bytes at 5,000 records (still only 25 rows). Current-invoice reads include the
existing 1,000-row access/currency population scan and 200-ID worklist batches:
2 at 20, 31 at 5,000; 10/44 total fake table reads respectively. No N+1 query is
introduced. Query/projection timings were approximately 73ms/2,093ms in the in-memory legacy
access mock, not real SQL/network measurements. Timings under local test contention are not hosted
latency or query-plan certification. The aggregate read remains a scaling limitation;
measure representative Test tenants before proposing a separate bounded read-model
optimisation. No query architecture/migration has been silently changed here.

Production, main, schemas, environment variables, approved artwork, Promise engine,
accounting/scoring, Xero, auth/billing and global navigation are unchanged. No push
or deployment is included. Real authenticated hosted permissions/edit/resolve/review/
reactivation, concurrent-accounting recovery and native Safari/mobile Safari remain
for certification after an approved push; Playwright Chromium is not Safari.

## Phase 5G handoff — Account, Connections & Onboarding

Reuse existing semantic form/action recipes, compact search/secondary-filter
presentation and shared accessible management dialog where appropriate. Keep loading,
definite errors, confirmed-save/refresh warnings and uncertain operations distinct.
Mobile should keep actionable content early, 44px controls and the existing compact
H3 header; no shell/navigation redesign is required. Preserve existing connection,
entitlement and onboarding rules. Use safe designated Test fixtures for hosted
certification, and defer obsolete source-test cleanup to Phase 5J. No Phase 5G work
is implemented here.
