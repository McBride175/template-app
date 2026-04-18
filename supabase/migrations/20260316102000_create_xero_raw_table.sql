create extension if not exists pgcrypto;

create table if not exists public.xero_raw (
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

create index if not exists idx_xero_raw_user_resource
  on public.xero_raw (user_id, resource_type);

create index if not exists idx_xero_raw_tenant_resource
  on public.xero_raw (tenant_id, resource_type);

alter table public.xero_raw enable row level security;

create or replace function public.set_updated_at_xero_raw()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_set_updated_at_xero_raw on public.xero_raw;
create trigger trg_set_updated_at_xero_raw
before update on public.xero_raw
for each row
execute function public.set_updated_at_xero_raw();

drop policy if exists "Users can read own xero raw" on public.xero_raw;
create policy "Users can read own xero raw"
on public.xero_raw
for select
using (auth.uid() = user_id);
