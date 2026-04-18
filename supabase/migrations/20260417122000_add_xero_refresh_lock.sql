alter table if exists public.xero_connection_secrets
  add column if not exists refresh_lock_id uuid,
  add column if not exists refresh_lock_acquired_at timestamptz,
  add column if not exists refresh_lock_expires_at timestamptz;

create index if not exists idx_xero_connection_secrets_refresh_lock_expires_at
  on public.xero_connection_secrets (refresh_lock_expires_at);

create or replace function public.acquire_xero_refresh_lock(
  p_user_id uuid,
  p_tenant_id text,
  p_lock_id uuid,
  p_ttl_seconds integer default 45
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  ttl_seconds integer := greatest(coalesce(p_ttl_seconds, 45), 5);
begin
  update public.xero_connection_secrets
  set
    refresh_lock_id = p_lock_id,
    refresh_lock_acquired_at = now(),
    refresh_lock_expires_at = now() + make_interval(secs => ttl_seconds)
  where user_id = p_user_id
    and tenant_id = p_tenant_id
    and (
      refresh_lock_id is null
      or refresh_lock_expires_at is null
      or refresh_lock_expires_at < now()
      or refresh_lock_id = p_lock_id
    );

  return found;
end;
$$;

create or replace function public.release_xero_refresh_lock(
  p_user_id uuid,
  p_tenant_id text,
  p_lock_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.xero_connection_secrets
  set
    refresh_lock_id = null,
    refresh_lock_acquired_at = null,
    refresh_lock_expires_at = null
  where user_id = p_user_id
    and tenant_id = p_tenant_id
    and refresh_lock_id = p_lock_id;

  return found;
end;
$$;

revoke all on function public.acquire_xero_refresh_lock(uuid, text, uuid, integer)
  from public, anon, authenticated;
grant execute on function public.acquire_xero_refresh_lock(uuid, text, uuid, integer)
  to service_role;

revoke all on function public.release_xero_refresh_lock(uuid, text, uuid)
  from public, anon, authenticated;
grant execute on function public.release_xero_refresh_lock(uuid, text, uuid)
  to service_role;
