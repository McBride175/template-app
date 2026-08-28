create extension if not exists pgcrypto;

create table if not exists public.xero_oauth_grants (
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

create unique index if not exists idx_xero_oauth_grants_user_xero_user
  on public.xero_oauth_grants (user_id, xero_user_id);

create index if not exists idx_xero_oauth_grants_user
  on public.xero_oauth_grants (user_id);

create index if not exists idx_xero_oauth_grants_refresh_lock_expires_at
  on public.xero_oauth_grants (refresh_lock_expires_at);

create or replace function public.set_updated_at_xero_oauth_grants()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_set_updated_at_xero_oauth_grants on public.xero_oauth_grants;
create trigger trg_set_updated_at_xero_oauth_grants
before update on public.xero_oauth_grants
for each row
execute function public.set_updated_at_xero_oauth_grants();

alter table public.xero_oauth_grants enable row level security;

revoke all on table public.xero_oauth_grants from anon, authenticated;
grant select, insert, update, delete on table public.xero_oauth_grants to service_role;

alter table if exists public.xero_connections_public
  add column if not exists grant_id uuid;

do $$
begin
  if to_regclass('public.xero_connections_public') is not null
    and not exists (
      select 1
      from pg_constraint
      where conname = 'xero_connections_public_grant_id_fkey'
    ) then
    alter table public.xero_connections_public
      add constraint xero_connections_public_grant_id_fkey
      foreign key (grant_id) references public.xero_oauth_grants(id) on delete set null;
  end if;
end
$$;

create index if not exists idx_xero_connections_public_grant_id
  on public.xero_connections_public (grant_id);

do $$
begin
  if to_regclass('public.xero_connection_secrets') is not null then
    with legacy_secret_candidates as (
      select
        s.user_id,
        coalesce(nullif(p.metadata ->> 'xero_user_id', ''), '') as xero_user_id,
        coalesce(
          (
            select array_agg(scope_value)
            from jsonb_array_elements_text(
              case
                when jsonb_typeof(p.metadata -> 'scopes') = 'array' then p.metadata -> 'scopes'
                else '[]'::jsonb
              end
            ) as scope_value
          ),
          '{}'::text[]
        ) as scopes,
        s.access_token_encrypted,
        s.refresh_token_encrypted,
        s.expires_at,
        s.created_at,
        s.updated_at,
        row_number() over (
          partition by s.user_id, coalesce(nullif(p.metadata ->> 'xero_user_id', ''), '')
          order by s.updated_at desc, s.created_at desc
        ) as row_num
      from public.xero_connection_secrets s
      left join public.xero_connections_public p
        on p.user_id = s.user_id
       and p.tenant_id = s.tenant_id
    )
    insert into public.xero_oauth_grants (
      user_id,
      xero_user_id,
      scopes,
      access_token_encrypted,
      refresh_token_encrypted,
      expires_at,
      created_at,
      updated_at
    )
    select
      user_id,
      xero_user_id,
      scopes,
      access_token_encrypted,
      refresh_token_encrypted,
      expires_at,
      created_at,
      updated_at
    from legacy_secret_candidates
    where row_num = 1
    on conflict (user_id, xero_user_id) do update
    set
      scopes = excluded.scopes,
      access_token_encrypted = excluded.access_token_encrypted,
      refresh_token_encrypted = excluded.refresh_token_encrypted,
      expires_at = excluded.expires_at,
      updated_at = excluded.updated_at;
  end if;
end
$$;

update public.xero_connections_public connection
set grant_id = oauth_grant.id
from public.xero_oauth_grants oauth_grant
where connection.user_id = oauth_grant.user_id
  and coalesce(nullif(connection.metadata ->> 'xero_user_id', ''), '') = oauth_grant.xero_user_id
  and connection.grant_id is null;

with fallback_grants as (
  select distinct on (user_id)
    user_id,
    id
  from public.xero_oauth_grants
  order by user_id, updated_at desc, created_at desc
)
update public.xero_connections_public connection
set grant_id = fallback.id
from fallback_grants fallback
where connection.user_id = fallback.user_id
  and connection.grant_id is null;

create or replace function public.acquire_xero_grant_refresh_lock(
  p_grant_id uuid,
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
  update public.xero_oauth_grants
  set
    refresh_lock_id = p_lock_id,
    refresh_lock_acquired_at = now(),
    refresh_lock_expires_at = now() + make_interval(secs => ttl_seconds)
  where id = p_grant_id
    and (
      refresh_lock_id is null
      or refresh_lock_expires_at is null
      or refresh_lock_expires_at < now()
      or refresh_lock_id = p_lock_id
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
set search_path = public
as $$
begin
  update public.xero_oauth_grants
  set
    refresh_lock_id = null,
    refresh_lock_acquired_at = null,
    refresh_lock_expires_at = null
  where id = p_grant_id
    and refresh_lock_id = p_lock_id;

  return found;
end;
$$;

revoke all on function public.acquire_xero_grant_refresh_lock(uuid, uuid, integer)
  from public, anon, authenticated;
grant execute on function public.acquire_xero_grant_refresh_lock(uuid, uuid, integer)
  to service_role;

revoke all on function public.release_xero_grant_refresh_lock(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.release_xero_grant_refresh_lock(uuid, uuid)
  to service_role;

drop function if exists public.acquire_xero_refresh_lock(uuid, text, uuid, integer);
drop function if exists public.release_xero_refresh_lock(uuid, text, uuid);

drop table if exists public.xero_connection_secrets;
drop function if exists public.set_updated_at_xero_connection_secrets();
