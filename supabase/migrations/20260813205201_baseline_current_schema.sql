-- Canonical application schema baseline.
--
-- This migration intentionally describes the final application schema only.
-- Historical and transitional migrations live in supabase/migrations_legacy and
-- must not be replayed as part of the active migration chain.

create extension if not exists pgcrypto;

create type public.privacy_request_type as enum (
  'ACCESS_EXPORT',
  'RECTIFICATION',
  'RESTRICTION',
  'OBJECTION',
  'ERASURE'
);

create type public.privacy_request_status as enum (
  'RECEIVED',
  'VERIFYING',
  'IN_PROGRESS',
  'FULFILLED',
  'DENIED'
);

-- One hardened timestamp trigger function replaces the historical collection of
-- table-specific trigger functions. It does not need SECURITY DEFINER privileges.
create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Core -----------------------------------------------------------------------

create table public.subscriptions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  stripe_customer_id text not null unique,
  stripe_subscription_id text not null unique,
  stripe_price_id text,
  status text not null,
  current_period_end timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index idx_subscriptions_stripe_customer_id
  on public.subscriptions (stripe_customer_id);
create index idx_subscriptions_stripe_subscription_id
  on public.subscriptions (stripe_subscription_id);
create index idx_subscriptions_stripe_price_id
  on public.subscriptions (stripe_price_id);
create index idx_subscriptions_status
  on public.subscriptions (status);

create trigger update_subscriptions_updated_at
before update on public.subscriptions
for each row execute function public.set_updated_at();

create table public.stripe_customers (
  stripe_customer_id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz default now()
);

create index idx_stripe_customers_user_id
  on public.stripe_customers (user_id);

create table public.notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  content text not null,
  created_at timestamptz default now()
);

create index idx_notes_user_id on public.notes (user_id);

-- Support and privacy ---------------------------------------------------------

create table public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  email text not null,
  subject text not null,
  message text not null,
  status text not null default 'open',
  created_at timestamptz not null default now()
);

create index support_tickets_user_id_idx
  on public.support_tickets (user_id);
create index support_tickets_created_at_idx
  on public.support_tickets (created_at desc);

create table public.user_privacy_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  processing_restricted boolean not null default false,
  marketing_opt_out boolean not null default true,
  analytics_opt_out boolean not null default false,
  ai_processing_opt_out boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger update_user_privacy_preferences_updated_at
before update on public.user_privacy_preferences
for each row execute function public.set_updated_at();

create table public.privacy_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  type public.privacy_request_type not null,
  status public.privacy_request_status not null default 'RECEIVED',
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  due_at timestamptz not null default (now() + interval '30 days'),
  fulfilled_at timestamptz,
  denial_reason text
);

create index idx_privacy_requests_user_id_created_at
  on public.privacy_requests (user_id, created_at desc);
create index idx_privacy_requests_status_due_at
  on public.privacy_requests (status, due_at asc);

create trigger update_privacy_requests_updated_at
before update on public.privacy_requests
for each row execute function public.set_updated_at();

create table public.privacy_request_events (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.privacy_requests(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  actor_role text not null,
  action text not null,
  note text,
  created_at timestamptz not null default now()
);

create index idx_privacy_request_events_request_id_created_at
  on public.privacy_request_events (request_id, created_at asc);

create table public.privacy_exports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  request_id uuid references public.privacy_requests(id) on delete set null,
  path text not null,
  export_json jsonb not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '7 days'),
  downloaded_at timestamptz
);

create index idx_privacy_exports_user_id_created_at
  on public.privacy_exports (user_id, created_at desc);
create index idx_privacy_exports_expires_at
  on public.privacy_exports (expires_at asc);

-- Xero final-state storage ----------------------------------------------------

create table public.xero_raw (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  tenant_id text not null,
  resource_type text not null,
  source_id text not null,
  raw_json jsonb not null,
  fetched_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, tenant_id, resource_type, source_id)
);

create index idx_xero_raw_user_resource
  on public.xero_raw (user_id, resource_type);
create index idx_xero_raw_tenant_resource
  on public.xero_raw (tenant_id, resource_type);

create trigger update_xero_raw_updated_at
before update on public.xero_raw
for each row execute function public.set_updated_at();

create table public.canonical_customers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  tenant_id text not null,
  source_system text not null default 'xero',
  source_id text not null,
  name text not null,
  email text,
  is_customer boolean,
  is_supplier boolean,
  status text,
  raw_updated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, tenant_id, source_system, source_id)
);

create index idx_canonical_customers_user_tenant
  on public.canonical_customers (user_id, tenant_id);

create trigger update_canonical_customers_updated_at
before update on public.canonical_customers
for each row execute function public.set_updated_at();

create table public.canonical_invoices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  tenant_id text not null,
  source_system text not null default 'xero',
  source_id text not null,
  customer_source_id text,
  invoice_number text,
  reference text,
  status text,
  issue_date date,
  due_date date,
  fully_paid_date date,
  currency_code text,
  total numeric,
  amount_due numeric,
  amount_paid numeric,
  amount_credited numeric,
  sent_to_contact boolean,
  raw_updated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  type text,
  unique (user_id, tenant_id, source_system, source_id)
);

create index idx_canonical_invoices_user_tenant
  on public.canonical_invoices (user_id, tenant_id);

create trigger update_canonical_invoices_updated_at
before update on public.canonical_invoices
for each row execute function public.set_updated_at();

create table public.canonical_payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  tenant_id text not null,
  source_system text not null default 'xero',
  source_id text not null,
  invoice_source_id text,
  customer_source_id text,
  amount numeric,
  payment_date date,
  currency_rate numeric,
  reference text,
  raw_updated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, tenant_id, source_system, source_id)
);

create index idx_canonical_payments_user_tenant
  on public.canonical_payments (user_id, tenant_id);

create trigger update_canonical_payments_updated_at
before update on public.canonical_payments
for each row execute function public.set_updated_at();

create table public.customer_overrides (
  user_id uuid not null references auth.users(id) on delete cascade,
  tenant_id text not null,
  customer_source_id text not null,
  override_level text not null
    check (override_level in ('safe', 'normal', 'priority', 'do_not_chase')),
  updated_at timestamptz not null default now(),
  primary key (user_id, tenant_id, customer_source_id)
);

create table public.xero_oauth_grants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  xero_user_id text not null default '',
  scopes text[] not null default '{}'::text[],
  access_token_encrypted text,
  refresh_token_encrypted text not null,
  expires_at timestamptz,
  refresh_lock_id uuid,
  refresh_lock_acquired_at timestamptz,
  refresh_lock_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index idx_xero_oauth_grants_user_xero_user
  on public.xero_oauth_grants (user_id, xero_user_id);
create index idx_xero_oauth_grants_user
  on public.xero_oauth_grants (user_id);
create index idx_xero_oauth_grants_refresh_lock_expires_at
  on public.xero_oauth_grants (refresh_lock_expires_at);

create trigger update_xero_oauth_grants_updated_at
before update on public.xero_oauth_grants
for each row execute function public.set_updated_at();

create table public.xero_connections_public (
  user_id uuid not null references auth.users(id) on delete cascade,
  tenant_id text not null,
  tenant_name text,
  auth_state text not null default 'active'
    check (auth_state in ('active', 'reauth_required', 'disconnected', 'error')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_refresh_error text,
  reauth_required_at timestamptz,
  grant_id uuid references public.xero_oauth_grants(id) on delete set null,
  auto_sync_lock_id uuid,
  auto_sync_lock_acquired_at timestamptz,
  auto_sync_lock_expires_at timestamptz,
  last_auto_sync_triggered_at timestamptz,
  primary key (user_id, tenant_id)
);

create index idx_xero_connections_public_user
  on public.xero_connections_public (user_id);
create index idx_xero_connections_public_grant_id
  on public.xero_connections_public (grant_id);
create index idx_xero_connections_public_auto_sync_lock_expires_at
  on public.xero_connections_public (auto_sync_lock_expires_at);

create trigger update_xero_connections_public_updated_at
before update on public.xero_connections_public
for each row execute function public.set_updated_at();

create table public.xero_scheduled_sync_runs (
  job_key text primary key,
  last_started_at timestamptz,
  last_finished_at timestamptz,
  run_lock_id uuid,
  run_lock_acquired_at timestamptz,
  run_lock_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Collections and billing ----------------------------------------------------

create table public.collection_actions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  tenant_id text not null,
  customer_source_id text not null,
  action_type text not null
    check (action_type in ('called', 'emailed', 'postponed')),
  outcome text
    check (outcome in ('no_response', 'spoke_to_customer', 'promised_to_pay', 'disputed')),
  next_action_date date,
  action_timestamp timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index idx_collection_actions_user_tenant
  on public.collection_actions (user_id, tenant_id);
create index idx_collection_actions_customer_source_id
  on public.collection_actions (customer_source_id);

create table public.billing_usage_days (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null,
  usage_date date not null,
  user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint billing_usage_days_tenant_usage_date_key
    unique (tenant_id, usage_date)
);

-- The unique constraint above supports tenant/day counts. This additional index
-- supports FK maintenance and privacy/account operations by user.
create index idx_billing_usage_days_user_id
  on public.billing_usage_days (user_id);

-- Xero internal functions ----------------------------------------------------

create function public.acquire_xero_grant_refresh_lock(
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

create function public.release_xero_grant_refresh_lock(
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

create function public.acquire_xero_tenant_auto_sync_lock(
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

create function public.release_xero_tenant_auto_sync_lock(
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

create function public.acquire_xero_scheduled_sync_run_lock(
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

create function public.release_xero_scheduled_sync_run_lock(
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

create function public.list_xero_scheduled_sync_candidates(
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

-- RLS and explicit grants ----------------------------------------------------

alter table public.subscriptions enable row level security;
alter table public.stripe_customers enable row level security;
alter table public.notes enable row level security;
alter table public.support_tickets enable row level security;
alter table public.user_privacy_preferences enable row level security;
alter table public.privacy_requests enable row level security;
alter table public.privacy_request_events enable row level security;
alter table public.privacy_exports enable row level security;
alter table public.xero_raw enable row level security;
alter table public.canonical_customers enable row level security;
alter table public.canonical_invoices enable row level security;
alter table public.canonical_payments enable row level security;
alter table public.customer_overrides enable row level security;
alter table public.xero_oauth_grants enable row level security;
alter table public.xero_connections_public enable row level security;
alter table public.xero_scheduled_sync_runs enable row level security;
alter table public.collection_actions enable row level security;
alter table public.billing_usage_days enable row level security;

-- Clear Supabase's broad default table privileges, including service_role's
-- default ALL grant, then add only the access the application currently uses.
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

-- Internal functions are not callable by browser roles. The scheduler and token
-- workflows use the service-role client exclusively.
revoke all on function public.set_updated_at()
  from public, anon, authenticated;

revoke all on function public.acquire_xero_grant_refresh_lock(uuid, uuid, integer)
  from public, anon, authenticated;
grant execute on function public.acquire_xero_grant_refresh_lock(uuid, uuid, integer)
  to service_role;

revoke all on function public.release_xero_grant_refresh_lock(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.release_xero_grant_refresh_lock(uuid, uuid)
  to service_role;

revoke all on function public.acquire_xero_tenant_auto_sync_lock(uuid, text, uuid, integer)
  from public, anon, authenticated;
grant execute on function public.acquire_xero_tenant_auto_sync_lock(uuid, text, uuid, integer)
  to service_role;

revoke all on function public.release_xero_tenant_auto_sync_lock(uuid, text, uuid)
  from public, anon, authenticated;
grant execute on function public.release_xero_tenant_auto_sync_lock(uuid, text, uuid)
  to service_role;

revoke all on function public.acquire_xero_scheduled_sync_run_lock(text, uuid, integer, integer)
  from public, anon, authenticated;
grant execute on function public.acquire_xero_scheduled_sync_run_lock(text, uuid, integer, integer)
  to service_role;

revoke all on function public.release_xero_scheduled_sync_run_lock(text, uuid)
  from public, anon, authenticated;
grant execute on function public.release_xero_scheduled_sync_run_lock(text, uuid)
  to service_role;

revoke all on function public.list_xero_scheduled_sync_candidates(integer, integer, integer)
  from public, anon, authenticated;
grant execute on function public.list_xero_scheduled_sync_candidates(integer, integer, integer)
  to service_role;
