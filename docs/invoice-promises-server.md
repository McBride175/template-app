# Authenticated invoice Promise backend (Phase 6)

`/api/collections/invoice-promises` is a backend-only collections API. POST accepts
`tenantId`, UUID `commandId`, and `operation` (`create`, `edit`, `cancel`). Create
requires `invoiceSourceId`, exact decimal-string `amount`, calendar `promisedDate`,
and optional `note`. Edit/cancel require UUID `promiseId` and decimal-string
`expectedRevision`. Edit may supply amount/date/note. Positive numeric JavaScript
amounts are rejected; numeric zero, exact-string zero, blank/whitespace and null
on existing records cancel. Omitted amount leaves it unchanged. Cancel consumes
no date/note/reason and preserves the existing commitment.

Authentication uses verified Supabase `getUser`, exact requested tenant entitlement
and the existing currency access gate. No tenant fallback is accepted. No browser
has database grants on the Promise tables or privileged functions. Server-derived
customer/currency/generation/baseline/paid amounts are rejected as client inputs.

Mutations hold a succeeded authoritative generation across currency access,
invoice validation and baseline construction. The prepare RPC returns exact numeric
text, one invoice and an owned Promise when applicable. A create baseline queries
only that invoice's known durable payment IDs (including already known deleted
records), with v1 payment-observation start/completion and immutable creation-run
provenance. An unready generation is never an empty baseline. Initial paid is zero.
Create validates open positive ACCREC, supported currency/customer, amount no more
than gross outstanding (disputes do not reduce the maximum), and organisation-local
today/future date. Unknown timezone or unavailable evidence fails closed.

Financial edits retain the original baseline and creation window. The amount is a
new total commitment; remaining commitment after certified qualifying payments must
fit current outstanding. An edited date retains the original organisation-local creation window; it
cannot precede creation. Only creation imposes the today/future rule. Phase 5A
alone determines whether an elapsed edited deadline is eligible for resolution.
Its terminal result is applied immediately with ordered
`changed`, optional `note_changed`, and the system outcome event inside one
transaction. An already-satisfied edit produces `kept` immediately.
This uses the existing lifecycle rules, not a payment-total shortcut. Valid paid
facts may be refreshed without an evaluation lifecycle event. There is no application-specific deadline or outcome shortcut; every automatic
outcome is returned by the existing resolver.
Invalid qualification rejects financial editing as temporarily unavailable. The
sole exception is an observation that predates creation with an operational paid
total of zero: a newly created Promise can still edit without treating that old
observation as new payment evidence. A previously positive total is never reused
when qualification is unavailable.

Note-only edits and cancellation do not load full payment/cash arrays or run the
resolver. No mutation runs customer summaries, scoring or portfolio benchmarks.
Financial edits require complete generation arrays because Phase 5A validates
collection counts; this is deliberate, not repeated per-payment querying.

The forward migration `20260927193427_invoice_promise_server_commands.sql` adds a
private multi-event executor retaining Phase 2 command checks. Existing single-event and
reconciliation commands delegate to the same validated core with their original
fingerprints and signatures, avoiding a second lifecycle implementation. The commit RPC locks the
accounting tenant-state row, then the existing Promise tenant advisory lock, then
the command identity, matching promotion. It verifies the same generation and
prepared digest/revision before writes. No stale user intent is retried. This
prevents edits overwriting reconciliation and new creates bypassing the promotion
Active-set fence. An event failure rolls back all terms/status changes.

Idempotency is event-backed: all events in one request share the normalized
user-intent fingerprint/command UUID and deterministic command-event sequence.
Retries look up that receipt before fresh accounting validation, returning its
original event summaries plus the current scoped Promise DTO (`replayed=true`).
Changing intent under that command ID conflicts. There is no separate API command
store. A replay optionally reads the current scoped invoice without reconstructing a
baseline or validating old terms; unavailable accounting is `invoice=null`. It never
presents its original accounting context as current. Normal mutations return the held invoice
identity, currency and outstanding alongside the DTO and new event summaries.

GET with `tenantId` and `invoiceSourceId` returns current Active Promise and, only
with `includeHistory=true`, up to 50 retained commitments. GET with `promiseId`
returns the newest 100 immutable events in deterministic descending sequence.
There is no unbounded history read or worklist. DTOs expose exact native amounts,
revision, terms/status and created/updated/resolved/evaluated timestamps. Baseline
IDs, user/tenant internals, raw accounting evidence, internal sync UUIDs and command
fingerprints are withheld. Event DTOs expose terms, event/actor kind and business
and recorded time; never resolver payloads. Foreign or missing scoped identities
return safe empty reads/not-found, not another account's existence.

The accepted same-day ambiguity is unchanged: known creation IDs are excluded;
a later-observed same-day payment absent from the baseline may qualify. There is
no invented intraday cash timestamp.

Reconciliation already runs atomically with accounting promotion once Active
Promise rows exist. Phase 7 now integrates actionability into customer aggregation and
the recommendation queue. Phase 8 adds customer/invoice Promise controls, bounded
history and privacy export. A Promise worklist remains deferred. Legacy customer collection-action `promised_to_pay` remains contact
history only; explicit postponement still suppresses. Unapplied cash remains outcome-only.
