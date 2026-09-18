# Founder knowledge and customer context

Founder knowledge is optional, durable context supplied by the operator after Yuohme has already
ranked the ledger from Xero. It is not an onboarding requirement and it is not inferred by Yuohme.

## Established states

- **Priority** increases the customer’s relative priority using operator knowledge outside Xero.
- **Normal** uses the accounting-data recommendation without an adjustment. It is the default and
  is represented by the absence of an override row.
- **Safe** reduces the customer’s relative priority using operator knowledge outside Xero.
- **Do not chase** persistently excludes the customer from the actionable chase queue until the
  operator changes the state.

The scoring multipliers remain authoritative in `lib/collections/prioritization.ts`. Customer-facing
copy communicates direction and consequence rather than exposing those implementation values.

## Boundary from collection actions

Customer context is durable. Postponing, recording a payment promise, or logging that a customer was
already contacted is operational and temporary. A customer should not be marked Safe merely to delay
work until Friday, and Do not chase should not be used in place of a temporary postponement.

## Authority and reranking

The existing `/api/collections/override` route is the sole mutation path. It authenticates the user,
resolves the tenant through entitlement authority, enforces currency access, and scopes persistence by
user, tenant, and customer. The client never predicts a new position. After a successful mutation it
reloads the authoritative collections result and only then reports movement or changes the current
queue customer.

The Customers surface reads the same persisted state and uses the same mutation route. It remains an
optional proactive management surface; it is not inserted into first value or normal queue entry.
