# Current prioritisation methodology

This document describes the scoring path currently implemented in
`lib/collections/prioritization.ts`. It is the source of truth for claims about the
released numeric customer ranking. Broader credit-control guidance may recommend
additional human judgement without implying that the software scores it.

## Current scored inputs

The engine groups canonical Xero receivables at customer level. For each eligible
customer it calculates three 0–100 components:

1. **Overdue exposure.** `100 × customer overdue outstanding / largest eligible
   customer overdue outstanding`, clamped to 0–100. Share of total overdue AR is
   shown as context but is not the scoring denominator.
2. **Urgency.** The customer’s amount-weighted average overdue days is positioned
   against the portfolio amount-weighted average (`A`) and maximum (`M`):
   - if `M <= 0`, the base is 0;
   - if `M <= A` or `A <= 0`, the base is `100 × customer days / M`;
   - at or below `A`, the base is `50 × customer days / A`;
   - above `A`, the base is `50 + 50 × (customer days - A) / (M - A)`.

   The base is clamped to 0–100. An overdue-invoice-count contribution is then
   added: 0 for one invoice, 5 for two, 10 for three or four, and 15 for five or
   more. The resulting urgency component is capped at 100.
3. **Payment recency.** Days since the latest recorded payment maps to 0 for today,
   10 for 1–7 days, 20 for 8–14, 40 for 15–30, 60 for 31–45, 80 for 46–60 and 100
   for 61 or more. No recorded payment history also maps to 100.

The base customer score is:

`0.50 × exposure + 0.35 × urgency + 0.15 × payment recency`

It is rounded to one decimal place. A user-selected adjustment is then applied:
Safe `× 0.40`, Normal `× 1.00`, Priority `× 1.60`, or Do not chase `× 0.00`. The
final result is rounded to one decimal place and is used for ordering. The final
score is intentionally not capped after the multiplier.

The score maps to a score-based UI prompt: Review now at 70 or above, Follow up at
30–69.9, Monitor above 0 and below 30, and No action at 0 (or when nothing is
overdue). These are threshold labels, not predictions or context-aware next-best
actions; the user still decides the appropriate contact and treatment.

## Not current scored inputs

A recent partial payment does not add to or subtract from any component. Payment
records still determine the latest-payment date used by payment recency.

Historical payment timing and relative lateness are currently calculated and shown
as diagnostic context. Relative lateness—how late a customer is now compared with
how late that customer normally pays—is a committed future scoring component, but
it has no numeric weight in the current engine.

Payment promises, payment plans, disputes, free-text notes, failed contact,
continued supply, concentration, profitability and similar commercial evidence are
not interpreted automatically by this score. A user may reflect relevant knowledge
through one of the four priority adjustments. A future postponed or
promised-payment return date removes that customer before portfolio context and
ranking are calculated; this is a workflow eligibility rule, not a customer score
signal.
