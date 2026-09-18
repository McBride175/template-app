# First-value preparation experience

The first-value preparation surface lives at `/start`. It derives every customer-facing state from the existing user/tenant-scoped Xero connection, authoritative snapshot, latest fenced sync run, and trusted run-step manifest. It does not persist a second progress state machine.

## Customer-facing progress model

| Customer state | Backend entry condition | Backend exit condition | Reload behaviour |
| --- | --- | --- | --- |
| Connected to Xero | Usable connection, no authoritative result and no active run | A fenced run becomes active | Reconstructed from connection and tenant state |
| Reading your receivables | Latest owned run has a live lease and not every retrieval step has succeeded | Contacts, authorised invoices, paid invoices and payments are persisted with completed manifest steps | Reconstructed from the latest owned run and manifest |
| Analysing receivables | Every retrieval step has succeeded | Canonical mapping step succeeds | Reconstructed with completed aggregate counts |
| Building chase priorities | Canonical mapping has succeeded | Validation and atomic promotion complete | Reconstructed from the manifest and authoritative pointer |
| Ready | A resolvable snapshot has authoritative freshness | Immediate navigation to the existing result | Returning users go directly to the result |
| Failed/interrupted | Latest attempt is failed, abandoned, or has an expired lease | Explicit focused retry, reconnect, or permission update | Reconstructed without treating polling age as failure |

The browser may skip stages when the server advances between observations. It never delays a ready result to replay missed stages.

## Early-data boundary

| Fact | Classification | Reason |
| --- | --- | --- |
| Xero connection and organisation name | AVAILABLE EARLY AND SAFE | Comes from the validated user-owned connection |
| Contact, invoice and payment counts | AVAILABLE EARLY AND SAFE | Shown only after all corresponding persisted run steps have succeeded |
| Total receivables and overdue amount | AVAILABLE ONLY AFTER AUTHORITATIVE PROMOTION | Intermediate canonical or currency data may be incomplete |
| Number of overdue/actionable customers | AVAILABLE ONLY AFTER AUTHORITATIVE PROMOTION | Requires authoritative aggregation, suppression and currency checks |
| Customer names, invoice details and payment content | NOT APPROPRIATE DURING PREPARATION | Unnecessary for progress and potentially sensitive |
| Technical run, fence, manifest and promotion details | NOT APPROPRIATE DURING PREPARATION | Operational implementation detail rather than customer progress |

## Observation and recovery

The observer uses bounded backoff between checks but has no client-side failure deadline. A status-request failure is a temporary observation problem and does not alter the last known server state. A running server lease remains running; failed or expired work becomes a focused recovery state. Refreshes and additional tabs observe the existing run and do not start another generation.

The “taking longer” message appears only after 30 seconds and only while the server still reports an active run. The threshold changes explanatory copy, never the underlying progress stage. No percentage or ETA is shown.
