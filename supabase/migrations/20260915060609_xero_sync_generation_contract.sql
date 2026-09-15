-- Phase 2 Xero ingestion safety boundary.
--
-- This migration is deliberately additive. Existing sync writers and readers keep
-- using their legacy (sync_run_id IS NULL) rows and existing conflict targets.
-- The new service-only run infrastructure is not called by live application code.

-- Keep fencing and active/latest pointers out of the browser-readable connection
-- row. This one-to-one internal extension is the sole authoritative coordination
-- row for a user/Xero-tenant pair.
create table public.xero_sync_tenant_state (
  user_id uuid not null,
  tenant_id text not null,
  current_fencing_token bigint not null default 0,
  active_sync_run_id uuid,
  latest_sync_run_id uuid,
  last_successful_sync_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint xero_sync_tenant_state_pkey primary key (user_id, tenant_id),
  constraint xero_sync_tenant_state_connection_fkey
    foreign key (user_id, tenant_id)
    references public.xero_connections_public (user_id, tenant_id)
    on delete cascade,
  constraint xero_sync_tenant_state_fencing_token_check
    check (current_fencing_token >= 0),
  constraint xero_sync_tenant_state_success_pointer_check
    check (
      (active_sync_run_id is null and last_successful_sync_at is null)
      or (active_sync_run_id is not null and last_successful_sync_at is not null)
    ),
  constraint xero_sync_tenant_state_latest_fence_check
    check (latest_sync_run_id is not null or current_fencing_token = 0)
);

create trigger update_xero_sync_tenant_state_updated_at
before update on public.xero_sync_tenant_state
for each row execute function public.set_updated_at();

create table public.xero_sync_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  tenant_id text not null,
  fencing_token bigint not null,
  status text not null,
  scope_version text not null,
  required_steps text[] not null,
  previous_active_sync_run_id uuid,
  lease_owner uuid,
  lease_expires_at timestamptz,
  heartbeat_at timestamptz,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  failed_at timestamptz,
  abandoned_at timestamptz,
  error_code text,
  error_resource text,
  snapshot_as_of timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint xero_sync_runs_tenant_state_fkey
    foreign key (user_id, tenant_id)
    references public.xero_sync_tenant_state (user_id, tenant_id)
    on delete cascade,
  constraint xero_sync_runs_id_tenant_key
    unique (id, user_id, tenant_id),
  constraint xero_sync_runs_tenant_fence_key
    unique (user_id, tenant_id, fencing_token),
  constraint xero_sync_runs_fencing_token_check
    check (fencing_token > 0),
  constraint xero_sync_runs_status_check
    check (status in ('running', 'succeeded', 'failed', 'abandoned')),
  constraint xero_sync_runs_scope_contract_check
    check (
      scope_version = 'collections_v1'
      and required_steps = array[
        'organisation',
        'contacts',
        'authorised_accrec_invoices',
        'paid_accrec_invoices',
        'authorised_accrec_payments',
        'canonical_mapping',
        'validation'
      ]::text[]
    ),
  constraint xero_sync_runs_error_code_check
    check (error_code is null or error_code ~ '^[a-z0-9][a-z0-9_.:-]{0,127}$'),
  constraint xero_sync_runs_error_resource_check
    check (
      error_resource is null
      or error_resource ~ '^[a-z0-9][a-z0-9_.:-]{0,127}$'
    ),
  constraint xero_sync_runs_status_shape_check
    check (
      (
        status = 'running'
        and lease_owner is not null
        and lease_expires_at is not null
        and heartbeat_at is not null
        and completed_at is null
        and failed_at is null
        and abandoned_at is null
        and error_code is null
        and error_resource is null
      )
      or (
        status = 'succeeded'
        and lease_owner is null
        and lease_expires_at is null
        and completed_at is not null
        and failed_at is null
        and abandoned_at is null
        and error_code is null
        and error_resource is null
      )
      or (
        status = 'failed'
        and lease_owner is null
        and lease_expires_at is null
        and completed_at is null
        and failed_at is not null
        and abandoned_at is null
        and error_code is not null
      )
      or (
        status = 'abandoned'
        and lease_owner is null
        and lease_expires_at is null
        and completed_at is null
        and failed_at is null
        and abandoned_at is not null
        and error_code is not null
      )
    )
);

create trigger update_xero_sync_runs_updated_at
before update on public.xero_sync_runs
for each row execute function public.set_updated_at();

create table public.xero_sync_run_steps (
  sync_run_id uuid not null
    references public.xero_sync_runs (id) on delete cascade,
  step_key text not null,
  status text not null default 'pending',
  record_count bigint,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint xero_sync_run_steps_pkey primary key (sync_run_id, step_key),
  constraint xero_sync_run_steps_key_check
    check (
      step_key in (
        'organisation',
        'contacts',
        'authorised_accrec_invoices',
        'paid_accrec_invoices',
        'authorised_accrec_payments',
        'canonical_mapping',
        'validation'
      )
    ),
  constraint xero_sync_run_steps_status_check
    check (status in ('pending', 'succeeded')),
  constraint xero_sync_run_steps_count_check
    check (record_count is null or record_count >= 0),
  constraint xero_sync_run_steps_status_shape_check
    check (
      (status = 'pending' and record_count is null and completed_at is null)
      or (status = 'succeeded' and record_count is not null and completed_at is not null)
    )
);

create index idx_xero_sync_runs_tenant_status_started
  on public.xero_sync_runs (user_id, tenant_id, status, started_at desc);
create index idx_xero_sync_runs_running_lease_expiry
  on public.xero_sync_runs (lease_expires_at)
  where status = 'running';
create index idx_xero_sync_runs_previous_active
  on public.xero_sync_runs (previous_active_sync_run_id)
  where previous_active_sync_run_id is not null;

-- Existing live rows remain NULL and continue to use their current uniqueness
-- constraints. Composite ownership FKs prevent future generation rows from being
-- attached to another user's or tenant's run.
alter table public.xero_raw
  add column sync_run_id uuid;
alter table public.canonical_organisations
  add column sync_run_id uuid;
alter table public.canonical_customers
  add column sync_run_id uuid;
alter table public.canonical_invoices
  add column sync_run_id uuid;
alter table public.canonical_payments
  add column sync_run_id uuid;

alter table public.xero_raw
  add constraint xero_raw_sync_run_fkey
  foreign key (sync_run_id, user_id, tenant_id)
  references public.xero_sync_runs (id, user_id, tenant_id)
  on delete cascade
  not valid;
alter table public.canonical_organisations
  add constraint canonical_organisations_sync_run_fkey
  foreign key (sync_run_id, user_id, tenant_id)
  references public.xero_sync_runs (id, user_id, tenant_id)
  on delete cascade
  not valid;
alter table public.canonical_customers
  add constraint canonical_customers_sync_run_fkey
  foreign key (sync_run_id, user_id, tenant_id)
  references public.xero_sync_runs (id, user_id, tenant_id)
  on delete cascade
  not valid;
alter table public.canonical_invoices
  add constraint canonical_invoices_sync_run_fkey
  foreign key (sync_run_id, user_id, tenant_id)
  references public.xero_sync_runs (id, user_id, tenant_id)
  on delete cascade
  not valid;
alter table public.canonical_payments
  add constraint canonical_payments_sync_run_fkey
  foreign key (sync_run_id, user_id, tenant_id)
  references public.xero_sync_runs (id, user_id, tenant_id)
  on delete cascade
  not valid;

alter table public.xero_raw validate constraint xero_raw_sync_run_fkey;
alter table public.canonical_organisations
  validate constraint canonical_organisations_sync_run_fkey;
alter table public.canonical_customers
  validate constraint canonical_customers_sync_run_fkey;
alter table public.canonical_invoices
  validate constraint canonical_invoices_sync_run_fkey;
alter table public.canonical_payments
  validate constraint canonical_payments_sync_run_fkey;

-- These indexes are already the intended per-generation uniqueness contracts.
-- The older global constraints remain in place until live upserts are migrated in
-- the same deployment that removes those stricter legacy conflict targets.
create unique index idx_xero_raw_generation_source
  on public.xero_raw (
    sync_run_id,
    user_id,
    tenant_id,
    resource_type,
    source_id
  )
  where sync_run_id is not null;
create unique index idx_canonical_organisations_generation_source
  on public.canonical_organisations (
    sync_run_id,
    user_id,
    tenant_id,
    source_system,
    source_organisation_id
  )
  where sync_run_id is not null;
create unique index idx_canonical_customers_generation_source
  on public.canonical_customers (
    sync_run_id,
    user_id,
    tenant_id,
    source_system,
    source_id
  )
  where sync_run_id is not null;
create unique index idx_canonical_invoices_generation_source
  on public.canonical_invoices (
    sync_run_id,
    user_id,
    tenant_id,
    source_system,
    source_id
  )
  where sync_run_id is not null;
create unique index idx_canonical_payments_generation_source
  on public.canonical_payments (
    sync_run_id,
    user_id,
    tenant_id,
    source_system,
    source_id
  )
  where sync_run_id is not null;

-- Final-state runs are immutable. A running run can only renew its existing lease
-- or move once to a terminal state.
create function public.enforce_xero_sync_run_transition()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if new.id <> old.id
     or new.user_id <> old.user_id
     or new.tenant_id <> old.tenant_id
     or new.fencing_token <> old.fencing_token
     or new.scope_version <> old.scope_version
     or new.required_steps <> old.required_steps
     or new.previous_active_sync_run_id is distinct from old.previous_active_sync_run_id
     or new.started_at <> old.started_at
     or new.created_at <> old.created_at then
    raise exception 'Xero sync run identity is immutable';
  end if;

  if old.status <> 'running' then
    raise exception 'Terminal Xero sync runs are immutable';
  end if;

  if new.status = 'running' then
    if new.lease_owner <> old.lease_owner then
      raise exception 'Xero sync run lease owner is immutable';
    end if;
  end if;

  return new;
end;
$$;

create trigger enforce_xero_sync_run_transition
before update on public.xero_sync_runs
for each row execute function public.enforce_xero_sync_run_transition();

-- Pointer validation is a trigger rather than a circular FK: runs already cascade
-- from this tenant-state row, and a reverse FK would make disconnect/user cleanup
-- unnecessarily fragile. Only the fenced RPCs can mutate this service-only table.
create function public.validate_xero_sync_tenant_state_pointers()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if new.latest_sync_run_id is not null and not exists (
    select 1
    from public.xero_sync_runs as sync_run
    where sync_run.id = new.latest_sync_run_id
      and sync_run.user_id = new.user_id
      and sync_run.tenant_id = new.tenant_id
      and sync_run.fencing_token = new.current_fencing_token
  ) then
    raise exception 'Latest Xero sync run pointer is invalid';
  end if;

  if new.active_sync_run_id is not null and not exists (
    select 1
    from public.xero_sync_runs as sync_run
    where sync_run.id = new.active_sync_run_id
      and sync_run.user_id = new.user_id
      and sync_run.tenant_id = new.tenant_id
      and sync_run.status = 'succeeded'
  ) then
    raise exception 'Active Xero sync run pointer is invalid';
  end if;

  return new;
end;
$$;

create constraint trigger validate_xero_sync_tenant_state_pointers
after insert or update on public.xero_sync_tenant_state
deferrable initially deferred
for each row execute function public.validate_xero_sync_tenant_state_pointers();

create function public.acquire_xero_sync_run(
  p_user_id uuid,
  p_tenant_id text,
  p_lease_owner uuid,
  p_scope_version text default 'collections_v1',
  p_ttl_seconds integer default 300
)
returns table (
  acquired boolean,
  result_code text,
  sync_run_id uuid,
  fencing_token bigint,
  lease_expires_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_tenant_id text := nullif(btrim(p_tenant_id), '');
  v_now timestamptz := now();
  v_ttl_seconds integer := least(greatest(coalesce(p_ttl_seconds, 300), 30), 900);
  v_connection public.xero_connections_public%rowtype;
  v_state public.xero_sync_tenant_state%rowtype;
  v_current_run public.xero_sync_runs%rowtype;
  v_run_id uuid;
  v_fencing_token bigint;
  v_lease_expires_at timestamptz;
  v_required_steps text[] := array[
    'organisation',
    'contacts',
    'authorised_accrec_invoices',
    'paid_accrec_invoices',
    'authorised_accrec_payments',
    'canonical_mapping',
    'validation'
  ]::text[];
begin
  if p_user_id is null or v_tenant_id is null or p_lease_owner is null then
    raise exception 'Xero sync acquisition input is incomplete';
  end if;
  if p_scope_version <> 'collections_v1' then
    raise exception 'Unsupported Xero sync scope version';
  end if;

  select connection.*
  into v_connection
  from public.xero_connections_public as connection
  where connection.user_id = p_user_id
    and connection.tenant_id = v_tenant_id
  for update;

  if not found
     or v_connection.auth_state <> 'active'
     or v_connection.grant_id is null then
    return query select false, 'connection_not_available'::text, null::uuid,
      null::bigint, null::timestamptz;
    return;
  end if;

  insert into public.xero_sync_tenant_state (user_id, tenant_id)
  values (p_user_id, v_tenant_id)
  on conflict (user_id, tenant_id) do nothing;

  select tenant_state.*
  into v_state
  from public.xero_sync_tenant_state as tenant_state
  where tenant_state.user_id = p_user_id
    and tenant_state.tenant_id = v_tenant_id
  for update;

  if v_state.latest_sync_run_id is not null then
    select sync_run.*
    into v_current_run
    from public.xero_sync_runs as sync_run
    where sync_run.id = v_state.latest_sync_run_id
    for update;

    if not found then
      raise exception 'Xero sync tenant state is inconsistent';
    end if;

    if v_current_run.status = 'running'
       and v_current_run.lease_expires_at > v_now then
      if v_current_run.lease_owner = p_lease_owner
         and v_current_run.scope_version = p_scope_version then
        v_lease_expires_at := v_now + make_interval(secs => v_ttl_seconds);
        update public.xero_sync_runs as sync_run
        set heartbeat_at = v_now,
            lease_expires_at = v_lease_expires_at
        where sync_run.id = v_current_run.id;

        return query select true, 'already_owned'::text, v_current_run.id,
          v_current_run.fencing_token, v_lease_expires_at;
        return;
      end if;

      return query select false, 'lease_held'::text, null::uuid,
        null::bigint, v_current_run.lease_expires_at;
      return;
    end if;

    if v_current_run.status = 'running' then
      update public.xero_sync_runs as sync_run
      set status = 'abandoned',
          abandoned_at = v_now,
          error_code = 'lease_expired',
          error_resource = null,
          lease_owner = null,
          lease_expires_at = null
      where sync_run.id = v_current_run.id;
    end if;
  end if;

  if v_state.current_fencing_token = 9223372036854775807 then
    raise exception 'Xero sync fencing token exhausted';
  end if;

  v_fencing_token := v_state.current_fencing_token + 1;
  v_run_id := gen_random_uuid();
  v_lease_expires_at := v_now + make_interval(secs => v_ttl_seconds);

  insert into public.xero_sync_runs (
    id,
    user_id,
    tenant_id,
    fencing_token,
    status,
    scope_version,
    required_steps,
    previous_active_sync_run_id,
    lease_owner,
    lease_expires_at,
    heartbeat_at,
    started_at
  )
  values (
    v_run_id,
    p_user_id,
    v_tenant_id,
    v_fencing_token,
    'running',
    p_scope_version,
    v_required_steps,
    v_state.active_sync_run_id,
    p_lease_owner,
    v_lease_expires_at,
    v_now,
    v_now
  );

  insert into public.xero_sync_run_steps (sync_run_id, step_key)
  select v_run_id, required_step
  from unnest(v_required_steps) as required_step;

  update public.xero_sync_tenant_state as tenant_state
  set current_fencing_token = v_fencing_token,
      latest_sync_run_id = v_run_id
  where tenant_state.user_id = p_user_id
    and tenant_state.tenant_id = v_tenant_id;

  return query select true, 'acquired'::text, v_run_id, v_fencing_token,
    v_lease_expires_at;
end;
$$;

create function public.heartbeat_xero_sync_run(
  p_sync_run_id uuid,
  p_lease_owner uuid,
  p_fencing_token bigint,
  p_ttl_seconds integer default 300
)
returns table (
  renewed boolean,
  result_code text,
  lease_expires_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_now timestamptz := now();
  v_ttl_seconds integer := least(greatest(coalesce(p_ttl_seconds, 300), 30), 900);
  v_user_id uuid;
  v_tenant_id text;
  v_state public.xero_sync_tenant_state%rowtype;
  v_run public.xero_sync_runs%rowtype;
  v_lease_expires_at timestamptz;
begin
  if p_sync_run_id is null or p_lease_owner is null or p_fencing_token is null then
    raise exception 'Xero sync heartbeat input is incomplete';
  end if;

  select sync_run.user_id, sync_run.tenant_id
  into v_user_id, v_tenant_id
  from public.xero_sync_runs as sync_run
  where sync_run.id = p_sync_run_id;

  if not found then
    return query select false, 'run_not_found'::text, null::timestamptz;
    return;
  end if;

  select tenant_state.*
  into v_state
  from public.xero_sync_tenant_state as tenant_state
  where tenant_state.user_id = v_user_id
    and tenant_state.tenant_id = v_tenant_id
  for update;

  select sync_run.*
  into v_run
  from public.xero_sync_runs as sync_run
  where sync_run.id = p_sync_run_id
  for update;

  if v_state.latest_sync_run_id is distinct from p_sync_run_id
     or v_state.current_fencing_token <> p_fencing_token
     or v_run.fencing_token <> p_fencing_token then
    return query select false, 'superseded'::text, null::timestamptz;
    return;
  end if;
  if v_run.status <> 'running' then
    return query select false, 'run_not_running'::text, null::timestamptz;
    return;
  end if;
  if v_run.lease_owner <> p_lease_owner then
    return query select false, 'wrong_lease_owner'::text, null::timestamptz;
    return;
  end if;
  if v_run.lease_expires_at <= v_now then
    return query select false, 'lease_expired'::text, null::timestamptz;
    return;
  end if;

  v_lease_expires_at := v_now + make_interval(secs => v_ttl_seconds);
  update public.xero_sync_runs as sync_run
  set heartbeat_at = v_now,
      lease_expires_at = v_lease_expires_at
  where sync_run.id = p_sync_run_id;

  return query select true, 'renewed'::text, v_lease_expires_at;
end;
$$;

create function public.complete_xero_sync_run_step(
  p_sync_run_id uuid,
  p_lease_owner uuid,
  p_fencing_token bigint,
  p_step_key text,
  p_record_count bigint
)
returns table (
  completed boolean,
  result_code text
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_now timestamptz := now();
  v_user_id uuid;
  v_tenant_id text;
  v_state public.xero_sync_tenant_state%rowtype;
  v_run public.xero_sync_runs%rowtype;
  v_step public.xero_sync_run_steps%rowtype;
begin
  if p_sync_run_id is null
     or p_lease_owner is null
     or p_fencing_token is null
     or nullif(btrim(p_step_key), '') is null
     or p_record_count is null
     or p_record_count < 0 then
    raise exception 'Xero sync step completion input is invalid';
  end if;

  select sync_run.user_id, sync_run.tenant_id
  into v_user_id, v_tenant_id
  from public.xero_sync_runs as sync_run
  where sync_run.id = p_sync_run_id;

  if not found then
    return query select false, 'run_not_found'::text;
    return;
  end if;

  select tenant_state.*
  into v_state
  from public.xero_sync_tenant_state as tenant_state
  where tenant_state.user_id = v_user_id
    and tenant_state.tenant_id = v_tenant_id
  for update;

  select sync_run.*
  into v_run
  from public.xero_sync_runs as sync_run
  where sync_run.id = p_sync_run_id
  for update;

  if v_state.latest_sync_run_id is distinct from p_sync_run_id
     or v_state.current_fencing_token <> p_fencing_token
     or v_run.fencing_token <> p_fencing_token then
    return query select false, 'superseded'::text;
    return;
  end if;
  if v_run.status <> 'running' then
    return query select false, 'run_not_running'::text;
    return;
  end if;
  if v_run.lease_owner <> p_lease_owner then
    return query select false, 'wrong_lease_owner'::text;
    return;
  end if;
  if v_run.lease_expires_at <= v_now then
    return query select false, 'lease_expired'::text;
    return;
  end if;

  select step.*
  into v_step
  from public.xero_sync_run_steps as step
  where step.sync_run_id = p_sync_run_id
    and step.step_key = btrim(p_step_key)
  for update;

  if not found then
    return query select false, 'unknown_step'::text;
    return;
  end if;

  if v_step.status = 'succeeded' then
    if v_step.record_count = p_record_count then
      return query select true, 'already_completed'::text;
    else
      return query select false, 'record_count_conflict'::text;
    end if;
    return;
  end if;

  update public.xero_sync_run_steps as step
  set status = 'succeeded',
      record_count = p_record_count,
      completed_at = v_now
  where step.sync_run_id = p_sync_run_id
    and step.step_key = btrim(p_step_key);

  return query select true, 'completed'::text;
end;
$$;

create function public.fail_xero_sync_run(
  p_sync_run_id uuid,
  p_lease_owner uuid,
  p_fencing_token bigint,
  p_error_code text,
  p_error_resource text default null
)
returns table (
  failed boolean,
  result_code text
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_now timestamptz := now();
  v_error_code text := nullif(btrim(p_error_code), '');
  v_error_resource text := nullif(btrim(p_error_resource), '');
  v_user_id uuid;
  v_tenant_id text;
  v_state public.xero_sync_tenant_state%rowtype;
  v_run public.xero_sync_runs%rowtype;
begin
  if p_sync_run_id is null
     or p_lease_owner is null
     or p_fencing_token is null
     or v_error_code is null
     or v_error_code !~ '^[a-z0-9][a-z0-9_.:-]{0,127}$'
     or (
       v_error_resource is not null
       and v_error_resource !~ '^[a-z0-9][a-z0-9_.:-]{0,127}$'
     ) then
    raise exception 'Xero sync failure input is invalid';
  end if;

  select sync_run.user_id, sync_run.tenant_id
  into v_user_id, v_tenant_id
  from public.xero_sync_runs as sync_run
  where sync_run.id = p_sync_run_id;

  if not found then
    return query select false, 'run_not_found'::text;
    return;
  end if;

  select tenant_state.*
  into v_state
  from public.xero_sync_tenant_state as tenant_state
  where tenant_state.user_id = v_user_id
    and tenant_state.tenant_id = v_tenant_id
  for update;

  select sync_run.*
  into v_run
  from public.xero_sync_runs as sync_run
  where sync_run.id = p_sync_run_id
  for update;

  if v_state.latest_sync_run_id is distinct from p_sync_run_id
     or v_state.current_fencing_token <> p_fencing_token
     or v_run.fencing_token <> p_fencing_token then
    return query select false, 'superseded'::text;
    return;
  end if;
  if v_run.status <> 'running' then
    return query select false, 'run_not_running'::text;
    return;
  end if;
  if v_run.lease_owner <> p_lease_owner then
    return query select false, 'wrong_lease_owner'::text;
    return;
  end if;
  if v_run.lease_expires_at <= v_now then
    return query select false, 'lease_expired'::text;
    return;
  end if;

  update public.xero_sync_runs as sync_run
  set status = 'failed',
      failed_at = v_now,
      error_code = v_error_code,
      error_resource = v_error_resource,
      lease_owner = null,
      lease_expires_at = null
  where sync_run.id = p_sync_run_id;

  return query select true, 'failed'::text;
end;
$$;

create function public.abandon_xero_sync_run(
  p_sync_run_id uuid,
  p_lease_owner uuid,
  p_fencing_token bigint,
  p_reason_code text default 'worker_abandoned'
)
returns table (
  abandoned boolean,
  result_code text
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_now timestamptz := now();
  v_reason_code text := nullif(btrim(p_reason_code), '');
  v_user_id uuid;
  v_tenant_id text;
  v_state public.xero_sync_tenant_state%rowtype;
  v_run public.xero_sync_runs%rowtype;
begin
  if p_sync_run_id is null
     or p_lease_owner is null
     or p_fencing_token is null
     or v_reason_code is null
     or v_reason_code !~ '^[a-z0-9][a-z0-9_.:-]{0,127}$' then
    raise exception 'Xero sync abandonment input is invalid';
  end if;

  select sync_run.user_id, sync_run.tenant_id
  into v_user_id, v_tenant_id
  from public.xero_sync_runs as sync_run
  where sync_run.id = p_sync_run_id;

  if not found then
    return query select false, 'run_not_found'::text;
    return;
  end if;

  select tenant_state.*
  into v_state
  from public.xero_sync_tenant_state as tenant_state
  where tenant_state.user_id = v_user_id
    and tenant_state.tenant_id = v_tenant_id
  for update;

  select sync_run.*
  into v_run
  from public.xero_sync_runs as sync_run
  where sync_run.id = p_sync_run_id
  for update;

  if v_state.latest_sync_run_id is distinct from p_sync_run_id
     or v_state.current_fencing_token <> p_fencing_token
     or v_run.fencing_token <> p_fencing_token then
    return query select false, 'superseded'::text;
    return;
  end if;
  if v_run.status <> 'running' then
    return query select false, 'run_not_running'::text;
    return;
  end if;
  if v_run.lease_owner <> p_lease_owner then
    return query select false, 'wrong_lease_owner'::text;
    return;
  end if;
  if v_run.lease_expires_at <= v_now then
    return query select false, 'lease_expired'::text;
    return;
  end if;

  update public.xero_sync_runs as sync_run
  set status = 'abandoned',
      abandoned_at = v_now,
      error_code = v_reason_code,
      error_resource = null,
      lease_owner = null,
      lease_expires_at = null
  where sync_run.id = p_sync_run_id;

  return query select true, 'abandoned'::text;
end;
$$;

create function public.promote_xero_sync_run(
  p_sync_run_id uuid,
  p_lease_owner uuid,
  p_fencing_token bigint,
  p_snapshot_as_of timestamptz default null
)
returns table (
  promoted boolean,
  result_code text,
  promoted_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_now timestamptz := now();
  v_user_id uuid;
  v_tenant_id text;
  v_state public.xero_sync_tenant_state%rowtype;
  v_run public.xero_sync_runs%rowtype;
  v_manifest_complete boolean;
begin
  if p_sync_run_id is null or p_lease_owner is null or p_fencing_token is null then
    raise exception 'Xero sync promotion input is incomplete';
  end if;

  select sync_run.user_id, sync_run.tenant_id
  into v_user_id, v_tenant_id
  from public.xero_sync_runs as sync_run
  where sync_run.id = p_sync_run_id;

  if not found then
    return query select false, 'run_not_found'::text, null::timestamptz;
    return;
  end if;

  select tenant_state.*
  into v_state
  from public.xero_sync_tenant_state as tenant_state
  where tenant_state.user_id = v_user_id
    and tenant_state.tenant_id = v_tenant_id
  for update;

  select sync_run.*
  into v_run
  from public.xero_sync_runs as sync_run
  where sync_run.id = p_sync_run_id
  for update;

  if v_state.latest_sync_run_id is distinct from p_sync_run_id
     or v_state.current_fencing_token <> p_fencing_token
     or v_run.fencing_token <> p_fencing_token then
    return query select false, 'superseded'::text, null::timestamptz;
    return;
  end if;
  if v_run.status <> 'running' then
    return query select false, 'run_not_running'::text, null::timestamptz;
    return;
  end if;
  if v_run.lease_owner <> p_lease_owner then
    return query select false, 'wrong_lease_owner'::text, null::timestamptz;
    return;
  end if;
  if v_run.lease_expires_at <= v_now then
    return query select false, 'lease_expired'::text, null::timestamptz;
    return;
  end if;

  select
    count(*) = cardinality(v_run.required_steps)
    and count(*) filter (
      where step.status = 'succeeded'
        and step.record_count is not null
        and step.completed_at is not null
    ) = cardinality(v_run.required_steps)
    and count(distinct step.step_key) = cardinality(v_run.required_steps)
  into v_manifest_complete
  from public.xero_sync_run_steps as step
  where step.sync_run_id = p_sync_run_id
    and step.step_key = any(v_run.required_steps);

  if not coalesce(v_manifest_complete, false) then
    return query select false, 'manifest_incomplete'::text, null::timestamptz;
    return;
  end if;

  -- Marking the run succeeded before moving the pointer satisfies the deferred
  -- pointer-integrity trigger. Both writes commit atomically or both roll back.
  update public.xero_sync_runs as sync_run
  set status = 'succeeded',
      completed_at = v_now,
      snapshot_as_of = coalesce(p_snapshot_as_of, v_now),
      lease_owner = null,
      lease_expires_at = null
  where sync_run.id = p_sync_run_id;

  update public.xero_sync_tenant_state as tenant_state
  set active_sync_run_id = p_sync_run_id,
      latest_sync_run_id = p_sync_run_id,
      last_successful_sync_at = v_now
  where tenant_state.user_id = v_user_id
    and tenant_state.tenant_id = v_tenant_id;

  return query select true, 'promoted'::text, v_now;
end;
$$;

-- RLS and explicit privileges. Browser roles receive no policies or grants.
alter table public.xero_sync_tenant_state enable row level security;
alter table public.xero_sync_runs enable row level security;
alter table public.xero_sync_run_steps enable row level security;

revoke all on table
  public.xero_sync_tenant_state,
  public.xero_sync_runs,
  public.xero_sync_run_steps
from public, anon, authenticated, service_role;

-- Run infrastructure mutations must use the fenced functions. Service code may
-- inspect state and manifests but cannot bypass state transitions with table DML.
grant select on table
  public.xero_sync_tenant_state,
  public.xero_sync_runs,
  public.xero_sync_run_steps
to service_role;

revoke all on function public.enforce_xero_sync_run_transition()
from public, anon, authenticated, service_role;
revoke all on function public.validate_xero_sync_tenant_state_pointers()
from public, anon, authenticated, service_role;

revoke all on function public.acquire_xero_sync_run(uuid, text, uuid, text, integer)
from public, anon, authenticated, service_role;
grant execute on function public.acquire_xero_sync_run(uuid, text, uuid, text, integer)
to service_role;

revoke all on function public.heartbeat_xero_sync_run(uuid, uuid, bigint, integer)
from public, anon, authenticated, service_role;
grant execute on function public.heartbeat_xero_sync_run(uuid, uuid, bigint, integer)
to service_role;

revoke all on function public.complete_xero_sync_run_step(uuid, uuid, bigint, text, bigint)
from public, anon, authenticated, service_role;
grant execute on function public.complete_xero_sync_run_step(uuid, uuid, bigint, text, bigint)
to service_role;

revoke all on function public.fail_xero_sync_run(uuid, uuid, bigint, text, text)
from public, anon, authenticated, service_role;
grant execute on function public.fail_xero_sync_run(uuid, uuid, bigint, text, text)
to service_role;

revoke all on function public.abandon_xero_sync_run(uuid, uuid, bigint, text)
from public, anon, authenticated, service_role;
grant execute on function public.abandon_xero_sync_run(uuid, uuid, bigint, text)
to service_role;

revoke all on function public.promote_xero_sync_run(uuid, uuid, bigint, timestamptz)
from public, anon, authenticated, service_role;
grant execute on function public.promote_xero_sync_run(uuid, uuid, bigint, timestamptz)
to service_role;
