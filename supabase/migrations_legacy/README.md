# Legacy migration archive

These 25 SQL files preserve the repository's pre-baseline database history. They include manual-era, transitional, superseded, empty, and lexically misordered migrations and are intentionally stored outside `supabase/migrations/` so the Supabase CLI will not execute them.

The active migration chain starts with `supabase/migrations/20260813205201_baseline_current_schema.sql`. Do not move these files back into the active directory or treat this archive as a replayable schema definition.
