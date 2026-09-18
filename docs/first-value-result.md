# First-value result

Phase 6 introduces a focused result at `/start/result`. It is the bridge between the
authoritative preparation flow and the mature collections workspace; it does not replace the
workspace or its operational controls.

## Customer comprehension target

Within the first few seconds, a new customer should be able to tell that Yuohme analysed their
Xero organisation, understand the scale of the overdue position, identify the first customer to
chase, and see factual reasons for that ordering. When more than one customer is eligible, the
surface also shows the next one or two customers so the result is visibly a ranking rather than a
debt list.

The surface deliberately does not teach scoring weights, show a raw score, predict payment,
collectability or risk, or expose generation and currency-processing internals.

## Authoritative data

The existing collections actions API remains the authority. The first-value surface uses:

- the authoritative promoted snapshot selected by the collections summary service;
- the existing prioritisation order and existing score components;
- base-currency overdue values and currency-health authority;
- existing entitlement and multi-currency access gates;
- existing collection actions and customer overrides, scoped by user and Xero tenant.

No scoring calculation is duplicated in the UI. The API exposes the already-calculated urgency
and payment-recency component values so that deterministic explanation text can select the
strongest implemented score contributions. Founder adjustment remains `normal` by default; an
existing `priority` or `safe` adjustment is stated explicitly.

## Information hierarchy

1. Organisation, currency and freshness confirmation.
2. Authoritative overdue total and customer count.
3. A visually dominant `Start here` recommendation.
4. Up to two factual reasons drawn from the score inputs.
5. Up to two next-ranked customers when a comparison exists.
6. A transition into the full operational queue.

Only safely valued receivables appear in a degraded-currency ranking. If there are no safely
rankable customers, or currency is unavailable, the surface withholds a ranking and provides the
existing focused data-review route.

## First-run determination

The result API derives `hasPriorCollectionActivity` from existing tenant- and user-scoped
collection-action and customer-override records. A user with prior operational activity goes
straight to the mature Dashboard. A user without that activity sees the focused result and can
enter the workspace through the result itself. This avoids a new schema marker and does not rely
on browser storage, timing or a query parameter.

Refreshing before the customer records any collection activity can show the focused result again.
That is intentional: the server can prove that value is still unconsumed, while a client-only
"seen" marker would be brittle. Once operational activity exists, the resolver consistently uses
the mature workspace.

## Successful outcomes and gates

- **Ranked:** portfolio context, first recommendation, reasons and a real comparison where one
  exists.
- **One eligible customer:** the recommendation is shown confidently and identified as the only
  current priority.
- **No overdue receivables:** confirms successful analysis and that nothing currently needs
  chasing.
- **Overdue but no actionable customers:** reports the overdue position and the authoritative
  action, postponement and payment-promise suppression context.
- **No mapped receivables:** confirms the connection but explains that the snapshot has no mapped
  balances or invoices to compare.
- **Degraded but safely rankable:** shows a clearly provisional ranking from safely valued rows and
  identifies how many customers are held out.
- **No safely rankable currency data:** withholds priorities and sends the customer to the existing
  Xero-data review route.
- **Multi-currency plan or usage gate:** preserves the existing entitlement response and does not
  bypass billing authority.

## Explanation guardrails

Explanation reasons are deterministic. Candidate reasons are ordered by their actual weighted
contribution to the existing score; the two strongest are shown, followed by an explicit operator
adjustment when one exists. Wording describes overdue exposure, amount-weighted overdue age,
deterioration from the customer's own recent payment timing, or recorded payment recency. It never
claims likelihood of payment, risk, expected recovery or best cash per effort.
