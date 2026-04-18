create extension if not exists pgcrypto;

create table if not exists public.canonical_customers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  tenant_id text not null,
  source_system text not null default 'xero',
  source_id text not null,
  name text not null,
  email text,
  is_customer boolean,
  is_supplier boolean,
  status text,
  raw_updated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, tenant_id, source_system, source_id)
);

create table if not exists public.canonical_invoices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  tenant_id text not null,
  source_system text not null default 'xero',
  source_id text not null,
  customer_source_id text,
  invoice_number text,
  reference text,
  status text,
  issue_date date,
  due_date date,
  fully_paid_date date,
  currency_code text,
  total numeric,
  amount_due numeric,
  amount_paid numeric,
  amount_credited numeric,
  sent_to_contact boolean,
  raw_updated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, tenant_id, source_system, source_id)
);

create table if not exists public.canonical_payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  tenant_id text not null,
  source_system text not null default 'xero',
  source_id text not null,
  invoice_source_id text,
  customer_source_id text,
  amount numeric,
  payment_date date,
  currency_rate numeric,
  reference text,
  raw_updated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, tenant_id, source_system, source_id)
);

create index if not exists idx_canonical_customers_user_tenant
  on public.canonical_customers (user_id, tenant_id);

create index if not exists idx_canonical_invoices_user_tenant
  on public.canonical_invoices (user_id, tenant_id);

create index if not exists idx_canonical_payments_user_tenant
  on public.canonical_payments (user_id, tenant_id);

alter table public.canonical_customers enable row level security;
alter table public.canonical_invoices enable row level security;
alter table public.canonical_payments enable row level security;

drop trigger if exists update_canonical_customers_updated_at on public.canonical_customers;
create trigger update_canonical_customers_updated_at
before update on public.canonical_customers
for each row
execute function public.update_updated_at_column();

drop trigger if exists update_canonical_invoices_updated_at on public.canonical_invoices;
create trigger update_canonical_invoices_updated_at
before update on public.canonical_invoices
for each row
execute function public.update_updated_at_column();

drop trigger if exists update_canonical_payments_updated_at on public.canonical_payments;
create trigger update_canonical_payments_updated_at
before update on public.canonical_payments
for each row
execute function public.update_updated_at_column();

drop policy if exists "Users can read own canonical customers" on public.canonical_customers;
create policy "Users can read own canonical customers"
on public.canonical_customers
for select
using (auth.uid() = user_id);

drop policy if exists "Users can read own canonical invoices" on public.canonical_invoices;
create policy "Users can read own canonical invoices"
on public.canonical_invoices
for select
using (auth.uid() = user_id);

drop policy if exists "Users can read own canonical payments" on public.canonical_payments;
create policy "Users can read own canonical payments"
on public.canonical_payments
for select
using (auth.uid() = user_id);
