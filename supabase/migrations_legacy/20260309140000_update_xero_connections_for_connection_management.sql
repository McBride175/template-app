-- Extend existing Xero connection table for first-pass connection management.
alter table if exists public.xero_connections
  add column if not exists tenant_name text,
  add column if not exists xero_user_id text,
  add column if not exists scopes text[];

-- Match the desired connection credential shape.
alter table if exists public.xero_connections
  alter column tenant_id set not null,
  alter column refresh_token set not null,
  alter column access_token drop not null,
  alter column expires_at drop not null,
  alter column created_at set default now(),
  alter column updated_at set default now();

alter table if exists public.xero_connections enable row level security;

-- Keep read access user-scoped; writes are handled in server routes.
do $$
begin
  if to_regclass('public.xero_connections') is not null then
    drop policy if exists "Users can read own xero connection" on public.xero_connections;
    create policy "Users can read own xero connection"
    on public.xero_connections
    for select
    using (auth.uid() = user_id);

    drop policy if exists "Users can insert own xero connection" on public.xero_connections;
    drop policy if exists "Users can update own xero connection" on public.xero_connections;
    drop policy if exists "Users can delete own xero connection" on public.xero_connections;
  end if;
end
$$;
