create extension if not exists pgcrypto;

create table if not exists public.xero_connections_public (
  user_id uuid primary key references auth.users(id) on delete cascade,
  tenant_id text not null,
  tenant_name text,
  auth_state text not null default 'active',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint xero_connections_public_auth_state_check
    check (auth_state in ('active', 'reauth_required', 'disconnected'))
);

create unique index if not exists idx_xero_connections_public_user_tenant
  on public.xero_connections_public (user_id, tenant_id);

create table if not exists public.xero_connection_secrets (
  user_id uuid not null references auth.users(id) on delete cascade,
  tenant_id text not null,
  access_token_encrypted text not null,
  refresh_token_encrypted text not null,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, tenant_id)
);

create index if not exists idx_xero_connection_secrets_user
  on public.xero_connection_secrets (user_id);

create or replace function public.set_updated_at_xero_connections_public()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_set_updated_at_xero_connections_public on public.xero_connections_public;
create trigger trg_set_updated_at_xero_connections_public
before update on public.xero_connections_public
for each row
execute function public.set_updated_at_xero_connections_public();

create or replace function public.set_updated_at_xero_connection_secrets()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_set_updated_at_xero_connection_secrets on public.xero_connection_secrets;
create trigger trg_set_updated_at_xero_connection_secrets
before update on public.xero_connection_secrets
for each row
execute function public.set_updated_at_xero_connection_secrets();

alter table public.xero_connections_public enable row level security;
alter table public.xero_connection_secrets enable row level security;

drop policy if exists "Users can read own xero connection public" on public.xero_connections_public;
create policy "Users can read own xero connection public"
on public.xero_connections_public
for select
using (auth.uid() = user_id);

do $$
begin
  if to_regclass('public.xero_connections') is not null then
    insert into public.xero_connections_public (
      user_id,
      tenant_id,
      tenant_name,
      auth_state,
      metadata,
      created_at,
      updated_at
    )
    select
      c.user_id,
      c.tenant_id,
      c.tenant_name,
      'reauth_required',
      jsonb_strip_nulls(
        jsonb_build_object(
          'migration_reason', 'tokens_not_migrated_without_encryption_key',
          'xero_user_id', c.xero_user_id,
          'scopes', c.scopes
        )
      ),
      c.created_at,
      c.updated_at
    from public.xero_connections c
    on conflict (user_id) do update
    set
      tenant_id = excluded.tenant_id,
      tenant_name = excluded.tenant_name,
      auth_state = excluded.auth_state,
      metadata = excluded.metadata,
      updated_at = now();
  end if;
end
$$;

revoke all on table public.xero_connections_public from anon, authenticated;
grant select on table public.xero_connections_public to authenticated;
grant select, insert, update, delete on table public.xero_connections_public to service_role;

revoke all on table public.xero_connection_secrets from anon, authenticated;
grant select, insert, update, delete on table public.xero_connection_secrets to service_role;

do $$
begin
  if to_regclass('public.xero_connections') is not null then
    drop table public.xero_connections;
  end if;
end
$$;
