create extension if not exists pgcrypto;

create table if not exists public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  email text not null,
  subject text not null,
  message text not null,
  status text not null default 'open',
  created_at timestamptz not null default now()
);

create index if not exists support_tickets_user_id_idx
  on public.support_tickets (user_id);

create index if not exists support_tickets_created_at_idx
  on public.support_tickets (created_at desc);

alter table public.support_tickets enable row level security;

drop policy if exists "Users can read own support tickets" on public.support_tickets;
create policy "Users can read own support tickets"
  on public.support_tickets
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Server insert only" on public.support_tickets;
create policy "Server insert only"
  on public.support_tickets
  for insert
  to authenticated, anon
  with check (false);
