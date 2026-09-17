# Xero granular-scope migration

Xero's broad Accounting API scopes retire on 13 September 2027. Phase 5A now
requests this least-privilege read set for every new or re-authorised grant:

- `offline_access`
- `accounting.settings.read`
- `accounting.contacts.read`
- `accounting.invoices.read`
- `accounting.payments.read`

New authorization requests no longer include `accounting.reports.read` or
`accounting.transactions.read`. No report, Bank Transaction, Manual Journal, or
Accounting write capability is requested.

## Capability interpretation

Granted scopes are normalized, deduplicated, sorted, and stored on the encrypted
server-side grant record. Runtime decisions use capabilities rather than exact
scope-string equality:

- `granular_ready`: every required capability is present and Invoice and Payment
  access are supplied by their granular scopes. This is the public-launch target.
- `legacy_broad_compatible`: the grant is currently usable because the retiring
  `accounting.transactions.read` (or write equivalent) supplies Invoice and
  Payment access, but it is not granular launch coverage.
- `permission_upgrade_required`: authoritative scope metadata exists but one or
  more required product capabilities is absent.
- `reauth_required`: existing token/auth evidence says the credentials are
  revoked, expired, disconnected, or otherwise unusable.
- `scope_metadata_unknown`: an older stored grant has no authoritative scope
  metadata. The authoritative generation sync rejects it and it must be
  re-authorised before launch.

Xero allows broad and granular scopes to coexist during migration. Scopes are
additive on re-authorisation, so a transition grant may contain both. A grant is
`granular_ready` once both granular Invoice and Payment capabilities and the
other required capabilities are present, even if the retiring broad scope is
also still listed.

The authorization callback is authoritative for a new grant's scope set. Token
refresh preserves the stored set if Xero omits `scope`; if Xero explicitly
returns a scope set, the normalized returned set replaces the stored metadata.
Raw granted scopes stay in `xero_oauth_grants`, which is service-role-only.
Capability classification is derived server-side when a grant is used and raw
scope metadata is not copied to browser-readable connection rows.

## Endpoint capability matrix

| Endpoint | Application purpose | Previous capability | Target capability | Disposition |
| --- | --- | --- | --- | --- |
| `GET /Organisation` | Organisation identity and base currency | `accounting.settings.read` | `accounting.settings.read` | Keep |
| `GET /Organisation/Actions` | Retained legacy multicurrency diagnostic | `accounting.settings.read` | None for normal sync | Legacy primitive only; normal generation sync does not call it |
| `GET /Contacts` | Customer identity, status, and archive state | `accounting.contacts.read` | `accounting.contacts.read` | Keep |
| `GET /Invoices` | Open receivables and paid-invoice history | `accounting.transactions.read` | `accounting.invoices.read` | Keep |
| `GET /Payments` | Independent receivable-payment history | `accounting.transactions.read` | `accounting.payments.read` | Keep |
| `GET /Accounts` | Retained legacy raw import only; unused by prioritisation | `accounting.settings.read` | None for normal sync | Legacy primitive only; normal generation sync does not call it |
| Accounting reports | No repository call | `accounting.reports.read` | None | Scope removed |
| Bank Transactions | No repository call | Included in broad transactions scope | None | Do not request |
| Manual Journals | No repository call | Included in broad transactions scope | None | Do not request |

Normal manual, automatic, and scheduled synchronization uses the generation
lifecycle and does not fetch Accounts or Organisation Actions. The retained
legacy helper still contains those calls for rollback/forensic compatibility;
it is not reachable from normal sync entry points. No additional scope is
requested for either legacy-only endpoint.

## Implemented launch state

Do not treat a grant as granular merely because it continues to work with the
retiring broad scope. The implemented operational contract is:

1. Connect/reconnect requests only the five least-privilege scopes listed above.
2. The callback stores Xero's authoritative normalized granted scopes on the
   encrypted grant and derives capabilities server-side.
3. Normal sync requires a usable grant with all generation-import capabilities.
4. Manual, Dashboard automatic, and scheduled sync all import an immutable
   generation, map it, pass `collections_readiness_v2`, and atomically promote
   it under the current fence.
5. Readers use the exact `active_sync_run_id`; legacy null-generation data is a
   fallback only when no active generation exists.
6. The recovery operator can inspect/reacquire/revalidate a prepared run, but is
   deliberately separate from normal sync and promotion authorization.

No scope-specific schema migration is required:
`xero_oauth_grants.scopes` provides the protected, per-grant storage needed for
authoritative scope metadata.

Phase 3 application code must be deployed before
`20260915064459_xero_generation_persistence_transition.sql` is applied to a
database serving the application.

## Source-consistency boundary

Xero does not expose transactional snapshot isolation for these collection APIs.
The generation importer performs complete, immutable-ID-ordered primary traversals,
then repeats Contacts, ACCREC Invoices, and ACCRECPAYMENT Payments with
`If-Modified-Since` from five seconds before the run started. Versions are merged
by source ID and `UpdatedDateUTC`; ambiguous conflicts fail the generation.

This is a practical near-snapshot, not a mathematical snapshot. A mutation during
catch-up can still race it, and Xero documents that changes only to Contact
balances or the `IsCustomer`/`IsSupplier` flags do not cause a Contact to be
returned by `If-Modified-Since`.

Official references:

- https://developer.xero.com/documentation/guides/oauth2/scopes/
- https://developer.xero.com/faq/granular-scopes
- https://developer.xero.com/documentation/guides/oauth2/auth-flow/
- https://developer.xero.com/documentation/best-practices/api-call-efficiencies/if-modified-since/
