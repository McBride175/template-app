# Phase 5B — Priorities and collection queue

Implemented locally on `develop` from the completed Phase 5A checkpoint
`5aff80856cd9aa0d07cac017fc22c013eea74a6e`. This phase changes collection
presentation only. No push, hosted certification, Production operation or
Phase 5C implementation is included.

## Interaction and hierarchy

The default remains a **focused next-action queue**, with a bounded numbered
Queue order beside it at widths of 1280px and above. At most five nearby customers
are shown, retaining the supplied order and true position. Selecting a row and
Previous/Next use the same existing selection state; there is no second worklist,
sorting mode or request. Below 1280px the supporting list is hidden, leaving one
customer and one set of actions. The Phase 5A rail and compact H3 header are unchanged.

Priority position, customer name and server-supplied customer **To chase** lead
the view. The score-based prompt and weighted overdue age are supporting facts.
Priority adjustments use a neutral label; selection tint identifies the current
customer, not urgency. No red/amber/green priority coding is used. Genuine errors,
warnings and feedback continue through the existing semantic recipes.

The four established outcomes remain immediate choices after working the customer:
No response, Message sent, Responded — no commitment, and Reviewed — no chase
needed. No outcome is preselected. Follow-up defaults to Tomorrow, with the same
server schedule and custom-date option. An optional note can be added before the
outcome. Existing save locking, uncertain-save retry, Undo and feedback are retained.
Changing customer clears that customer's draft through the original reset effect.

Invoice/history links remain visible. Financial detail and Customer context use
native disclosure controls rather than competing panels. Existing permanent
Never chase confirmation remains inside FounderContextControl. Promises and
disputes are managed in the existing invoice context, not recreated here.

## Components and integration

| File | Responsibility |
| --- | --- |
| `app/collections/actions/QueueCustomer.tsx` | Ranked customer, formatted supplied amounts, links and financial/context disclosure |
| `app/collections/actions/QueueActionPanel.tsx` | Controlled existing outcome, timing, note and retry controls |
| `app/collections/actions/QueueOrder.tsx` | Bounded, numbered selection within supplied order |
| `app/collections/actions/QueueState.tsx` | Shared loading, empty and error presentation |
| `app/collections/actions/CollectionActionsClient.tsx` | Existing state, requests and mutations; connects the new presentation |
| `app/dashboard/DashboardOnboardingClient.tsx`, `page.tsx` | Consistent preparation/loading and existing connection feedback |

The components reuse Button, Card, Badge, Alert, Field, Input, Textarea, Spinner
and EmptyState, the existing semantic tokens, and ProductShell. No dependency,
theme dictionary, general UI framework or new state-management layer is added.
The optional legacy table remains available to existing callers with neutral
priority prompts. Its existing route still redirects as before.

## Financial and performance boundaries

The primary amount is `customer_to_chase_overdue_base`, including certified
customer-credit deductions. Gross overdue, disputed overdue, active promised
overdue and applied credit remain separately labelled supplied values. Total
outstanding is displayed only if supplied. Native invoice-currency breakdown
retains the existing credit/currency conditions. No balance is inferred by adding
or subtracting these amounts; their scopes differ.

The compact Dashboard bootstrap deliberately omits full `reason`,
`score_breakdown_lines`, total outstanding and payment-pattern comparisons.
The view shows the actual recommendation and weighted overdue age; it explicitly
acknowledges unavailable detailed drivers inside the disclosure. If a fuller
authoritative projection supplies explanation fields, they are displayed unchanged.
No explanation, payment change or urgency label is invented, and no extra fetch
is made to fill the gap. Richer explanations require a separately scoped backend
decision; this phase does not change that contract.

The existing bootstrap, bounded refresh observer, request stamps, reconciliation,
queue eligibility and mutation handlers are unchanged. There are no new requests,
accounting calculations, broad refreshes, waterfall loads or service clients.
The original state/request/mutation body and Dashboard effects were checked
byte-for-byte against the starting checkpoint. All tracked API, library, database,
shell, authentication, billing, integration, theme and brand files are unchanged.

## Local certification

- 99 focused Node/component/regression checks passed, including action idempotency,
  Undo, follow-up eligibility, response ordering, credits, independent scoring
  scenarios and bootstrap request counts. A new integrated Queue order check
  confirms draft reset, exact customer selection and no extra GET.
- 17 isolated Chromium browser checks passed without retries or skips: ten queue
  checks and seven existing shell checks. Queue checks cover supplied order/amounts,
  selection, keyboard outcome callbacks, follow-up/date/note controls, saving/retry,
  distinct loading/empty/error states and overflow at 320/390/768/1440px.
- The compiled local Test application smoke passed eight checks without retries;
  **five authenticated/financial checks remain skipped**. No dedicated safe Test
  storageState exists, and mutation fixtures remain unfinished. No credentials,
  personal sessions or customer financial data were used.
- Eleven deterministic queue stories build with the existing 37 stories (48 total).
  They cover populated/first rank, long names, large amounts, promises/disputes/credit,
  loading, three empty meanings, error, saving and uncertain save. Fixture callbacks
  demonstrate presentation only and do not imitate service mutation success.
- Desktop, mobile, tablet, narrow long-name, active financial adjustments, action
  controls, loading and empty screenshots were inspected. The first outcome fits
  within an 844px-high 390px default fixture. Controls are at least 44px high;
  names/amounts wrap without horizontal overflow. Optional detail increases height
  naturally rather than covering content with fixed controls.
- Targeted agent-browser review used an isolated local session. Axe reported zero
  violations on desktop and mobile; the queue-only mobile audit also had zero
  incomplete checks. The full mobile audit repeated the already documented shell
  hidden-dialog `aria-controls` manual-review item, covered by the unchanged shell
  DOM/browser tests. Native Safari and WebKit were not tested.
- Lint, application and Storybook TypeScript, production application build,
  static Storybook build and `pnpm security:sqlcheck` passed. No migration,
  dependency or environment-variable name was added. Source-map upload was disabled
  only for the local build process; persisted environment/configuration is untouched.

Visual evidence and structured results are saved outside Git in this task's
`yuohme-5b-qa/` workspace: `desktop-queue.png`, `mobile-queue.png`,
`narrow-long-name.png`, `tablet-queue.png`, `promise-dispute-credit.png`,
`action-interaction.png`, `loading-queue.png` and `empty-queue.png`.
These are **synthetic component/layout evidence**, not authenticated or hosted
application certification. Test/build output and captures are excluded from Git.

## Phase 5C handoff

Customer pages can reuse the formatted financial hierarchy, controlled action
panel, truthful state component, existing primitives and wide ProductShell. Keep
customer navigation/history/invoice links and existing mutation reconciliation as
integration points; do not introduce a parallel action service. QueueCustomer's
rank/count are queue-specific, while customer context and invoice controls retain
their existing ownership.

Obtain a designated safe Test session before positive authenticated browser
certification, and establish failure-safe fixtures before enabling the five pending
journeys. Hosted review requires separate approval to push/deploy and verification
of the develop Preview's exact SHA. The previously recorded alias-automation issue
remains a separate follow-up. No Phase 5C work has begun.

Subsequent work: [Phase 5D — Priority Invoice Intelligence](priority-invoice-intelligence.md)
adds selected-customer read-only invoice context and durable-ID return navigation.
The Phase 5B certification above remains its historical checkpoint; new work uses
[the consolidated programme sequence](ui-programme.md).
