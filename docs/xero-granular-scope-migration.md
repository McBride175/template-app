# Xero granular-scope migration design

Xero's broad Accounting API scopes retire on 13 September 2027. The generation
importer is designed for these least-privilege read scopes:

- `offline_access`
- `accounting.settings.read`
- `accounting.contacts.read`
- `accounting.invoices.read`
- `accounting.payments.read`

The current OAuth request remains unchanged during Phase 4. It still requests
`offline_access`, `accounting.settings.read`, `accounting.reports.read`,
`accounting.contacts.read`, and `accounting.transactions.read`.

## Endpoint capability matrix

| Endpoint | Future purpose | Current broad capability | Target capability | Disposition |
| --- | --- | --- | --- | --- |
| `GET /Organisation` | Organisation identity and base currency | `accounting.settings.read` | `accounting.settings.read` | Keep |
| `GET /Organisation/Actions` | Existing multicurrency feature diagnostic | `accounting.settings.read` | `accounting.settings.read` | Optional; not required by the first generation importer |
| `GET /Contacts` | Customer identity, status, and archive state | `accounting.contacts.read` | `accounting.contacts.read` | Keep |
| `GET /Invoices` | Open receivables and paid-invoice history | `accounting.transactions.read` | `accounting.invoices.read` | Keep |
| `GET /Payments` | Independent receivable-payment history | `accounting.transactions.read` | `accounting.payments.read` | Keep |
| `GET /Accounts` | Legacy raw import only; not used by collections mapping | `accounting.settings.read` | `accounting.settings.read` until removed | Remove from the future active importer |
| Accounting reports | No repository call found | `accounting.reports.read` | None | Remove scope before launch |
| Bank Transactions | No repository call found | Included in broad transactions scope | None | Do not request |
| Manual Journals | No repository call found | Included in broad transactions scope | None | Do not request |

## Pre-launch cutover

1. Deploy and validate the inactive generation importer while OAuth still accepts
   existing broad grants.
2. Change the OAuth request to the target scope set above in a separate review.
3. Reauthorise the Test Xero connection; Xero does not silently add new scopes to
   an existing grant.
4. Confirm the callback persists the granted scopes and capability assessment is
   sufficient.
5. Exercise a complete generation import in Test and inspect its manifest before
   enabling promotion or generation-backed readers.
6. Launch using granular scopes only. Remove broad Test grants after successful
   reauthorisation rather than treating them as representative launch coverage.

During Xero's migration window, capability checks accept either the legacy broad
transactions read scope or the equivalent invoice and payment granular read
scopes. They do not compare one exact historical scope string. A connected grant
that lacks a required capability should eventually surface a plain-language
permission-upgrade action; revoked or invalid tokens remain a separate reconnect
state.

## Source-consistency boundary

Xero does not expose transactional snapshot isolation for these collection APIs.
The importer therefore performs complete, immutable-ID-ordered primary traversals,
then repeats Contacts, ACCREC Invoices, and ACCRECPAYMENT Payments with the
official `If-Modified-Since` header from five seconds before the run started.
Versions are merged by source ID and `UpdatedDateUTC`; an ambiguous conflict fails
the generation. Invoice and Payment status changes that leave the required set
act as tombstones before persistence.

This is a practical near-snapshot, not a mathematical snapshot. A mutation during
the catch-up traversal can still race it, and Xero documents that changes only to
Contact balances or the `IsCustomer`/`IsSupplier` flags do not cause a Contact to
be returned by `If-Modified-Since`. The future active rollout should retain this
limitation in operational diagnostics and reassess webhooks or a second
verification pass if real volumes make the residual race material.

Official references:

- https://developer.xero.com/documentation/guides/oauth2/scopes/
- https://developer.xero.com/faq/granular-scopes
- https://developer.xero.com/changelog
- https://developer.xero.com/documentation/best-practices/api-call-efficiencies/if-modified-since/
- https://developer.xero.com/documentation/api/accounting/contacts
