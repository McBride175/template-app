# Phase 5B.1 — Mobile usability refinement

Locally complete on develop, 10 October 2026. Baseline: `7e378ada`.
This phase changes presentation and queue selection only. Hosted Preview and
real authenticated financial workflows require subsequent certification.

## Implementation

- Product H3 links already lead to `/dashboard`; public navigation already leads
  to `/`. The previously unlinked onboarding H3 now links to `/`, with a named
  link and decorative artwork. SVGs and Logo sizing are unchanged.
- The existing mobile modal opens from a bordered hamburger **Menu** button,
  at least 44px high/wide. Header height remains about 83px at 320px. Existing
  modal focus, Escape, navigation dismissal and desktop rail logic are unchanged.
- Controlled `QueueNavigation` adds **Back to #1** only beyond the first eligible
  customer. It selects index zero in the current server-ranked queue and focuses
  the customer article, scrolling only when needed and respecting reduced motion.
  It adds no queue read or mutation. Follow-up choice, custom date and disclosure
  stay selected. Customer-specific notes clear to prevent attaching a draft to
  another account; ordinary Next/Previous retain their established reset behaviour.
- Below 640px, repeated queue headings/captions and excess spacing are reduced.
  Outcome buttons precede the optional Add note control. First-action guidance is
  shorter; financial figures, priority context and history remain accessible.
  Manual **Refresh priorities** moves into **Financial details & queue refresh**
  for a populated mobile queue. Its handler is unchanged; refreshing, error and
  empty states keep their visible feedback/control.
- Healthy accounting status is compact on mobile, with secondary messages in
  **Refresh details**. Accounting **Refresh**, retry/error feedback and all
  material warnings remain visible. The activity observer, job policy, throttling,
  freshness calculations and status client are unchanged.
- `DisputesFilters` extracts the existing GET form into a presentation component.
  Search/Apply stay visible; secondary fields fold into **Filters** on mobile.
  Fields remain mounted, preserving unsent selections when folded. Applied-filter
  count, custom-sort indication and tenant/page-size-preserving Clear filters are
  visible where applicable. Reset filters restores pending fields to the current
  query. Above 640px all fields remain visible; search and Apply precede the
  secondary fields in both DOM and visual order. The worklist/actions are unchanged.

No new API, client-side financial calculation, dependency, theme token,
environment-variable configuration or migration is introduced. The existing
global accounting activity policy still observes trusted product interaction;
the new selection control does not create its own refresh or queue request.

## Local certification

| Check | Result |
| --- | --- |
| Focused unit/integration tests | 95 passed, 0 failed/skipped |
| `pnpm test:shell` | 27 Chromium tests passed, no retries/skips |
| Responsive widths | 320, 390, 768 and 1440px |
| Guarded compiled-app `pnpm test:e2e:smoke` | 8 passed, 5 skipped, no retries |
| ESLint; application and Storybook TypeScript | Passed |
| Production and static Storybook builds | Passed; 56 indexed stories |
| `pnpm security:sqlcheck` | Passed |
| Agent-browser axe: queue article / expanded filter main | 0 violations, 0 incomplete each |

Coverage includes menu touch targets/focus/Escape/dismissal, H3 destinations,
Back to #1 keyboard operation/follow-up preservation, latest authoritative head,
no extra collection reads, native GET fields/disclosure/reset, material warnings,
loading/empty/error presentation, supplied amounts, delayed-logo stability and
horizontal overflow. The new browser file uses the existing isolated loopback
Storybook config; it cannot enable the unfinished financial application journeys.

The real application smoke verifies public/onboarding navigation and signed-out
protections. Two authenticated read journeys lack a designated safe Test session;
three mutation journeys still lack per-run safe fixtures. All five remain skipped.
Synthetic Storybook and mocked real-client checks do not certify authenticated
live accounting data, hosted Preview, WebKit or native Safari.

## Visual evidence

Synthetic before/after screenshots, accessibility results and test logs are saved
outside Git at:

`/Users/admin/.codex/visualizations/2026/10/09/01a1226e-541c-7c20-a789-88721f8de175/yuohme-5b1-qa/`

| Matched fixture | Before | After | Improvement |
| --- | --- | --- | --- |
| 390px first outcome top | 824.75px | 597.75px | 227px earlier |
| 320px first outcome top | 876.75px | 629.75px | 247px earlier |
| 390px collapsed disputes worklist top | 866.75px | 461.75px | 405px earlier |
| 1440px first outcome top | 582px | 582px | Unchanged |

The 1440px approved first-priority queue screenshots are byte-identical. At
390px all four normal outcome buttons fit in the 844px viewport; first-use
guidance also leaves the first action visible. Long names, warnings and expanded
details naturally need more scrolling. The desktop disputes form retains every
field; shared Field controls/search-first ordering add 22px in the reference
fixture. No desktop shell or dispute worklist redesign occurred.

Reviewed evidence includes mobile/narrow dashboard before/after, mobile menu,
return-to-first before/after, first-action guidance, collapsed/expanded/applied
filters, tablet dashboard and desktop queue/disputes. Evidence uses fictional
customers and amounts, not customer data or personal browser sessions.

## Programme handoff

Phase 5C can reuse QueueCustomer's financial disclosure, controlled navigation,
focus helper and existing customer/history links. Keep customer-specific notes
separate from queue-wide timing choices and use existing server-derived amounts.
Phase 5F — Disputes Workspace Redesign (previously labelled 5D) retains responsibility for dispute worklist hierarchy/actions; this
phase only refines the existing filters and mobile spacing. No later phase has
begun. Do not infer hosted certification from these local results.
