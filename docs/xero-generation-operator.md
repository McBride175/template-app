# Test Xero generation operator

This internal CLI is the only reviewed mechanism for invoking one inactive Xero
generation import outside application routes. It is structurally restricted to
Test project `rbmxegyiwntomhpbepnu`; Production and unknown project refs are
rejected without a bypass option.

## Command

Load the server-only Test environment, then run:

```sh
pnpm xero:generation:operator -- \
  --project-ref rbmxegyiwntomhpbepnu \
  --user-id <uuid> \
  --tenant-id <uuid> \
  --grant-id <uuid> \
  --dry-run
```

All four identifiers are mandatory. The command checks that the configured
Supabase URL resolves to the supplied Test project, the service credential can
verify the supplied user, the active tenant connection points to the exact grant,
the grant is `granular_ready`, and no non-expired tenant run exists.

`--dry-run` performs only those read-only checks. It does not call Xero, acquire a
run, mutate a lease, or write generation data.

Omit `--dry-run` only during an explicitly authorised one-import checkpoint. One
process invocation calls `importXeroGeneration` at most once and never retries the
whole import. A successful command stops at `ready_for_promotion`; this operator
contains no promotion option, RPC, pointer mutation, or cleanup behavior.

Output is structured JSON containing identifiers, aggregate counts, manifest
state, timing, provider request metadata, and sanitized failure classifications.
It never prints OAuth tokens, service credentials, provider payloads, contacts,
invoice details, or monetary amounts. Import failures exit non-zero and preserve
the inactive run for diagnosis.

Production operation is prohibited by implementation, not convention. There is
no `--force`, Production mode, or guard bypass.
