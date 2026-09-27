# Invoice Promise persistence (Phase 2)

Migration: `20260927130458_invoice_promises_persistence.sql`.
Phase 2 supplied storage only. Phase 5B now uses the constrained functions
from internal accounting promotion; no user Promise API is exposed.
No hosted migration application is authorized as part of Phase 2.

## Ownership, retention and integrity

Operational commitments use durable `(user_id, tenant_id, source_system,
invoice_source_id)` identities, never canonical generation row UUIDs. Only active
rows occupy the partial unique key; every terminal commitment is retained under
its own Promise ID. Currency, owner, identities, creation time, creation generation
and payment baseline are immutable. Active terms/notes can change; terminal rows
cannot. Cancellation preserves the amount/date/note rather than storing zero.

`creation_sync_run_id`, `evaluated_sync_run_id` and event `source_sync_run_id` are
provenance UUIDs without sync-run foreign keys. The writer validates that a run is
succeeded and belongs to the exact owner/tenant on first use. It does not inspect
invoice eligibility or fetch accounting data. This permits accounting retention
to change without destroying commitment history; a replay uses the committed
event before checking whether that accounting generation still exists.

Events have a composite owner/tenant FK to their Promise, a unique per-Promise
sequence, and at most one terminal event. Insert guards validate snapshot chains
and event meaning. Deferred constraint triggers check that creation exists and
that the final event matches the operational terms/status, and that event
revisions never exceed operational revision (terminal revisions agree exactly). They
also check terminal resolver/generation agreement. Several events may share an
operational revision and command. Timelines order by `event_sequence`, not time.

Both tables have RLS and no browser policies/grants. The service role can SELECT
but cannot directly INSERT, UPDATE, DELETE or TRUNCATE. The public-schema RPC is
executable only by `service_role`, uses SECURITY DEFINER and a fixed `pg_catalog`
search path, and qualifies application objects explicitly. Internal helpers have
no application-role execute grant. History guards reject UPDATE and individual
DELETE even by a direct administrative write; only deletion after the owning
`auth.users` row has disappeared permits the privacy cascade. Superusers can
disable triggers, as with all database integrity; that is outside ordinary logic.

## Command contract

`apply_invoice_promise_command(user_id, tenant_id, command_id, operation,
promise_id, expected_revision, actor_kind, actor_user_id, payload) -> jsonb`

The server calling this service-only RPC must authenticate the real user and
supply the exact owner/tenant. UUID command IDs are scoped to owner across tenants.
The result contains `promise_id`, `revision`, `status`, `event_sequence`.
User commands require `actor_kind=user` and `actor_user_id=user_id`; explicit
system outcome commands require `actor_kind=system` and null actor user ID.

| Operation | State effect | Payload |
|---|---|---|
| `create` | New active ID, revision 1, `created` event | source system, invoice/customer IDs, currency, decimal-string `promised_amount_native`, ISO `promised_date`, optional note, creation run UUID, payment baseline |
| `change_terms` | Active terms change, revision +1, `changed` event | decimal-string amount and ISO date; note stays unchanged |
| `change_note` | Active note change, revision +1, `note_changed` event | required `note`, string or null |
| `cancel` | Active → cancelled, revision +1, `cancelled` event | empty object; no reason or date required |
| `resolve` | Explicit Active → kept/missed/unclear, revision +1, matching event | status, decimal-string qualifying total, evaluated run/time, reason code, resolver version, versioned evidence, optional effective time |

Create requires null Promise ID and revision. Other commands require the existing
ID and positive expected revision. Each mutation locks the scoped row, compares
the expected revision and requires active state. Conflict is SQLSTATE `40001`
(`invoice_promise_revision_conflict`); callers must not automatically replay user
intent with a new revision. No-op edits are rejected without revision/event writes.
Invalid structure uses `22023` or the corresponding PostgreSQL type/constraint
error; unique active identity and changed command intent use `23505`.

Notes follow Disputes: input at most 2,000 characters, trim whitespace, empty →
null. Zero/blank amount is invalid create/change input here. The later server/UI
must translate cancellation input into `cancel`; no amount is overwritten with 0.

## Versioned JSON

`payment_baseline` version 1 has exactly:

- `version: 1`;
- `payment_ids: string[]` of unique, nonblank provider identities;
- `observation_started_at` and `observation_completed_at`: finite timestamp
  strings with explicit offsets, ordered start ≤ completion ≤ creation time.

The associated generation is the immutable `creation_sync_run_id`. Baseline
population/certification from Xero is excluded from Phase 2; tests use synthetic
fixtures only. The SQL shape validation does not claim the baseline is certified.

`before_terms`/`after_terms` version 1 have exactly `version`, decimal-string
`promised_amount_native`, `currency_code`, ISO `promised_date`, nullable `note`,
and `status`. The created event has null before terms and retains the original
commitment permanently. Snapshots deliberately exclude the rest of the row.

Automatic `evidence` is nullable outside system outcomes. For explicit system
outcomes it must be an object with `version: 1`, accompanied by source generation
and resolver version. Its detailed future evidence shape is deliberately not
invented here. `resolve` persists a supplied outcome; it does not calculate or
certify fulfilment, inspect deadlines, or run automatically.

## Idempotency

No separate command table is needed. Events retain command UUID, server-computed
SHA-256 intent fingerprint, command-local sequence and resulting Promise revision.
The fingerprint includes owner/tenant, operation, target, expected revision,
actor and payload. Monetary values, notes, UUIDs, baseline identity-set order and
timestamp instants are normalized before fingerprinting.
A transaction-scoped advisory lock serializes equal owner/command IDs before
creation; row locks serialize edits. Fingerprint matches reconstruct the original
committed result from the final command event, even after later edits/outcomes.
Different intent under the same command conflicts. Failed commands leave no
command/event entry. Future compound commands can append several events with
the same fingerprint and increasing `command_event_sequence`.

## Indexes

- Partial unique active invoice identity: active lookup and race protection.
- Owner/tenant/provider/invoice + creation time/ID: invoice commitment history.
- Owner/tenant/provider/customer + creation time/ID: customer commitment history.
- Partial active owner/tenant/provider/date/ID: later reconciliation scan.
- Event Promise/sequence unique key: timeline and privacy FK cascade lookup.
- Event owner/command/command-sequence unique key: replay lookup and deduplication.
- Partial unique terminal event per Promise: contradictory-outcome protection.

## Local verification and later work

Run `RUN_SUPABASE_INTEGRATION=1 node --test
tests/database/invoice-promises.integration.test.mjs` with the repository's local
`supabase_db_template-app` container running. It creates a unique disposable
database, copies only the local auth schema (no data), replays all active forward
migrations, executes real PostgreSQL locking/constraint/rollback tests, then drops
only its own database. It does not apply this migration to the local application
database or any hosted project. No new environment-variable name is introduced.

Privacy account deletion is covered through auth-user cascades. Privacy exports
will need Promise records/events included before a later phase exposes populated
Promises to users; Phase 2 does not alter existing export payloads.

Phase 3 still needs certified payment/cash evidence, exact ingestion, readiness
and observation provenance, timezone handling and verified Test grant access.
None of those is implemented or wired to this persistence in Phase 2.

## Phase 5B extension

The forward-only reconciliation migration adds the bounded system
`record_invoice_promise_evaluation` operation and tenant locking around existing
commands. It changes no Promise terms or event types. Atomic promotion now applies
Phase 5A results; see [the reconciliation contract](promise-reconciliation.md).
