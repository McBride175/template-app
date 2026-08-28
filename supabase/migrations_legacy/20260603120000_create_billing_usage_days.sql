create extension if not exists pgcrypto;

create table if not exists public.billing_usage_days (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null,
  usage_date date not null,
  user_id uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint billing_usage_days_tenant_usage_date_key unique (tenant_id, usage_date)
);

create index if not exists idx_billing_usage_days_tenant_id
  on public.billing_usage_days (tenant_id);

create index if not exists idx_billing_usage_days_user_id
  on public.billing_usage_days (user_id);

alter table public.billing_usage_days enable row level security;

drop policy if exists "Users can read own billing usage days" on public.billing_usage_days;
create policy "Users can read own billing usage days"
on public.billing_usage_days
for select
using (auth.uid() = user_id);
