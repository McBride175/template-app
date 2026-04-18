create extension if not exists pgcrypto;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'privacy_request_type') THEN
    CREATE TYPE public.privacy_request_type AS ENUM (
      'ACCESS_EXPORT',
      'RECTIFICATION',
      'RESTRICTION',
      'OBJECTION',
      'ERASURE'
    );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'privacy_request_status') THEN
    CREATE TYPE public.privacy_request_status AS ENUM (
      'RECEIVED',
      'VERIFYING',
      'IN_PROGRESS',
      'FULFILLED',
      'DENIED'
    );
  END IF;
END
$$;

create table if not exists public.user_privacy_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  processing_restricted boolean not null default false,
  marketing_opt_out boolean not null default true,
  analytics_opt_out boolean not null default false,
  ai_processing_opt_out boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.privacy_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  type public.privacy_request_type not null,
  status public.privacy_request_status not null default 'RECEIVED',
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  due_at timestamptz not null default (now() + interval '30 days'),
  fulfilled_at timestamptz,
  denial_reason text
);

create table if not exists public.privacy_request_events (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.privacy_requests(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  actor_role text not null,
  action text not null,
  note text,
  created_at timestamptz not null default now()
);

create table if not exists public.privacy_exports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  request_id uuid references public.privacy_requests(id) on delete set null,
  path text not null,
  export_json jsonb not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '7 days'),
  downloaded_at timestamptz
);

create index if not exists idx_privacy_requests_user_id_created_at
  on public.privacy_requests (user_id, created_at desc);

create index if not exists idx_privacy_requests_status_due_at
  on public.privacy_requests (status, due_at asc);

create index if not exists idx_privacy_request_events_request_id_created_at
  on public.privacy_request_events (request_id, created_at asc);

create index if not exists idx_privacy_exports_user_id_created_at
  on public.privacy_exports (user_id, created_at desc);

create index if not exists idx_privacy_exports_expires_at
  on public.privacy_exports (expires_at asc);

create trigger update_user_privacy_preferences_updated_at
before update on public.user_privacy_preferences
for each row
execute function public.update_updated_at_column();

create trigger update_privacy_requests_updated_at
before update on public.privacy_requests
for each row
execute function public.update_updated_at_column();

alter table public.user_privacy_preferences enable row level security;
alter table public.privacy_requests enable row level security;
alter table public.privacy_request_events enable row level security;
alter table public.privacy_exports enable row level security;

drop policy if exists "Users can manage own privacy preferences" on public.user_privacy_preferences;
create policy "Users can manage own privacy preferences"
  on public.user_privacy_preferences
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can create own privacy requests" on public.privacy_requests;
create policy "Users can create own privacy requests"
  on public.privacy_requests
  for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Users can read own privacy requests" on public.privacy_requests;
create policy "Users can read own privacy requests"
  on public.privacy_requests
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Users can read own privacy request events" on public.privacy_request_events;
create policy "Users can read own privacy request events"
  on public.privacy_request_events
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.privacy_requests pr
      where pr.id = request_id
        and pr.user_id = auth.uid()
    )
  );

drop policy if exists "Users can read own privacy exports" on public.privacy_exports;
create policy "Users can read own privacy exports"
  on public.privacy_exports
  for select
  to authenticated
  using (auth.uid() = user_id);
