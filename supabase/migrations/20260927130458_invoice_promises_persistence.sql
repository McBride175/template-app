-- Promise persistence only. No accounting reads, scoring, UI or reconciliation.
-- Provenance UUIDs are deliberately NOT retention-coupled foreign keys to sync
-- runs. The constrained writer checks their owner/tenant when first used;
-- erasing/retiring accounting generations must not erase commitment history.

create function public.invoice_promise_baseline_valid(p_value jsonb)
returns boolean language plpgsql immutable set search_path = pg_catalog as $$
declare v_start timestamptz; v_end timestamptz;
begin
  if jsonb_typeof(p_value) is distinct from 'object'
     or p_value - array['version','payment_ids','observation_started_at','observation_completed_at'] <> '{}'
     or p_value->'version' is distinct from '1'::jsonb
     or jsonb_typeof(p_value->'payment_ids') is distinct from 'array'
     or jsonb_typeof(p_value->'observation_started_at') is distinct from 'string'
     or jsonb_typeof(p_value->'observation_completed_at') is distinct from 'string' then return false; end if;
  if exists (select 1 from jsonb_array_elements(p_value->'payment_ids') as ids(value)
             where jsonb_typeof(value) <> 'string' or btrim(value #>> '{}') = '')
     or (select count(*) <> count(distinct value)
         from jsonb_array_elements(p_value->'payment_ids') as ids(value)) then return false; end if;
  -- Require explicit offsets; never interpret baseline time in session timezone.
  if p_value->>'observation_started_at' !~ '(Z|[+-][0-9]{2}:[0-9]{2})$'
     or p_value->>'observation_completed_at' !~ '(Z|[+-][0-9]{2}:[0-9]{2})$' then return false; end if;
  v_start := (p_value->>'observation_started_at')::timestamptz;
  v_end := (p_value->>'observation_completed_at')::timestamptz;
  return isfinite(v_start) and isfinite(v_end) and v_start <= v_end;
exception when invalid_datetime_format or datetime_field_overflow then return false;
end $$;

create table public.invoice_promises (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  tenant_id text not null check (btrim(tenant_id) <> ''),
  source_system text not null check (btrim(source_system) <> ''),
  invoice_source_id text not null check (btrim(invoice_source_id) <> ''),
  customer_source_id text not null check (btrim(customer_source_id) <> ''),
  promised_amount_native numeric not null check (promised_amount_native > 0 and promised_amount_native < 'Infinity'::numeric),
  currency_code text not null check (currency_code ~ '^[A-Z]{3}$'),
  promised_date date not null check (isfinite(promised_date)),
  note text check (char_length(note) <= 2000),
  status text not null default 'active' check (status in ('active','kept','missed','unclear','cancelled')),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  resolved_at timestamptz,
  revision bigint not null default 1 check (revision > 0),
  creation_sync_run_id uuid not null,
  payment_baseline jsonb not null check (public.invoice_promise_baseline_valid(payment_baseline)),
  qualifying_paid_amount_native numeric not null default 0
    check (qualifying_paid_amount_native >= 0 and qualifying_paid_amount_native < 'Infinity'::numeric),
  evaluated_sync_run_id uuid,
  evaluated_at timestamptz,
  resolution_reason_code text check (resolution_reason_code ~ '^[a-z0-9][a-z0-9_.:-]{0,127}$'),
  resolution_contract_version text check (resolution_contract_version is null or nullif(btrim(resolution_contract_version),'') is not null),
  constraint invoice_promises_owner_key unique (id, user_id, tenant_id),
  constraint invoice_promises_resolution_shape check ((status = 'active') = (resolved_at is null)),
  constraint invoice_promises_evaluation_shape check ((evaluated_sync_run_id is null) = (evaluated_at is null)),
  constraint invoice_promises_resolution_provenance check (
    (status in ('active','cancelled') and resolution_reason_code is null and resolution_contract_version is null)
    or (status in ('kept','missed','unclear') and resolution_reason_code is not null
        and resolution_contract_version is not null and evaluated_sync_run_id is not null)
  )
);

-- Exact active identity; terminal commitments never occupy this key.
create unique index idx_invoice_promises_one_active
  on public.invoice_promises (user_id, tenant_id, source_system, invoice_source_id) where status = 'active';
-- Current and historic invoice/customer context, independent of generations.
create index idx_invoice_promises_invoice_history
  on public.invoice_promises (user_id, tenant_id, source_system, invoice_source_id, created_at desc, id);
create index idx_invoice_promises_customer_history
  on public.invoice_promises (user_id, tenant_id, source_system, customer_source_id, created_at desc, id);
-- Future tenant-scoped active reconciliation; no job is introduced here.
create index idx_invoice_promises_active_date
  on public.invoice_promises (user_id, tenant_id, source_system, promised_date, id) where status = 'active';

create function public.invoice_promise_terms(p_row public.invoice_promises)
returns jsonb language sql immutable set search_path = pg_catalog as $$
  select jsonb_build_object('version',1,'promised_amount_native',trim_scale(p_row.promised_amount_native)::text,
    'currency_code',p_row.currency_code,'promised_date',to_char(p_row.promised_date,'YYYY-MM-DD'),
    'note',p_row.note,'status',p_row.status);
$$;

create function public.invoice_promise_terms_valid(p_value jsonb)
returns boolean language plpgsql immutable set search_path = pg_catalog as $$
declare v_amount numeric; v_date date;
begin
  if jsonb_typeof(p_value) is distinct from 'object'
     or p_value - array['version','promised_amount_native','currency_code','promised_date','note','status'] <> '{}'
     or p_value->'version' is distinct from '1'::jsonb
     or jsonb_typeof(p_value->'promised_amount_native') is distinct from 'string'
     or jsonb_typeof(p_value->'currency_code') is distinct from 'string'
     or jsonb_typeof(p_value->'promised_date') is distinct from 'string'
     or jsonb_typeof(p_value->'status') is distinct from 'string'
     or jsonb_typeof(p_value->'note') not in ('string','null') or not p_value ? 'note'
     or p_value->>'currency_code' !~ '^[A-Z]{3}$'
     or p_value->>'promised_date' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
     or p_value->>'status' not in ('active','kept','missed','unclear','cancelled')
     or char_length(p_value->>'note') > 2000 then return false; end if;
  v_amount := (p_value->>'promised_amount_native')::numeric;
  v_date := (p_value->>'promised_date')::date;
  return v_amount > 0 and v_amount < 'Infinity'::numeric and isfinite(v_date);
exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow
  or numeric_value_out_of_range then return false;
end $$;

create table public.invoice_promise_events (
  id uuid primary key default gen_random_uuid(),
  promise_id uuid not null,
  user_id uuid not null,
  tenant_id text not null,
  event_sequence bigint not null check (event_sequence > 0),
  promise_revision bigint not null check (promise_revision > 0),
  event_type text not null check (event_type in ('created','changed','note_changed','cancelled','kept','missed','unclear')),
  occurred_at timestamptz not null default clock_timestamp(),
  effective_at timestamptz,
  actor_kind text not null check (actor_kind in ('user','system')),
  actor_user_id uuid,
  before_terms jsonb check (before_terms is null or public.invoice_promise_terms_valid(before_terms)),
  after_terms jsonb not null check (public.invoice_promise_terms_valid(after_terms)),
  evidence jsonb check (evidence is null or
    (jsonb_typeof(evidence) = 'object' and evidence->'version' is not distinct from '1'::jsonb)),
  source_sync_run_id uuid,
  resolver_version text check (resolver_version is null or nullif(btrim(resolver_version),'') is not null),
  -- One command may produce several events. Its final event reconstructs the
  -- committed result even after later commands change the operational row.
  command_id uuid not null,
  command_fingerprint text not null check (command_fingerprint ~ '^[a-f0-9]{64}$'),
  command_event_sequence bigint not null default 1 check (command_event_sequence > 0),
  constraint invoice_promise_events_owner_fkey foreign key (promise_id,user_id,tenant_id)
    references public.invoice_promises(id,user_id,tenant_id) on delete cascade,
  constraint invoice_promise_events_sequence_key unique (promise_id,event_sequence),
  constraint invoice_promise_events_command_key unique (user_id,command_id,command_event_sequence),
  constraint invoice_promise_events_actor_shape check (
    (actor_kind = 'user' and actor_user_id is not null and actor_user_id = user_id)
    or (actor_kind = 'system' and actor_user_id is null)),
  constraint invoice_promise_events_creation_shape check ((event_type = 'created') = (before_terms is null)),
  constraint invoice_promise_events_evidence_shape check (
    (event_type in ('kept','missed','unclear') and actor_kind = 'system' and evidence is not null
      and source_sync_run_id is not null and resolver_version is not null)
    or (event_type not in ('kept','missed','unclear') and actor_kind = 'user'
      and evidence is null and source_sync_run_id is null and resolver_version is null))
);
create unique index idx_invoice_promise_events_one_terminal
  on public.invoice_promise_events (promise_id) where event_type in ('cancelled','kept','missed','unclear');
-- The sequence unique index supplies timeline order and FK cascade lookup;
-- the command unique index supplies replay lookup. No extra timeline index.

create function public.guard_invoice_promise_row()
returns trigger language plpgsql security definer set search_path = pg_catalog as $$
begin
  if tg_op = 'DELETE' then
    if exists (select 1 from auth.users where id = old.user_id) then
      raise exception 'invoice_promise_delete_forbidden' using errcode = '42501';
    end if;
    return old; -- Only the auth-user deletion cascade can erase history.
  end if;
  if tg_op = 'UPDATE' then
    if old.status <> 'active' then raise exception 'invoice_promise_terminal_immutable' using errcode = '23514'; end if;
    if row(new.id,new.user_id,new.tenant_id,new.source_system,new.invoice_source_id,new.customer_source_id,
           new.currency_code,new.created_at,new.creation_sync_run_id,new.payment_baseline)
       is distinct from row(old.id,old.user_id,old.tenant_id,old.source_system,old.invoice_source_id,old.customer_source_id,
           old.currency_code,old.created_at,old.creation_sync_run_id,old.payment_baseline) then
      raise exception 'invoice_promise_creation_facts_immutable' using errcode = '23514';
    end if;
    new.revision := old.revision + 1;
    new.updated_at := clock_timestamp();
  elsif new.status <> 'active' or new.revision <> 1 or new.qualifying_paid_amount_native <> 0
     or new.evaluated_sync_run_id is not null then
    raise exception 'invoice_promise_invalid_initial_state' using errcode = '23514';
  end if;
  if (new.payment_baseline->>'observation_completed_at')::timestamptz > new.created_at then
    raise exception 'invoice_promise_future_baseline' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger guard_invoice_promises before insert or update or delete on public.invoice_promises
for each row execute function public.guard_invoice_promise_row();

create function public.guard_invoice_promise_event()
returns trigger language plpgsql security definer set search_path = pg_catalog as $$
declare v_row public.invoice_promises; v_previous public.invoice_promise_events;
  v_command public.invoice_promise_events;
begin
  if tg_op = 'UPDATE' then raise exception 'invoice_promise_event_immutable' using errcode = '42501'; end if;
  if tg_op = 'DELETE' then
    if exists (select 1 from auth.users where id = old.user_id) then
      raise exception 'invoice_promise_event_immutable' using errcode = '42501';
    end if;
    return old;
  end if;
  select * into v_row from public.invoice_promises
    where id = new.promise_id and user_id = new.user_id and tenant_id = new.tenant_id for update;
  if not found then raise exception 'invoice_promise_event_owner_mismatch' using errcode = '23503'; end if;
  select * into v_previous from public.invoice_promise_events
    where promise_id = new.promise_id order by event_sequence desc limit 1;
  if new.event_sequence <> coalesce(v_previous.event_sequence,0) + 1
     or new.promise_revision > v_row.revision
     or new.promise_revision < coalesce(v_previous.promise_revision,1)
     or new.before_terms is distinct from v_previous.after_terms then
    raise exception 'invoice_promise_event_sequence_conflict' using errcode = '23514';
  end if;
  if new.event_type = 'created' then
    if new.event_sequence <> 1 or new.promise_revision <> 1 or new.after_terms->>'status' <> 'active' then
      raise exception 'invoice_promise_invalid_created_event' using errcode = '23514'; end if;
  elsif new.before_terms->>'status' <> 'active' then
    raise exception 'invoice_promise_terminal_event_conflict' using errcode = '23514';
  elsif new.event_type = 'changed' then
    if new.after_terms->>'status' <> 'active'
       or new.before_terms - array['promised_amount_native','promised_date'] <>
          new.after_terms - array['promised_amount_native','promised_date']
       or new.before_terms = new.after_terms then
      raise exception 'invoice_promise_invalid_changed_event' using errcode = '23514'; end if;
  elsif new.event_type = 'note_changed' then
    if new.before_terms - 'note' <> new.after_terms - 'note' or new.before_terms = new.after_terms then
      raise exception 'invoice_promise_invalid_note_event' using errcode = '23514'; end if;
  elsif new.after_terms->>'status' <> new.event_type
     or new.before_terms - 'status' <> new.after_terms - 'status' then
    raise exception 'invoice_promise_invalid_terminal_event' using errcode = '23514';
  end if;
  select * into v_command from public.invoice_promise_events
    where user_id = new.user_id and command_id = new.command_id order by command_event_sequence desc limit 1;
  if new.command_event_sequence <> coalesce(v_command.command_event_sequence,0) + 1
     or (v_command.id is not null and (v_command.promise_id <> new.promise_id
       or v_command.command_fingerprint <> new.command_fingerprint)) then
    raise exception 'invoice_promise_command_conflict' using errcode = '23514'; end if;
  return new;
end $$;
create trigger guard_invoice_promise_events before insert or update or delete on public.invoice_promise_events
for each row execute function public.guard_invoice_promise_event();

-- Deferred because state + history are separate statements in one command.
-- These checks also protect a future command which produces multiple events
-- at a single resulting operational revision.
-- A future evidence-metadata-only update need not invent a lifecycle event;
-- event revisions may skip operational revisions while the terms chain agrees.
create function public.check_invoice_promise_history()
returns trigger language plpgsql security definer set search_path = pg_catalog as $$
declare v_id uuid; v_row public.invoice_promises; v_first public.invoice_promise_events;
  v_last public.invoice_promise_events; v_terminal public.invoice_promise_events;
begin
  if tg_table_name = 'invoice_promises' then v_id := new.id; else v_id := new.promise_id; end if;
  select * into v_row from public.invoice_promises where id = v_id;
  if not found then return null; end if; -- Privacy cascade.
  select * into v_first from public.invoice_promise_events where promise_id = v_id order by event_sequence limit 1;
  select * into v_last from public.invoice_promise_events where promise_id = v_id order by event_sequence desc limit 1;
  select * into v_terminal from public.invoice_promise_events where promise_id = v_id
    and event_type in ('cancelled','kept','missed','unclear');
  if v_first.event_type is distinct from 'created' or v_first.event_sequence is distinct from 1::bigint
     or v_last.after_terms is distinct from public.invoice_promise_terms(v_row)
     or v_last.promise_revision > v_row.revision
     or ((v_row.status = 'active') <> (v_terminal.id is null))
     or (v_row.status <> 'active' and (v_terminal.event_type <> v_row.status
       or v_terminal.event_sequence <> v_last.event_sequence or v_terminal.promise_revision <> v_row.revision
       or v_terminal.source_sync_run_id is distinct from v_row.evaluated_sync_run_id and v_row.status <> 'cancelled'
       or v_terminal.resolver_version is distinct from v_row.resolution_contract_version)) then
    raise exception 'invoice_promise_history_inconsistent' using errcode = '23514';
  end if;
  return null;
end $$;
create constraint trigger invoice_promises_history_consistent after insert or update on public.invoice_promises
deferrable initially deferred for each row execute function public.check_invoice_promise_history();
create constraint trigger invoice_promise_events_history_consistent after insert on public.invoice_promise_events
deferrable initially deferred for each row execute function public.check_invoice_promise_history();

create function public.apply_invoice_promise_command(
  p_user_id uuid, p_tenant_id text, p_command_id uuid, p_operation text,
  p_promise_id uuid, p_expected_revision bigint, p_actor_kind text, p_actor_user_id uuid, p_payload jsonb
)
returns jsonb language plpgsql security definer set search_path = pg_catalog as $$
declare v_row public.invoice_promises; v_before jsonb; v_event public.invoice_promise_events;
  v_fingerprint text; v_payload jsonb := p_payload; v_allowed text[];
  v_amount numeric; v_date date; v_note text; v_run uuid; v_status text;
  v_paid numeric; v_effective timestamptz; v_evaluated timestamptz; v_baseline jsonb;
begin
  if p_user_id is null or nullif(btrim(p_tenant_id),'') is null or p_command_id is null
     or p_operation is null or p_operation not in ('create','change_terms','change_note','cancel','resolve')
     or jsonb_typeof(p_payload) is distinct from 'object'
     or p_actor_kind is null or p_actor_kind not in ('user','system')
     or (p_actor_kind = 'user' and p_actor_user_id is distinct from p_user_id)
     or (p_actor_kind = 'system' and p_actor_user_id is not null)
     or ((p_operation = 'resolve') <> (p_actor_kind = 'system')) then
    raise exception 'invoice_promise_invalid_command' using errcode = '22023'; end if;
  v_allowed := case p_operation
    when 'create' then array['source_system','invoice_source_id','customer_source_id','currency_code',
      'promised_amount_native','promised_date','note','creation_sync_run_id','payment_baseline']
    when 'change_terms' then array['promised_amount_native','promised_date']
    when 'change_note' then array['note']
    when 'cancel' then array[]::text[]
    when 'resolve' then array['status','qualifying_paid_amount_native','evaluated_sync_run_id','evaluated_at',
      'resolution_reason_code','resolution_contract_version','effective_at','evidence'] end;
  if p_payload - v_allowed <> '{}' then raise exception 'invoice_promise_invalid_payload' using errcode = '22023'; end if;
  if p_operation in ('create','change_terms') then
    if jsonb_typeof(p_payload->'promised_amount_native') is distinct from 'string'
       or jsonb_typeof(p_payload->'promised_date') is distinct from 'string'
       or p_payload->>'promised_date' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
      raise exception 'invoice_promise_invalid_terms' using errcode = '22023'; end if;
    v_amount := (p_payload->>'promised_amount_native')::numeric;
    v_date := (p_payload->>'promised_date')::date;
    if not (v_amount > 0 and v_amount < 'Infinity'::numeric) or not isfinite(v_date) then
      raise exception 'invoice_promise_invalid_terms' using errcode = '22023'; end if;
    v_payload := jsonb_set(v_payload,'{promised_amount_native}',to_jsonb(trim_scale(v_amount)::text));
  end if;
  if p_operation in ('create','change_note') then
    if p_operation = 'change_note' and not p_payload ? 'note' then
      raise exception 'invoice_promise_missing_note' using errcode = '22023'; end if;
    if p_payload ? 'note' and jsonb_typeof(p_payload->'note') not in ('string','null') then
      raise exception 'invoice_promise_invalid_note' using errcode = '22023'; end if;
    if char_length(p_payload->>'note') > 2000 then raise exception 'invoice_promise_note_too_long' using errcode = '22023'; end if;
    v_note := nullif(regexp_replace(p_payload->>'note','^\s+|\s+$','','g'),'');
    v_payload := v_payload || jsonb_build_object('note',v_note);
  end if;
  if p_operation = 'create' then
    if p_promise_id is not null or p_expected_revision is not null
       or jsonb_typeof(p_payload->'source_system') is distinct from 'string'
       or jsonb_typeof(p_payload->'invoice_source_id') is distinct from 'string'
       or jsonb_typeof(p_payload->'customer_source_id') is distinct from 'string'
       or jsonb_typeof(p_payload->'currency_code') is distinct from 'string'
       or jsonb_typeof(p_payload->'creation_sync_run_id') is distinct from 'string'
       or not public.invoice_promise_baseline_valid(p_payload->'payment_baseline') then
      raise exception 'invoice_promise_invalid_creation' using errcode = '22023'; end if;
    v_run := (p_payload->>'creation_sync_run_id')::uuid;
    -- The baseline is an identity set, and timestamps denote instants. Normalize
    -- equivalent encodings so retry intent is independent of order/session TZ.
    v_baseline := jsonb_build_object('version',1,'payment_ids',coalesce((
      select jsonb_agg(value order by value) from jsonb_array_elements(p_payload->'payment_baseline'->'payment_ids') as ids(value)
    ),'[]'::jsonb),'observation_started_at',to_char(
      (p_payload->'payment_baseline'->>'observation_started_at')::timestamptz at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'observation_completed_at',to_char(
      (p_payload->'payment_baseline'->>'observation_completed_at')::timestamptz at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
    v_payload := v_payload || jsonb_build_object('creation_sync_run_id',v_run,'payment_baseline',v_baseline);
  elsif p_promise_id is null or p_expected_revision is null or p_expected_revision <= 0 then
    raise exception 'invoice_promise_expected_revision_required' using errcode = '22023';
  end if;
  if p_operation = 'resolve' then
    v_status := p_payload->>'status';
    if v_status is null or v_status not in ('kept','missed','unclear')
       or jsonb_typeof(p_payload->'qualifying_paid_amount_native') is distinct from 'string'
       or jsonb_typeof(p_payload->'evaluated_sync_run_id') is distinct from 'string'
       or jsonb_typeof(p_payload->'evaluated_at') is distinct from 'string'
       or p_payload->>'evaluated_at' !~ '(Z|[+-][0-9]{2}:[0-9]{2})$'
       or jsonb_typeof(p_payload->'resolution_reason_code') is distinct from 'string'
       or jsonb_typeof(p_payload->'resolution_contract_version') is distinct from 'string'
       or jsonb_typeof(p_payload->'evidence') is distinct from 'object'
       or p_payload->'evidence'->'version' is distinct from '1'::jsonb then
      raise exception 'invoice_promise_invalid_resolution' using errcode = '22023'; end if;
    v_paid := (p_payload->>'qualifying_paid_amount_native')::numeric;
    v_run := (p_payload->>'evaluated_sync_run_id')::uuid;
    v_evaluated := (p_payload->>'evaluated_at')::timestamptz;
    if p_payload->>'effective_at' is not null then
      if jsonb_typeof(p_payload->'effective_at') <> 'string'
         or p_payload->>'effective_at' !~ '(Z|[+-][0-9]{2}:[0-9]{2})$' then
        raise exception 'invoice_promise_invalid_effective_time' using errcode = '22023'; end if;
      v_effective := (p_payload->>'effective_at')::timestamptz;
    end if;
    if not (v_paid >= 0 and v_paid < 'Infinity'::numeric) or not isfinite(v_evaluated)
       or v_evaluated > clock_timestamp() or (v_effective is not null and not isfinite(v_effective)) then
      raise exception 'invoice_promise_invalid_resolution' using errcode = '22023'; end if;
    v_payload := v_payload || jsonb_build_object('qualifying_paid_amount_native',trim_scale(v_paid)::text,
      'evaluated_sync_run_id',v_run,
      'evaluated_at',to_char(v_evaluated at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'effective_at',to_char(v_effective at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
  end if;
  v_fingerprint := encode(sha256(convert_to(jsonb_build_object('version',1,'user_id',p_user_id,
    'tenant_id',p_tenant_id,'operation',p_operation,'promise_id',p_promise_id,'expected_revision',p_expected_revision,
    'actor_kind',p_actor_kind,'actor_user_id',p_actor_user_id,'payload',v_payload)::text,'UTF8')),'hex');
  -- Serializes an uncertain retry before creation generates a new Promise ID.
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text || ':' || p_command_id::text,0));
  select * into v_event from public.invoice_promise_events
    where user_id = p_user_id and command_id = p_command_id order by command_event_sequence desc limit 1;
  if found then
    if v_event.command_fingerprint <> v_fingerprint then
      raise exception 'invoice_promise_command_conflict' using errcode = '23505'; end if;
    return jsonb_build_object('promise_id',v_event.promise_id,'revision',v_event.promise_revision,
      'status',v_event.after_terms->>'status','event_sequence',v_event.event_sequence);
  end if;
  if p_operation in ('create','resolve') and not exists (
    select 1 from public.xero_sync_runs where id = v_run and user_id = p_user_id
      and tenant_id = p_tenant_id and status = 'succeeded'
  ) then raise exception 'invoice_promise_provenance_mismatch' using errcode = '23503'; end if;
  if p_operation = 'create' then
    insert into public.invoice_promises(user_id,tenant_id,source_system,invoice_source_id,customer_source_id,
      currency_code,promised_amount_native,promised_date,note,creation_sync_run_id,payment_baseline)
    values (p_user_id,p_tenant_id,p_payload->>'source_system',p_payload->>'invoice_source_id',
      p_payload->>'customer_source_id',p_payload->>'currency_code',v_amount,v_date,v_note,v_run,v_baseline)
    returning * into v_row;
  else
    select * into v_row from public.invoice_promises
      where id = p_promise_id and user_id = p_user_id and tenant_id = p_tenant_id for update;
    if not found or v_row.status <> 'active' or v_row.revision <> p_expected_revision then
      raise exception 'invoice_promise_revision_conflict' using errcode = '40001'; end if;
    v_before := public.invoice_promise_terms(v_row);
    if p_operation = 'change_terms' then
      if v_row.promised_amount_native = v_amount and v_row.promised_date = v_date then
        raise exception 'invoice_promise_no_change' using errcode = '22023'; end if;
      update public.invoice_promises set promised_amount_native = v_amount, promised_date = v_date
        where id = v_row.id returning * into v_row;
    elsif p_operation = 'change_note' then
      if v_row.note is not distinct from v_note then raise exception 'invoice_promise_no_change' using errcode = '22023'; end if;
      update public.invoice_promises set note = v_note where id = v_row.id returning * into v_row;
    elsif p_operation = 'cancel' then
      update public.invoice_promises set status = 'cancelled', resolved_at = clock_timestamp()
        where id = v_row.id returning * into v_row;
    else
      update public.invoice_promises set status = v_status, resolved_at = clock_timestamp(),
        qualifying_paid_amount_native = v_paid, evaluated_sync_run_id = v_run, evaluated_at = v_evaluated,
        resolution_reason_code = p_payload->>'resolution_reason_code',
        resolution_contract_version = p_payload->>'resolution_contract_version'
        where id = v_row.id returning * into v_row;
    end if;
  end if;
  insert into public.invoice_promise_events(promise_id,user_id,tenant_id,event_sequence,promise_revision,
    event_type,actor_kind,actor_user_id,before_terms,after_terms,command_id,command_fingerprint,
    effective_at,evidence,source_sync_run_id,resolver_version)
  values (v_row.id,p_user_id,p_tenant_id,
    coalesce((select max(event_sequence) from public.invoice_promise_events where promise_id = v_row.id),0)+1,
    v_row.revision,case p_operation when 'create' then 'created' when 'change_terms' then 'changed'
      when 'change_note' then 'note_changed' when 'cancel' then 'cancelled' else v_status end,
    p_actor_kind,p_actor_user_id,v_before,public.invoice_promise_terms(v_row),p_command_id,v_fingerprint,
    v_effective,case when p_operation = 'resolve' then p_payload->'evidence' end,
    case when p_operation = 'resolve' then v_run end,
    case when p_operation = 'resolve' then p_payload->>'resolution_contract_version' end)
  returning * into v_event;
  return jsonb_build_object('promise_id',v_row.id,'revision',v_row.revision,
    'status',v_row.status,'event_sequence',v_event.event_sequence);
end $$;

alter table public.invoice_promises enable row level security;
alter table public.invoice_promise_events enable row level security;
revoke all on table public.invoice_promises, public.invoice_promise_events from public, anon, authenticated, service_role;
grant select on table public.invoice_promises, public.invoice_promise_events to service_role;
-- No ordinary role can write around the atomic, scoped command function.
revoke all on function public.invoice_promise_baseline_valid(jsonb), public.invoice_promise_terms(public.invoice_promises),
  public.invoice_promise_terms_valid(jsonb), public.guard_invoice_promise_row(), public.guard_invoice_promise_event(),
  public.check_invoice_promise_history() from public, anon, authenticated, service_role;
revoke all on function public.apply_invoice_promise_command(uuid,text,uuid,text,uuid,bigint,text,uuid,jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.apply_invoice_promise_command(uuid,text,uuid,text,uuid,bigint,text,uuid,jsonb) to service_role;
