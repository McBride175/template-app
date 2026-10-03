# Phase 3.5 fast collection queue

The financial calculation remains the certified Phase 3.4 derivative. The new
queue read never calculates a benchmark or score on a warm hit. It combines that
calculation with current overrides and Action History, then uses the unchanged
founder adjustment, eligibility and row-presentation contracts.

1. The service-role `read_collection_queue_projection_inputs` RPC reads the
   current G/F calculation, P, compact ranking inputs, overrides and latest
   actions in one statement snapshot. It verifies the ready calculation's
   complete population digest. An absent or invalid calculation is a miss.
2. The TypeScript selector applies the existing multiplier, action band,
   eligibility, exact-decimal ordering and JavaScript name tie-break. It keeps
   full population counts independent of the display limit.
3. `read_collection_queue_projection_details` checks the same G/F/P and fetches
   only selected full score rows (at most 200). The server checks selected
   payload digests against the first snapshot before formatting explanations.
   A changed dependency makes the server retry; an old generation is never
   labelled current.
4. Priority and Action History mutations return their committed domain result
   with this authoritative projection. The client accepts the newest P and
   request sequence, and only performs a recovery GET if post-commit projection
   is unavailable. Action History reuses its already authenticated/entitled
   command context for the post-commit projection. The prior broad customer-summary route remains an exact
   authoritative fallback while programme migrations are absent or transport
   fails; it is not executed on a valid warm fast path.

The two new SQL functions are in
`supabase/migrations/20261003153000_collection_queue_projection_inputs.sql`.
They are service-role-only, fixed-search-path, tenant/owner scoped and additive.
Apply the Phase 3.2, 3.3 and 3.4 migrations first. No hosted migrations have
been applied during Phase 3.5.

`docs/fast-queue-local-baseline.json` preserves disposable-local synthetic
measurements. Queue timings exclude auth/entitlement and browser-network time;
the action timings report synthetic local mutation writes separately and as
write-plus-projection totals. Hosted performance remains uncertified.
