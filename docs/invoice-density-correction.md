# Customer Workspace invoice density correction

Focused Phase 5C presentation correction, 10 October 2026. Phase 5D remains
Priority Invoice Intelligence; the next official phase remains Phase 5E —
Global Promises Workspace. No later phase is implemented here.

## Presentation

`InvoiceFrame` is now a divided list row, collapsed by default in Customers.
Reference and due date sit beside native-currency Outstanding, a 44px bulk
selection target where eligible, and a labelled Manage target (52px wide and at least 44px high). Normal
open invoices have no “Open in accounting” or “No dispute” labels. Open is not
interpreted as overdue. All supplied records, including settled operational
records, remain in the list.

Active Promise original amount/date and canonical current coverage, full/partial
dispute coverage, changed-balance review warnings, settled unresolved disputes,
and unavailable accounting/currency remain visible while collapsed. No invoice
To chase or allocation of customer credit is introduced. Coverage is displayed
from the supplied DTO; unknown coverage is distinguished from zero.

One Manage disclosure opens both workflows. Desktop shows Dispute and Promise
side by side; mobile stacks them, with the actions first. Forms appear only when
the existing edit action is invoked. Record/note, full commitment details and
received amount, invoice metadata/amount disclosure, and Promise history remain
available without increasing collapsed row height. Terminal Promise outcomes
remain available in expanded management. Bulk actions are a quiet collapsed
“Bulk actions” disclosure; a nonzero selection count appears on its label.

The detail subtree is hidden, never conditionally unmounted by this disclosure.
Closing/reopening preserves existing draft values, command identity, uncertainty,
pending locks and loaded history; it sends no request. A bottom Close control
returns focus to Manage. Native button/summary keyboard behaviour and visible
focus outlines are retained. Invoice hash navigation/focus reveals its management
panel without fetching. No animation or motion requirement is introduced.
The existing Disputes worklist's shared editor remains initially expanded.

## Measured evidence

Local Chromium, Plus Jakarta Sans, fictional supplied records. Baseline is
`221e445`; both captures include the same bulk-selection controls and fixture
values. Measurements are individual row border-box heights in CSS pixels;
full viewport widths include the existing ProductShell and customer browser.

| Viewport | Ordinary before → after | Active Promise | Partial dispute | Promise + dispute | Needs review |
| --- | --- | --- | --- | --- | --- |
| 320 | 324 → 73 | 508 → 117 | 348 → 97 | 532 → 141 | 648 → 205 |
| 390 | 272 → 61 | 460 → 105 | 296 → 85 | 484 → 129 | 560 → 173 |
| 768 | 252 → 61 | 392 → 85 | 276 → 85 | 416 → 109 | 468 → 133 |
| 1440 | 252 → 61 | 392 → 85 | 276 → 85 | 416 → 109 | 468 → 133 |

Typical collapsed invoice reduction is approximately 78% on mobile and 76%
on desktop. Ten ordinary rows occupy about 610px (730px at 320px), excluding
list heading/controls. Exceptional references, amounts and warnings wrap
naturally; there is no fixed row height or truncation.

Expanded Promise editing with an active partial dispute measures 738 → 794px
at 320, 690 → 782px at 390, and 566 → 546px at 768/1440. The old capture keeps
its separate dispute disclosure closed; the new capture exposes dispute tools
alongside Promise editing. Expanded mobile editing is deliberately taller than
that baseline to preserve both workflows, full-size fields, secondary disclosures
and an accessible close target. Only invoked editing consumes this space.

Before/after collapsed and expanded screenshots and JSON measurements are kept
outside Git under:

`/Users/admin/.codex/visualizations/2026/10/09/01a1226e-541c-7c20-a789-88721f8de175/invoice-density/`

Files are `before-chromium-{width}.png`, `after-chromium-{width}.png`,
`before-expanded-chromium-{width}.png`, `after-expanded-chromium-{width}.png`
and the corresponding `*-heights.json` records. Widths are 320/390/768/1440.
Storybook adds `InvoiceDensity` and `TenInvoices` to CustomerWorkspace (80
stories total); fixtures include Promise/dispute/review/unavailable states.

## Local certification

- 114 focused Node checks passed, no failures or skips. These cover native
  invoice amounts, Promise create/edit/cancel/terminal/history, exact money,
  uncertainty/idempotent retry, pending submit, dispute revisions/conflicts,
  bulk eligibility, scoped refresh, reconciliation and customer navigation.
- Seven new real-client mocked-transport checks specifically exercise collapsed
  rows, retained dispute/Promise drafts, uncertain and pending writes across
  collapse, bulk selection, warnings/membership and invoice fragments.
- The older late-customer-response harness called an obsolete effect index;
  it now invokes the independent list read after the existing queue-return
  context effect. Application data-loading code is unchanged.
- 24 final Chromium Storybook Playwright checks passed, no retries or skips,
  at 320/390/768/1440, followed by four passing focused reruns after the final
  mobile target-width correction. Customer discovery, supplied financial values, Promise
  editing/cancellation/history, long names/amounts, warnings, loading/empty,
  keyboard disclosure/focus, 44px controls, retained drafts, ten-row density
  and no document overflow are covered. The isolated stories send no API calls.
- Earlier browser runs exposed a test locator that changed membership as Manage
  buttons became Close buttons. The test now targets durable invoice identities;
  the final suite passes without retries.
- Guarded compiled local Test application smoke: 8 passed, 5 skipped, no retries.
  Two authenticated checks lack a designated saved session; three mutation
  fixture journeys remain intentionally disabled. No hosted write is exercised.
- ESLint, application/Storybook TypeScript, Storybook static build, production
  build and SQL safety check passed. No migrations or environment variables change.
- Targeted agent-browser visual review and axe audits: desktop collapsed and
  expanded and final narrow mobile audits have zero violations/incomplete findings.
  An earlier mobile review found the 46.28px Manage label extended outside its
  44px target; widening it to 52px corrected containment. The measured approved
  teal-on-white text contrast is 6.40:1. No new palette token is introduced.

Playwright WebKit's executable is not installed; no tools were installed. These
screenshots certify synthetic local Chromium, not native macOS/iOS Safari or
real authenticated hosted customer mutations. User-approved Preview deployment
and Safari review remain the next verification step.

## Financial and programme boundaries

No changes to `InvoicePromise` handlers, `InvoiceAmounts`, domain/API code,
financial calculations, eligibility, invoice membership, ranking, Promise/dispute
lifecycles, credit treatment, authentication, billing, database or refresh/
reconciliation architecture. The existing action handlers and permitted controls
are moved intact. Phase 5A–5D navigation, Priorities and approved brand assets
are untouched. No push, deployment or Phase 5E work is included.
