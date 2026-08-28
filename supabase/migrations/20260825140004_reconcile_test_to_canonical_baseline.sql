-- Reconcile the schema drift confirmed on the Test project without replaying
-- the canonical baseline over objects that already exist there.
--
-- Every operation below is repeatable and is also harmless when this migration
-- runs immediately after the canonical baseline on a fresh database.

-- Billing usage is absent from Test. The canonical baseline already contains
-- the table, so IF NOT EXISTS keeps the fresh-baseline replay harmless.
create table if not exists public.billing_usage_days (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null,
  usage_date date not null,
  user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint billing_usage_days_tenant_usage_date_key
    unique (tenant_id, usage_date)
);

create index if not exists idx_billing_usage_days_user_id
  on public.billing_usage_days (user_id);

-- The canonical subscription cache permits transient rows without a period end.
-- Dropping NOT NULL does not modify any existing values and is repeatable.
alter table public.subscriptions
  alter column current_period_end drop not null;

-- Consolidate all updated_at triggers on the canonical hardened helper.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Drop both legacy and canonical trigger names so replay always converges to one
-- canonical trigger per table without using CASCADE.
drop trigger if exists update_subscriptions_updated_at
  on public.subscriptions;
drop trigger if exists update_user_privacy_preferences_updated_at
  on public.user_privacy_preferences;
drop trigger if exists update_privacy_requests_updated_at
  on public.privacy_requests;
drop trigger if exists update_xero_raw_updated_at
  on public.xero_raw;
drop trigger if exists update_canonical_customers_updated_at
  on public.canonical_customers;
drop trigger if exists update_canonical_invoices_updated_at
  on public.canonical_invoices;
drop trigger if exists update_canonical_payments_updated_at
  on public.canonical_payments;
drop trigger if exists update_xero_oauth_grants_updated_at
  on public.xero_oauth_grants;
drop trigger if exists update_xero_connections_public_updated_at
  on public.xero_connections_public;
drop trigger if exists trg_set_updated_at_xero_raw
  on public.xero_raw;
drop trigger if exists trg_set_updated_at_xero_oauth_grants
  on public.xero_oauth_grants;
drop trigger if exists trg_set_updated_at_xero_connections_public
  on public.xero_connections_public;

create trigger update_subscriptions_updated_at
before update on public.subscriptions
for each row execute function public.set_updated_at();

create trigger update_user_privacy_preferences_updated_at
before update on public.user_privacy_preferences
for each row execute function public.set_updated_at();

create trigger update_privacy_requests_updated_at
before update on public.privacy_requests
for each row execute function public.set_updated_at();

create trigger update_xero_raw_updated_at
before update on public.xero_raw
for each row execute function public.set_updated_at();

create trigger update_canonical_customers_updated_at
before update on public.canonical_customers
for each row execute function public.set_updated_at();

create trigger update_canonical_invoices_updated_at
before update on public.canonical_invoices
for each row execute function public.set_updated_at();

create trigger update_canonical_payments_updated_at
before update on public.canonical_payments
for each row execute function public.set_updated_at();

create trigger update_xero_oauth_grants_updated_at
before update on public.xero_oauth_grants
for each row execute function public.set_updated_at();

create trigger update_xero_connections_public_updated_at
before update on public.xero_connections_public
for each row execute function public.set_updated_at();

-- Test's legacy timestamp helpers are obsolete after the trigger replacement.
drop function if exists public.set_updated_at_xero_connections();
drop function if exists public.set_updated_at_xero_connections_public();
drop function if exists public.set_updated_at_xero_oauth_grants();
drop function if exists public.set_updated_at_xero_raw();
drop function if exists public.update_updated_at_column();

-- Replace the seven internal Xero functions with their exact hardened canonical
-- definitions. Signatures and behaviour are unchanged; search paths and name
-- qualification now match the baseline.
create or replace function public.acquire_xero_grant_refresh_lock(
  p_grant_id uuid,
  p_lock_id uuid,
  p_ttl_seconds integer default 45
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  ttl_seconds integer := greatest(coalesce(p_ttl_seconds, 45), 5);
begin
  update public.xero_oauth_grants as oauth_grant
  set refresh_lock_id = p_lock_id,
      refresh_lock_acquired_at = now(),
      refresh_lock_expires_at = now() + make_interval(secs => ttl_seconds)
  where oauth_grant.id = p_grant_id
    and (
      oauth_grant.refresh_lock_id is null
      or oauth_grant.refresh_lock_expires_at is null
      or oauth_grant.refresh_lock_expires_at < now()
      or oauth_grant.refresh_lock_id = p_lock_id
    );

  return found;
end;
$$;

create or replace function public.release_xero_grant_refresh_lock(
  p_grant_id uuid,
  p_lock_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  update public.xero_oauth_grants as oauth_grant
  set refresh_lock_id = null,
      refresh_lock_acquired_at = null,
      refresh_lock_expires_at = null
  where oauth_grant.id = p_grant_id
    and oauth_grant.refresh_lock_id = p_lock_id;

  return found;
end;
$$;

create or replace function public.acquire_xero_tenant_auto_sync_lock(
  p_user_id uuid,
  p_tenant_id text,
  p_lock_id uuid,
  p_ttl_seconds integer default 180
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  ttl_seconds integer := greatest(coalesce(p_ttl_seconds, 180), 30);
begin
  update public.xero_connections_public as connection
  set auto_sync_lock_id = p_lock_id,
      auto_sync_lock_acquired_at = now(),
      auto_sync_lock_expires_at = now() + make_interval(secs => ttl_seconds),
      last_auto_sync_triggered_at = now()
  where connection.user_id = p_user_id
    and connection.tenant_id = p_tenant_id
    and connection.auth_state = 'active'
    and (
      connection.auto_sync_lock_id is null
      or connection.auto_sync_lock_expires_at is null
      or connection.auto_sync_lock_expires_at < now()
      or connection.auto_sync_lock_id = p_lock_id
    );

  return found;
end;
$$;

create or replace function public.release_xero_tenant_auto_sync_lock(
  p_user_id uuid,
  p_tenant_id text,
  p_lock_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  update public.xero_connections_public as connection
  set auto_sync_lock_id = null,
      auto_sync_lock_acquired_at = null,
      auto_sync_lock_expires_at = null
  where connection.user_id = p_user_id
    and connection.tenant_id = p_tenant_id
    and connection.auto_sync_lock_id = p_lock_id;

  return found;
end;
$$;

create or replace function public.acquire_xero_scheduled_sync_run_lock(
  p_job_key text,
  p_lock_id uuid,
  p_ttl_seconds integer default 900,
  p_min_interval_minutes integer default 120
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  normalized_job_key text := coalesce(nullif(trim(p_job_key), ''), 'xero_scheduled_sync');
  ttl_seconds integer := greatest(coalesce(p_ttl_seconds, 900), 60);
  min_interval_minutes integer := greatest(coalesce(p_min_interval_minutes, 120), 1);
begin
  insert into public.xero_scheduled_sync_runs (job_key)
  values (normalized_job_key)
  on conflict (job_key) do nothing;

  update public.xero_scheduled_sync_runs as sync_run
  set run_lock_id = p_lock_id,
      run_lock_acquired_at = now(),
      run_lock_expires_at = now() + make_interval(secs => ttl_seconds),
      last_started_at = now(),
      updated_at = now()
  where sync_run.job_key = normalized_job_key
    and (
      sync_run.run_lock_id is null
      or sync_run.run_lock_expires_at is null
      or sync_run.run_lock_expires_at < now()
      or sync_run.run_lock_id = p_lock_id
    )
    and (
      sync_run.last_started_at is null
      or sync_run.last_started_at <= now() - make_interval(mins => min_interval_minutes)
    );

  return found;
end;
$$;

create or replace function public.release_xero_scheduled_sync_run_lock(
  p_job_key text,
  p_lock_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  normalized_job_key text := coalesce(nullif(trim(p_job_key), ''), 'xero_scheduled_sync');
begin
  update public.xero_scheduled_sync_runs as sync_run
  set run_lock_id = null,
      run_lock_acquired_at = null,
      run_lock_expires_at = null,
      last_finished_at = now(),
      updated_at = now()
  where sync_run.job_key = normalized_job_key
    and sync_run.run_lock_id = p_lock_id;

  return found;
end;
$$;

create or replace function public.list_xero_scheduled_sync_candidates(
  p_activity_window_hours integer default 168,
  p_limit integer default 25,
  p_stale_minutes integer default 60
)
returns table (
  user_id uuid,
  tenant_id text,
  last_sign_in_at timestamptz,
  connection_updated_at timestamptz,
  last_synced_at timestamptz
)
language sql
security definer
set search_path = pg_catalog, public
as $$
  with candidate_connections as (
    select
      connection.user_id,
      connection.tenant_id,
      auth_user.last_sign_in_at,
      connection.updated_at as connection_updated_at,
      latest_raw.last_synced_at
    from public.xero_connections_public as connection
    inner join auth.users as auth_user on auth_user.id = connection.user_id
    left join lateral (
      select max(raw.fetched_at) as last_synced_at
      from public.xero_raw as raw
      where raw.user_id = connection.user_id
        and raw.tenant_id = connection.tenant_id
    ) as latest_raw on true
    where connection.auth_state = 'active'
      and connection.grant_id is not null
      and auth_user.last_sign_in_at is not null
      and auth_user.last_sign_in_at >= now() - make_interval(
        hours => greatest(coalesce(p_activity_window_hours, 168), 1)
      )
      and (
        latest_raw.last_synced_at is null
        or latest_raw.last_synced_at <= now() - make_interval(
          mins => greatest(coalesce(p_stale_minutes, 60), 1)
        )
      )
  )
  select
    candidate.user_id,
    candidate.tenant_id,
    candidate.last_sign_in_at,
    candidate.connection_updated_at,
    candidate.last_synced_at
  from candidate_connections as candidate
  order by candidate.last_sign_in_at desc, candidate.connection_updated_at desc
  limit greatest(coalesce(p_limit, 25), 1);
$$;

-- Both tables are server-only in the canonical access model. Enabling RLS is
-- idempotent and closes the confirmed gap on xero_scheduled_sync_runs.
alter table public.billing_usage_days enable row level security;
alter table public.xero_scheduled_sync_runs enable row level security;

-- Remove only the obsolete browser-facing policies proven to exist on Test.
drop policy if exists "Users can read own billing usage days"
  on public.billing_usage_days;
drop policy if exists "Users can read own privacy exports"
  on public.privacy_exports;
drop policy if exists "Users can read own privacy request events"
  on public.privacy_request_events;
drop policy if exists "Users can create own privacy requests"
  on public.privacy_requests;
drop policy if exists "Users can read own privacy requests"
  on public.privacy_requests;
drop policy if exists "Server insert only"
  on public.support_tickets;
drop policy if exists "Users can read own support tickets"
  on public.support_tickets;
drop policy if exists "Users can manage own privacy preferences"
  on public.user_privacy_preferences;

-- Replace the retained ownership policies with their exact canonical command,
-- role, USING, and WITH CHECK definitions.
drop policy if exists "Users can view own subscription"
  on public.subscriptions;
drop policy if exists "Users can view own notes"
  on public.notes;
drop policy if exists "Users can insert own notes"
  on public.notes;
drop policy if exists "Users can update own notes"
  on public.notes;
drop policy if exists "Users can delete own notes"
  on public.notes;
drop policy if exists "Users can read own xero connection public"
  on public.xero_connections_public;
drop policy if exists "Users can read own xero raw"
  on public.xero_raw;
drop policy if exists "Users can read own canonical customers"
  on public.canonical_customers;
drop policy if exists "Users can read own canonical invoices"
  on public.canonical_invoices;
drop policy if exists "Users can read own canonical payments"
  on public.canonical_payments;
drop policy if exists "Users can read own customer overrides"
  on public.customer_overrides;
drop policy if exists "Users can insert own customer overrides"
  on public.customer_overrides;
drop policy if exists "Users can update own customer overrides"
  on public.customer_overrides;
drop policy if exists "Users can delete own customer overrides"
  on public.customer_overrides;
drop policy if exists "Users can read own collection actions"
  on public.collection_actions;
drop policy if exists "Users can insert own collection actions"
  on public.collection_actions;
drop policy if exists "Users can delete own collection actions"
  on public.collection_actions;

create policy "Users can view own subscription"
on public.subscriptions
for select
to authenticated
using (auth.uid() = user_id);

create policy "Users can view own notes"
on public.notes
for select
to authenticated
using (auth.uid() = user_id);

create policy "Users can insert own notes"
on public.notes
for insert
to authenticated
with check (auth.uid() = user_id);

create policy "Users can update own notes"
on public.notes
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "Users can delete own notes"
on public.notes
for delete
to authenticated
using (auth.uid() = user_id);

create policy "Users can read own xero connection public"
on public.xero_connections_public
for select
to authenticated
using (auth.uid() = user_id);

create policy "Users can read own xero raw"
on public.xero_raw
for select
to authenticated
using (auth.uid() = user_id);

create policy "Users can read own canonical customers"
on public.canonical_customers
for select
to authenticated
using (auth.uid() = user_id);

create policy "Users can read own canonical invoices"
on public.canonical_invoices
for select
to authenticated
using (auth.uid() = user_id);

create policy "Users can read own canonical payments"
on public.canonical_payments
for select
to authenticated
using (auth.uid() = user_id);

create policy "Users can read own customer overrides"
on public.customer_overrides
for select
to authenticated
using (auth.uid() = user_id);

create policy "Users can insert own customer overrides"
on public.customer_overrides
for insert
to authenticated
with check (auth.uid() = user_id);

create policy "Users can update own customer overrides"
on public.customer_overrides
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "Users can delete own customer overrides"
on public.customer_overrides
for delete
to authenticated
using (auth.uid() = user_id);

create policy "Users can read own collection actions"
on public.collection_actions
for select
to authenticated
using (auth.uid() = user_id);

create policy "Users can insert own collection actions"
on public.collection_actions
for insert
to authenticated
with check (auth.uid() = user_id);

create policy "Users can delete own collection actions"
on public.collection_actions
for delete
to authenticated
using (auth.uid() = user_id);

-- Normalize all baseline-managed tables to the canonical explicit-access model.
revoke all on table
  public.subscriptions,
  public.stripe_customers,
  public.notes,
  public.support_tickets,
  public.user_privacy_preferences,
  public.privacy_requests,
  public.privacy_request_events,
  public.privacy_exports,
  public.xero_raw,
  public.canonical_customers,
  public.canonical_invoices,
  public.canonical_payments,
  public.customer_overrides,
  public.xero_oauth_grants,
  public.xero_connections_public,
  public.xero_scheduled_sync_runs,
  public.collection_actions,
  public.billing_usage_days
from anon, authenticated, service_role;

grant select, insert, update, delete on table
  public.subscriptions,
  public.stripe_customers,
  public.notes,
  public.support_tickets,
  public.user_privacy_preferences,
  public.privacy_requests,
  public.privacy_request_events,
  public.privacy_exports,
  public.xero_raw,
  public.canonical_customers,
  public.canonical_invoices,
  public.canonical_payments,
  public.customer_overrides,
  public.xero_oauth_grants,
  public.xero_connections_public,
  public.xero_scheduled_sync_runs,
  public.collection_actions,
  public.billing_usage_days
to service_role;

grant select on table public.subscriptions to authenticated;
grant select, insert, update, delete on table public.notes to authenticated;
grant select on table
  public.xero_connections_public,
  public.xero_raw,
  public.canonical_customers,
  public.canonical_invoices,
  public.canonical_payments
to authenticated;
grant select, insert, update, delete on table public.customer_overrides to authenticated;
grant select, insert, delete on table public.collection_actions to authenticated;

-- Internal functions are executable only where the canonical baseline allows.
revoke all on function public.set_updated_at()
  from public, anon, authenticated, service_role;

revoke all on function public.acquire_xero_grant_refresh_lock(uuid, uuid, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.acquire_xero_grant_refresh_lock(uuid, uuid, integer)
  to service_role;

revoke all on function public.release_xero_grant_refresh_lock(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.release_xero_grant_refresh_lock(uuid, uuid)
  to service_role;

revoke all on function public.acquire_xero_tenant_auto_sync_lock(uuid, text, uuid, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.acquire_xero_tenant_auto_sync_lock(uuid, text, uuid, integer)
  to service_role;

revoke all on function public.release_xero_tenant_auto_sync_lock(uuid, text, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.release_xero_tenant_auto_sync_lock(uuid, text, uuid)
  to service_role;

revoke all on function public.acquire_xero_scheduled_sync_run_lock(text, uuid, integer, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.acquire_xero_scheduled_sync_run_lock(text, uuid, integer, integer)
  to service_role;

revoke all on function public.release_xero_scheduled_sync_run_lock(text, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.release_xero_scheduled_sync_run_lock(text, uuid)
  to service_role;

revoke all on function public.list_xero_scheduled_sync_candidates(integer, integer, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.list_xero_scheduled_sync_candidates(integer, integer, integer)
  to service_role;

-- Both local and Test migration-owned objects are created by postgres. Make the
-- explicit-grant model forward-looking so future migration objects do not inherit
-- broad browser or service-role privileges from platform bootstrap defaults.
alter default privileges for role postgres in schema public
  revoke all on tables from public, anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  revoke all on sequences from public, anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  revoke all on functions from public, anon, authenticated, service_role;
