create extension if not exists pgcrypto;

create table if not exists public.collection_actions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  tenant_id text not null,
  customer_source_id text not null,
  action_type text not null check (action_type in ('called', 'emailed', 'postponed')),
  outcome text null check (outcome in ('no_response', 'spoke_to_customer', 'promised_to_pay', 'disputed')),
  next_action_date date null,
  action_timestamp timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists idx_collection_actions_user_tenant
  on public.collection_actions (user_id, tenant_id);

create index if not exists idx_collection_actions_customer_source_id
  on public.collection_actions (customer_source_id);

alter table public.collection_actions enable row level security;

drop policy if exists "Users can read own collection actions" on public.collection_actions;
create policy "Users can read own collection actions"
on public.collection_actions
for select
using (auth.uid() = user_id);

drop policy if exists "Users can insert own collection actions" on public.collection_actions;
create policy "Users can insert own collection actions"
on public.collection_actions
for insert
with check (auth.uid() = user_id);

drop policy if exists "Users can delete own collection actions" on public.collection_actions;
create policy "Users can delete own collection actions"
on public.collection_actions
for delete
using (auth.uid() = user_id);
