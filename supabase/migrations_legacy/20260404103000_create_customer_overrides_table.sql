create table if not exists public.customer_overrides (
  user_id uuid not null references auth.users(id) on delete cascade,
  tenant_id text not null,
  customer_source_id text not null,
  override_level text not null check (override_level in ('safe', 'normal', 'priority', 'do_not_chase')),
  updated_at timestamptz not null default now(),
  primary key (user_id, tenant_id, customer_source_id)
);

alter table public.customer_overrides enable row level security;

drop policy if exists "Users can read own customer overrides" on public.customer_overrides;
create policy "Users can read own customer overrides"
on public.customer_overrides
for select
using (auth.uid() = user_id);

drop policy if exists "Users can insert own customer overrides" on public.customer_overrides;
create policy "Users can insert own customer overrides"
on public.customer_overrides
for insert
with check (auth.uid() = user_id);

drop policy if exists "Users can update own customer overrides" on public.customer_overrides;
create policy "Users can update own customer overrides"
on public.customer_overrides
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can delete own customer overrides" on public.customer_overrides;
create policy "Users can delete own customer overrides"
on public.customer_overrides
for delete
using (auth.uid() = user_id);
