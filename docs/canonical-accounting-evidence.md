# Canonical accounting evidence — Phase 3A

Phase 3A supplies accounting evidence independently of collection amounts.
Phase 5B now consumes the unchanged contract for atomic Promise reconciliation.
Promise creation baselines, user CRUD/UI and queue actionability remain absent.

## Compatibility boundary

The existing authorised ACCREC Payments import, canonical collections projection,
`collections_readiness_v2` validation and promotion RPC are unchanged. Existing
payment-recency and collection consumers still use `canonical_payments`.

A separate generation-scoped `canonical_payment_evidence` projection is necessary
because deleted payments and unsupported/credit/refund payment types must not be
added to the existing payment-recency population. It carries the approved payment
contract, not a second collection balance. There is no backfill of old rounded raw
JSON into supposedly exact evidence.

The importer additionally fetches full Payments, Overpayments and Prepayments,
each followed by the existing overlap catch-up pass. Each collection uses stable
provider-ID ordering, all pages and an explicitly observed empty terminal page.
Catch-up conflicts need a genuine, distinct `UpdatedDateUTC` ordering; otherwise
the evidence stream is unavailable. These three streams run with at most three
concurrent provider requests, within the existing four-request generation limit.
This adds six paginated collection traversals to sync. The full Payments traversal
is deliberately independent of the existing filtered collections traversal so an
evidence-only failure does not invalidate existing collections functionality.

Provider fetch/envelope/pagination or evidence mapping failures record an incomplete
observation and do not make collections depend on Promise evidence readiness.
Lease loss, cancellation, generation deadline and database persistence failure
still fail the candidate sync, leaving the previous active generation unchanged.
A long unavailable provider call can therefore still consume the shared sync
budget. No new sync/job framework or environment configuration is introduced.

## Exact payment contract

`canonical_payment_evidence` contains:

- `sync_run_id`, `user_id`, `tenant_id`, `source_system='xero'`;
- `source_id` from PaymentID, `invoice_source_id` from Invoice.InvoiceID;
- `customer_source_id` from the held accounting invoice ContactID;
- `amount_native`: nonnegative, finite, unrestricted PostgreSQL numeric;
- `currency_code`: validated associated invoice currency for ACCRECPAYMENT;
- `payment_date`: valid provider accounting calendar date;
- `payment_type`, `payment_status`: explicit provider evidence;
- `source_updated_at`: nullable genuine UpdatedDateUTC only.

Supported ACCRECPAYMENT records require an ACCREC invoice in the same generation.
Any payment or embedded-invoice currency/contact supplied must agree with that
invoice. Missing/conflicting invoice context makes the stream incomplete.
AUTHORISED and DELETED are distinct. Other payment types remain identifiable,
without inventing an invoice currency/contact when their context is unavailable.
Their presence does not imply qualifying cash. No BankAmount, invoice AmountDue,
credit note, status change or modification time is used to infer fulfilment.
No exact cash-received timestamp is created. Payment date, modification time and
collection observation are distinct.

The accounting HTTP client uses pinned `lossless-json` 4.3.1 for Payments,
Overpayments and Prepayments. Amount, RemainingCredit and CurrencyRate numeric
tokens are preserved as decimal strings before JavaScript number conversion.
All other fields retain existing types; unrelated invoice monetary ingestion is
unchanged. Existing canonical payment `amount` remains its compatibility number.
Evidence mappers reuse the repository BigInt decimal utilities and reject already
rounded fractional number inputs. Safe integer inputs remain allowed for fixtures.
Provider precision is the upstream boundary; earlier legacy numeric snapshots
cannot recover digits already lost. No custom JSON parser was introduced.

## Minimal unapplied cash contract

`canonical_unapplied_cash_evidence` stores owner/tenant/provider/run plus:

- `source_kind` (overpayment/prepayment), durable provider ID;
- exact customer ContactID, validated against generation customers;
- `provider_type` (RECEIVE-OVERPAYMENT/RECEIVE-PREPAYMENT);
- exact, nonnegative `remaining_credit_native` from RemainingCredit;
- currency, valid accounting date, explicit status and nullable genuine update time;
- organisation base currency, positive exact Xero rate where supplied;
- nullable `remaining_credit_base`, conversion status and failure reason.

Spend-side resources are excluded after complete traversal. AUTHORISED, PAID,
VOIDED and DELETED remain distinct; a later consumer must use valid authorised
remaining cash, never voided/deleted entries. Unknown statuses, invalid amounts,
invalid dates, duplicate identities or missing customer context make the stream
incomplete. Zero RemainingCredit is a real observed zero, not a missing-data default.
No provider allocation structures, cash reservations, consumption, ledger, cash
API/UI or Promise links are persisted.

Same-currency native comparison does not require FX. Foreign amounts use the
existing native / Xero CurrencyRate conversion, eight decimals, half away from
zero. Missing/invalid foreign FX retains native cash and an explicitly unavailable
base valuation. It does not fabricate rate 1, zero cash or proof of payment.
Cross-currency consumers must also have trustworthy invoice/Promise currency
valuation; that comparison is not implemented here. Unapplied cash can later veto
Missed for multiple promises independently; it never proves Kept or affects
coverage/actionability.

## Readiness and observation

`xero_accounting_evidence_observations` has one scoped row per generation/resource:
contract `promise_accounting_evidence_v1`, observation start/completion, successful
page requests/populated pages, relevant source count, stored mapped count and
`complete`. An incomplete or absent row is unavailable evidence, not zero cash.
Cash source count is the receivable population after spend exclusion; page counts
cover the complete provider collection plus catch-up.

Fenced writes use `persist_xero_accounting_evidence`, 500 rows per batch. Partial
batches are not complete. The final batch requires stored/source counts to agree,
a completion not before the start, and page requests greater than populated pages
(explicit empty termination). Invoice/currency/customer/base relationships are
validated server-side and in SQL. Batch failure is transactional. An earlier
observation start is never replaced with a later retry start.

`inspect_xero_accounting_evidence` takes exact run/user/tenant identity and returns
contract version, `ready`, resource observations and normalized timezone. Ready
requires all three complete streams and an exact succeeded, currently active run
with normalized organisation timezone. Candidate, failed, wrong-owner and old
contract generations cannot be consumed as ready evidence. Old generations
remain usable by existing collections functions. FX-unavailable cash retains its
explicit per-record valuation limitation even when its resource is complete.

Later consumers must hold the existing authoritative snapshot and use exact
run/user/tenant/source filters on `canonical_payment_evidence_exact` and
`canonical_unapplied_cash_evidence_exact`. These security-invoker read views cast
all evidence numeric columns to decimal text, preventing Data API JSON number
rounding. No consumer-facing route is exposed in this phase.

Each resource start is captured immediately before its full collection fetch,
before authentication retries; completion is recorded only after full and catch-up
traversals and deterministic merge succeed. All three starts, not just completion
or promotion time, must later be after the organisation-local deadline boundary.
A collection straddling midnight is not a post-deadline observation. No deadline
comparison/resolution is implemented here. Resource metadata is not per-row/page.

## Organisation timezone

`canonical_organisations.timezone_iana` is derived from its existing Xero Timezone
and CountryCode using pinned `cldr-core` 48.2.0 Windows mapping and territory data.
Normalization matches compact Xero enum spelling to CLDR Windows identifiers,
selects the territory's representative zone, and validates it with Intl. A global
mapping is usable without a territory-specific entry only if mappings agree on
one zone. Missing/invalid country, unsupported zone or invalid IANA result returns
null and evidence is not ready for deadline use. No UTC/browser/server fallback.
UK GMTSTANDARDTIME / GB maps to Europe/London with real DST transitions. CLDR may
return an equivalent IANA alias; this is validated by the runtime. No new settings.

## Storage and rollout

All three new tables have RLS, no browser policies/access and service SELECT only.
Only the constrained service RPC writes; it uses the existing latest-generation
lease/fence authority and a fixed search_path. Run/owner/tenant composite FKs
cascade with generation/account retention. Source uniqueness is generation-scoped.
Indexes support invoice payment and customer remaining-cash lookups. Raw provider
allocation JSON is not retained in this projection. The Phase 2 migration is
unchanged; no existing migration is edited.

Forward migration: `20260927133642_canonical_accounting_evidence.sql`.
Apply in authorized Test before shipping this importer; database schema absence
must not be silently hidden. No hosted migration or Xero access occurred in Phase
3A. Phase 3B must certify the actual Test grant and read-only resource behaviour.
Privacy account erasure cascades through the new tables; later schema-aware export
work must include evidence before any user-facing Promise release.

## Phase 5B consumer

The evidence contract is unchanged. [Atomic Promise reconciliation](promise-reconciliation.md)
now consumes ready candidate observations before publication. No additional Xero
requests or unapplied-cash allocation are introduced.
