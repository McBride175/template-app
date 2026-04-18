alter table if exists public.xero_connections_public
  add column if not exists auto_sync_lock_id uuid,
  add column if not exists auto_sync_lock_acquired_at timestamptz,
  add column if not exists auto_sync_lock_expires_at timestamptz,
  add column if not exists last_auto_sync_triggered_at timestamptz;

create index if not exists idx_xero_connections_public_auto_sync_lock_expires_at
  on public.xero_connections_public (auto_sync_lock_expires_at);

create or replace function public.acquire_xero_tenant_auto_sync_lock(
  p_user_id uuid,
  p_tenant_id text,
  p_lock_id uuid,
  p_ttl_seconds integer default 180
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  ttl_seconds integer := greatest(coalesce(p_ttl_seconds, 180), 30);
begin
  update public.xero_connections_public
  set
    auto_sync_lock_id = p_lock_id,
    auto_sync_lock_acquired_at = now(),
    auto_sync_lock_expires_at = now() + make_interval(secs => ttl_seconds),
    last_auto_sync_triggered_at = now()
  where user_id = p_user_id
    and tenant_id = p_tenant_id
    and auth_state = 'active'
    and (
      auto_sync_lock_id is null
      or auto_sync_lock_expires_at is null
      or auto_sync_lock_expires_at < now()
      or auto_sync_lock_id = p_lock_id
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
set search_path = public
as $$
begin
  update public.xero_connections_public
  set
    auto_sync_lock_id = null,
    auto_sync_lock_acquired_at = null,
    auto_sync_lock_expires_at = null
  where user_id = p_user_id
    and tenant_id = p_tenant_id
    and auto_sync_lock_id = p_lock_id;

  return found;
end;
$$;

revoke all on function public.acquire_xero_tenant_auto_sync_lock(uuid, text, uuid, integer)
  from public, anon, authenticated;
grant execute on function public.acquire_xero_tenant_auto_sync_lock(uuid, text, uuid, integer)
  to service_role;

revoke all on function public.release_xero_tenant_auto_sync_lock(uuid, text, uuid)
  from public, anon, authenticated;
grant execute on function public.release_xero_tenant_auto_sync_lock(uuid, text, uuid)
  to service_role;
