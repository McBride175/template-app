-- Store one Xero connection per authenticated user.
create table if not exists public.xero_connections (
  user_id uuid primary key references auth.users(id) on delete cascade,
  access_token text not null,
  refresh_token text not null,
  expires_at timestamptz not null,
  tenant_id text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.xero_connections enable row level security;

create or replace function public.set_updated_at_xero_connections()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_set_updated_at_xero_connections on public.xero_connections;
create trigger trg_set_updated_at_xero_connections
before update on public.xero_connections
for each row
execute function public.set_updated_at_xero_connections();

drop policy if exists "Users can read own xero connection" on public.xero_connections;
create policy "Users can read own xero connection"
on public.xero_connections
for select
using (auth.uid() = user_id);

drop policy if exists "Users can insert own xero connection" on public.xero_connections;
create policy "Users can insert own xero connection"
on public.xero_connections
for insert
with check (auth.uid() = user_id);

drop policy if exists "Users can update own xero connection" on public.xero_connections;
create policy "Users can update own xero connection"
on public.xero_connections
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can delete own xero connection" on public.xero_connections;
create policy "Users can delete own xero connection"
on public.xero_connections
for delete
using (auth.uid() = user_id);
