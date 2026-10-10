# Invoice Promise experience (Phase 8)

The customer invoice list is the management surface. `InvoiceAmounts` renders the
server's canonical Outstanding, Disputed and Promised coverage values; zero
adjustments are hidden. Customer-level To chase includes applicable customer
credit, which is not allocated to invoice rows. Zero customer To chase is never
presented as payment/settlement.
The main Promised row is active coverage. A compact commitment summary retains
its fixed amount/date, note, received amount and differing current coverage.

`InvoicePromise` submits only amount/date/note, context identity, current revision
and an idempotency command to the Phase 6 API. New amount/date fields are blank;
no deadline or commitment is inferred. Client validation is convenience. The
server owns organisation-local date rules, eligibility, exact amount validation,
creation baselines and any immediate terminal outcome. A note-only edit omits
amount/date and uses the existing cheap backend operation.

Clearing or zeroing an Active amount changes the primary action to Cancel promise
and hides date/note fields. Cancellation preserves commitment terms. Terminal
commitments have no edit/reactivate controls; Record new promise starts a new ID.
Unclear is a neutral historical outcome, never a task or review workflow.

## Scoped refresh and retries

After a financial save, the committed DTO is retained locally while one
`invoice-disputes` GET with `invoiceSourceId` refreshes the affected invoice and
one `customers` GET with `scopeCustomerSourceId` refreshes that customer. Other
invoice rows remain visible. The scoped summary reuses the canonical aggregation
with filtered customer/invoice/payment/operational reads. Customer payment-date
fallback still includes its invoice-linked payments without a customer ID.
Tenant-wide minimal gross currency context is still checked for subscription
eligibility; scoping cannot bypass that boundary. No scorer runs on mutation or
on the scoped customer refresh.

Financial saves notify an already-open queue to fetch a proper portfolio ranking;
background tabs wait until visible. Queue mounts already fetch current state.
Same-window events and cross-tab storage signals contain only the tenant identity
and a nonce. No scores are patched locally. Note edits do neither refresh nor
invalidation. A lost save response keeps the command ID for identical intent.
Committed saves with failed refresh show a separate message and a refresh-only
control, disabling further edits until authoritative context is refreshed.
Conflicts refresh context, discard the stale form and require a new user decision.

## Bounded history and privacy

The invoice presentation batch includes the latest retained operational commitment
and its public terms. Settled and missing provider invoices retain access to
Promise history; missing balances stay unavailable. Events are not loaded in the
invoice batch. Opening history reads up to 50 invoice commitments. Expanding one
commitment reads up to 100 events, ordered by its independent event sequence.
Created/changed/note/cancelled/Kept/Missed/Unclear events receive concise wording.
Raw accounting evidence, baseline IDs, generation IDs, revisions and resolver
reason/version fields never appear in the history UI.

Privacy export includes all owned operational terms, notes, lifecycle
status/timestamps, certified paid amount and meaningful before/after event terms.
Both tables are paginated independently, failing rather than producing a partial
export if either read fails. Internal command fingerprints, baseline IDs and raw
resolver evidence are excluded. Existing privacy authentication and signing are
unchanged.

No Promise worklist, unified Action History, manual terminal resolution, cash UI,
reliability scoring, analytics or payment plans exist. Legacy promised-to-pay
contact actions remain history only; explicit postponement retains its behavior.
Hosted migrations, end-to-end real-Xero UX certification and rollout remain
separate Phase 9 work.
