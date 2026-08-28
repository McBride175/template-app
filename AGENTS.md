# Repository operating rules

- Read `ARCHITECTURE.md` before architecture, deployment, integration, or database work.
- Test and Vercel Preview use Supabase project `rbmxegyiwntomhpbepnu`; Production uses `sswyxbugbdoadktyaows`.
- Never change a hosted Supabase schema or migration history without explicit user authorization and an exact project-ref preflight.
- Every schema change requires a new forward-only timestamped file in `supabase/migrations/`.
- Never edit a migration after it has been applied to a shared environment. Files in `supabase/migrations_legacy/` are evidence only and must not be executed.
- Never make manual SQL Editor changes unless the same change is represented in Git.
- Never commit `.env` files, credentials, tokens, or `supabase/.temp/` metadata.
- Apply and validate migrations in Test before a reviewed Production rollout.
- Report every migration and environment-variable name added or changed.
- Before declaring work complete, run lint, TypeScript checks, relevant tests, the production build, and `pnpm security:sqlcheck`, or report the blocker.
