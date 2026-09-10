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

## Development branch

- `develop` is the sole authoritative active development branch for the pre-launch application.
- Unless a task genuinely requires isolation, work from and return changes to `develop`.
- Do not recreate or use the retired `test-stripe` branch.
- Do not create release, candidate, or other task-specific branches for ordinary work unless isolation provides a concrete benefit.
- Treat temporary audit, experiment, and release-packaging branches as disposable; reconcile any unique work and delete them when finished.

## Preview/Test environment

- Pushes to `develop` create Vercel Preview deployments using Test Supabase project `rbmxegyiwntomhpbepnu` and Stripe Test/Sandbox mode.
- Preview/Test is the normal environment for validating current application work before launch; the stable `develop` Preview alias may be used for hosted testing.
- Do not infer Production state from what is deployed on `develop`.

## Production

- `main` is Vercel's configured Production Branch and uses Supabase Production project `sswyxbugbdoadktyaows` with Stripe Live mode.
- Public Production may intentionally lag behind `develop`. Its current deployment historically came from a manually promoted older `test-stripe` commit; `main` nevertheless remains the configured automatic Production Branch.
- Do not push, merge, fast-forward, or otherwise update `main` unless the task explicitly authorizes a Production release.
- Do not manually promote a Preview to Production unless explicitly instructed.
- Do not modify Production Supabase or Stripe Live unless the task explicitly requires it.

## Default Codex behaviour

- For ordinary development, assume `develop` is the correct branch and preserve newer work already present there.
- Before creating another branch, determine whether isolation is actually necessary; prefer one development line over accumulating permanent task-specific branches.
- If isolation is useful, state the branch's purpose clearly, then reconcile and delete it when the work is complete.
- Never treat a branch name alone as proof of its deployment environment; `ARCHITECTURE.md` is authoritative.
- If branch or environment state conflicts with `ARCHITECTURE.md`, inspect and report the discrepancy before changing deployment-sensitive configuration.

## Interrupted or resumed work

- After any Codex interruption, usage-limit reset, context reset, partially completed run, or resumed session, do not assume the task must be restarted. Treat the repository and working tree as the source of truth.
- Before continuing, inspect the current state using the appropriate combination of `git status`, `git diff`, relevant files, test results, logs, and other available evidence. Determine what is complete and what remains unfinished.
- Preserve valid completed work and continue only the remaining work. Do not repeat, overwrite, revert, or duplicate completed changes unless they are incorrect or conflict with the task.
- If a run stopped during an edit or command, verify the resulting state rather than assuming the operation succeeded or failed.
- Complete the original task and run relevant verification or tests when appropriate. Interpret short instructions such as “continue,” “resume,” or “carry on” using this recovery process.

## Local Docker environment

- Docker Desktop is installed on this Mac and Codex may use it where useful.
- Docker and Docker Compose may be used for local services, isolated testing, reproducing environment issues, database tooling, and other appropriate development tasks.
- Before assuming Docker is unavailable, check with `docker --version`, `docker compose version`, or `docker info`.
- Prefer the project's existing development setup; do not introduce Docker unnecessarily.
- Do not modify or delete unrelated containers, images, volumes, or networks.
- Do not run broad destructive commands such as `docker system prune`, bulk image or container removal, or volume deletion unless the task specifically requires it and the impact is understood.
