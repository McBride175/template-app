drop function if exists public.list_xero_scheduled_sync_candidates(integer, integer);

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
set search_path = public, auth
as $$
  with candidate_connections as (
    select
      connection.user_id,
      connection.tenant_id,
      auth_user.last_sign_in_at,
      connection.updated_at as connection_updated_at,
      latest_raw.last_synced_at
    from public.xero_connections_public connection
    inner join auth.users auth_user on auth_user.id = connection.user_id
    left join lateral (
      select max(raw.fetched_at) as last_synced_at
      from public.xero_raw raw
      where raw.user_id = connection.user_id
        and raw.tenant_id = connection.tenant_id
    ) latest_raw on true
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
  from candidate_connections candidate
  order by candidate.last_sign_in_at desc, candidate.connection_updated_at desc
  limit greatest(coalesce(p_limit, 25), 1);
$$;

revoke all on function public.list_xero_scheduled_sync_candidates(integer, integer, integer)
  from public, anon, authenticated;
grant execute on function public.list_xero_scheduled_sync_candidates(integer, integer, integer)
  to service_role;
