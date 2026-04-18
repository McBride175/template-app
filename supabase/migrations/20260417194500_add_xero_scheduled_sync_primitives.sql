create table if not exists public.xero_scheduled_sync_runs (
  job_key text primary key,
  last_started_at timestamptz,
  last_finished_at timestamptz,
  run_lock_id uuid,
  run_lock_acquired_at timestamptz,
  run_lock_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.acquire_xero_scheduled_sync_run_lock(
  p_job_key text,
  p_lock_id uuid,
  p_ttl_seconds integer default 900,
  p_min_interval_minutes integer default 120
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  job_key text := coalesce(nullif(trim(p_job_key), ''), 'xero_scheduled_sync');
  ttl_seconds integer := greatest(coalesce(p_ttl_seconds, 900), 60);
  min_interval_minutes integer := greatest(coalesce(p_min_interval_minutes, 120), 1);
begin
  insert into public.xero_scheduled_sync_runs (job_key)
  values (job_key)
  on conflict (job_key) do nothing;

  update public.xero_scheduled_sync_runs
  set
    run_lock_id = p_lock_id,
    run_lock_acquired_at = now(),
    run_lock_expires_at = now() + make_interval(secs => ttl_seconds),
    last_started_at = now(),
    updated_at = now()
  where xero_scheduled_sync_runs.job_key = job_key
    and (
      run_lock_id is null
      or run_lock_expires_at is null
      or run_lock_expires_at < now()
      or run_lock_id = p_lock_id
    )
    and (
      last_started_at is null
      or last_started_at <= now() - make_interval(mins => min_interval_minutes)
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
set search_path = public
as $$
declare
  job_key text := coalesce(nullif(trim(p_job_key), ''), 'xero_scheduled_sync');
begin
  update public.xero_scheduled_sync_runs
  set
    run_lock_id = null,
    run_lock_acquired_at = null,
    run_lock_expires_at = null,
    last_finished_at = now(),
    updated_at = now()
  where xero_scheduled_sync_runs.job_key = job_key
    and run_lock_id = p_lock_id;

  return found;
end;
$$;

create or replace function public.list_xero_scheduled_sync_candidates(
  p_activity_window_hours integer default 168,
  p_limit integer default 25
)
returns table (
  user_id uuid,
  tenant_id text,
  last_sign_in_at timestamptz,
  connection_updated_at timestamptz
)
language sql
security definer
set search_path = public, auth
as $$
  select
    connection.user_id,
    connection.tenant_id,
    auth_user.last_sign_in_at,
    connection.updated_at as connection_updated_at
  from public.xero_connections_public connection
  inner join auth.users auth_user on auth_user.id = connection.user_id
  where connection.auth_state = 'active'
    and connection.grant_id is not null
    and auth_user.last_sign_in_at is not null
    and auth_user.last_sign_in_at >= now() - make_interval(hours => greatest(coalesce(p_activity_window_hours, 168), 1))
  order by auth_user.last_sign_in_at desc, connection.updated_at desc
  limit greatest(coalesce(p_limit, 25), 1);
$$;

revoke all on function public.acquire_xero_scheduled_sync_run_lock(text, uuid, integer, integer)
  from public, anon, authenticated;
grant execute on function public.acquire_xero_scheduled_sync_run_lock(text, uuid, integer, integer)
  to service_role;

revoke all on function public.release_xero_scheduled_sync_run_lock(text, uuid)
  from public, anon, authenticated;
grant execute on function public.release_xero_scheduled_sync_run_lock(text, uuid)
  to service_role;

revoke all on function public.list_xero_scheduled_sync_candidates(integer, integer)
  from public, anon, authenticated;
grant execute on function public.list_xero_scheduled_sync_candidates(integer, integer)
  to service_role;
