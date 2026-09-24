# Progressive onboarding

Yuohme does not use a dedicated post-value setup screen, checklist, tour, or onboarding state
machine. A customer enters the operational product directly after the focused first-value result.
Guidance is derived from existing user- and tenant-scoped product state and appears only where it
changes the customer's understanding of the current task.

## Minimum competent journey

1. Open today's queue from the focused first-value result.
2. Review the current customer's accounting evidence and Yuohme's score-based prompt.
3. Contact the customer and record the action, or defer the customer to a real return date.
4. See the customer leave today's queue and continue with the next authoritative priority.
5. Stop when the queue is complete; deferred customers remain out until their chosen date.

No profile, customer-classification, billing, synchronisation, or feature-discovery task gates this
journey. Founder context remains optional and follows the operational action controls.

## State-derived guidance

| Guidance | Trigger authority | Repeat behaviour |
| --- | --- | --- |
| First collection-action explanation | The collections API reports no prior collection action or customer override for the scoped user and tenant | Remains unobtrusive until authoritative operational activity exists; no separate dismissal or persistence |
| Postpone consequence | The customer opens the existing dated-postpone control | Appears only in that action context |
| Payment-promise consequence | The customer selects the existing payment-promise outcome and a return date | Appears only in that action context |
| Queue-complete explanation | The authoritative queue reports that every currently eligible customer is actioned or deferred | Reconstructed on every load from queue/action state |
| Free allowance notice | The authoritative entitlement reports one or zero collection-use days remaining while access is still valid | Hidden earlier; shown at the commercial boundary and replaced by the existing gate after exhaustion |

The guidance policy is pure presentation logic in
`lib/collections/progressive-guidance.ts`. It does not persist onboarding state, change entitlement
decisions, or create a second source of truth.

## Capability placement

| Capability | Classification | Placement decision |
| --- | --- | --- |
| Current priority and collection action | ESSENTIAL TO FIRST OPERATIONAL USE | Present directly after first value; one state-derived explanation clarifies that recording an action advances today's queue |
| Postpone and payment promise | INTRODUCE IN CONTEXT | Return-date consequences appear inside the relevant controls, not before the user opens them |
| Already contacted/actioned state | INTRODUCE IN CONTEXT | Authoritative action feedback and queue movement show the consequence after the action |
| Founder context | INTRODUCE IN CONTEXT | Remains optional on a real customer after the action controls; no classification step is added |
| Customers / All Customers | PASSIVELY DISCOVERABLE | Available in mature navigation, from founder context, and as an optional link after queue completion |
| Prioritisation explanations | ESSENTIAL TO FIRST OPERATIONAL USE | Existing deterministic reasons and score-based prompt copy are sufficient; no scoring tutorial is added |
| Freshness and automatic Xero refresh | INTRODUCE IN CONTEXT | Freshness is shown at first value; automatic refresh remains primary and manual refresh is reserved for returning operational users |
| Xero reconnect and permission recovery | ADMIN/RECOVERY ONLY | Existing focused recovery and Account controls remain available when server state requires them |
| Currency limitations | ADMIN/RECOVERY ONLY | Existing focused currency gates and safe degraded-state explanations remain authoritative |
| Free-use allowance | COMMERCIAL BOUNDARY ONLY | Hidden during early free use; a restrained notice appears with one or zero collection days remaining |
| Basic/Pro, checkout and subscription | COMMERCIAL BOUNDARY ONLY | Pricing remains discoverable and existing gates lead to it; no plan task is inserted after first value |
| Account | ADMIN/RECOVERY ONLY | Contains billing, Xero recovery, password, privacy and deletion controls; it is not an onboarding destination |
| Team/user setup | FUTURE FEATURE — DO NOT ONBOARD YET | No established customer capability exists to teach or configure |
| Notifications | FUTURE FEATURE — DO NOT ONBOARD YET | No established notification workflow exists to teach or configure |
| Guides/help | PASSIVELY DISCOVERABLE | Remains in mature navigation without links competing with the current collection task |
| Integrations | ADMIN/RECOVERY ONLY | The existing direct route is retained as a secondary connection-management view; the golden path does not use it |
| Privacy/export controls | ADMIN/RECOVERY ONLY | Retained in Account and used only when the customer needs those controls |
| Generic checklist/tour/profile questions | REMOVE/OBSOLETE | None is introduced; existing product state is sufficient |
| Queue-complete “Next steps” and Disputes link | REMOVE/OBSOLETE | Removed because it manufactured extra work and linked to a route that intentionally returns not found |
| Internal/template Admin navigation item | REMOVE/OBSOLETE | The route remains directly addressable, but it is no longer promoted as a customer capability |
