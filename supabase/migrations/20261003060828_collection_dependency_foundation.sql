-- Phase 3.2: dependency metadata only. No accounting pointer, calculated values,
-- cache, read-path activation or background work is introduced.
create table public.collection_dependency_heads (
  user_id uuid not null references auth.users(id) on delete cascade,
  tenant_id text not null check (btrim(tenant_id) <> ''),
  source_system text not null check (btrim(source_system) <> ''),
  financial_epoch bigint not null default 0 check (financial_epoch >= 0),
  projection_revision bigint not null default 0 check (projection_revision >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, tenant_id, source_system)
);
create table public.collection_customer_financial_revisions (
  user_id uuid not null references auth.users(id) on delete cascade,
  tenant_id text not null check (btrim(tenant_id) <> ''),
  source_system text not null check (btrim(source_system) <> ''),
  customer_source_id text not null check (btrim(customer_source_id) <> ''),
  financial_revision bigint not null default 0 check (financial_revision >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, tenant_id, source_system, customer_source_id)
);
alter table public.collection_dependency_heads enable row level security;
alter table public.collection_customer_financial_revisions enable row level security;
revoke all on public.collection_dependency_heads, public.collection_customer_financial_revisions
  from public, anon, authenticated, service_role;
grant select on public.collection_dependency_heads, public.collection_customer_financial_revisions to service_role;

-- Internal trigger operations cannot be called through the Data API. Trigger
-- scope comes from authoritative rows, never browser-supplied counter values.
create schema collection_dependency_private authorization postgres;
alter default privileges in schema collection_dependency_private revoke execute on functions from public;
revoke all on schema collection_dependency_private from public, anon, authenticated, service_role;

create function collection_dependency_private.lock_financial_scope(p_user uuid, p_tenant text, p_source text)
returns void language plpgsql set search_path = pg_catalog as $$
begin
  -- Match promotion and Promise commands: state row before any tenant lock.
  if p_source = 'xero' then
    perform 1 from public.xero_sync_tenant_state
      where user_id = p_user and tenant_id = p_tenant for update;
  end if;
  -- Also fences publication when this scope has no accounting-state row yet.
  perform pg_advisory_xact_lock(hashtextextended(
    'collection-dependency:' || p_user::text || ':' || p_tenant || ':' || p_source, 0));
end $$;

create function collection_dependency_private.advance_projection(p_user uuid, p_tenant text, p_source text)
returns void language plpgsql set search_path = pg_catalog as $$
begin
  -- User-erasure cascades must erase metadata, not recreate it or fail an FK.
  if not exists (select 1 from auth.users where id = p_user) then return; end if;
  insert into public.collection_dependency_heads(user_id, tenant_id, source_system, projection_revision)
    values (p_user, p_tenant, p_source, 1)
    on conflict (user_id, tenant_id, source_system) do update
    set projection_revision = public.collection_dependency_heads.projection_revision + 1,
        updated_at = clock_timestamp();
end $$;

create function collection_dependency_private.advance_financial(
  p_user uuid, p_tenant text, p_source text, p_customers text[] default '{}'
) returns void language plpgsql set search_path = pg_catalog as $$
begin
  if not exists (select 1 from auth.users where id = p_user) then return; end if;
  -- Head before customer rows, sorted/deduplicated: no read/add/write race.
  insert into public.collection_dependency_heads(user_id, tenant_id, source_system, financial_epoch, projection_revision)
    values (p_user, p_tenant, p_source, 1, 1)
    on conflict (user_id, tenant_id, source_system) do update
    set financial_epoch = public.collection_dependency_heads.financial_epoch + 1,
        projection_revision = public.collection_dependency_heads.projection_revision + 1,
        updated_at = clock_timestamp();
  insert into public.collection_customer_financial_revisions
    (user_id, tenant_id, source_system, customer_source_id, financial_revision)
    select p_user, p_tenant, p_source, customer, 1
    from (select distinct customer from unnest(p_customers) customer
      where nullif(btrim(customer), '') is not null order by customer) ids
    on conflict (user_id, tenant_id, source_system, customer_source_id) do update
    set financial_revision = public.collection_customer_financial_revisions.financial_revision + 1,
        updated_at = clock_timestamp();
end $$;

-- These native comparisons classify dependencies only. They never produce
-- accounting, scoring or UI values. Clipping matches the existing pure domain.
create function collection_dependency_private.dispute_coverage(p_row jsonb, p_due numeric, p_open boolean)
returns numeric language sql immutable set search_path = pg_catalog as $$
  select case when not p_open or p_row is null or (p_row->>'is_active')::boolean is not true then 0
    when p_row->>'dispute_mode' = 'full' then p_due
    else least(p_due, (p_row->>'recorded_disputed_amount_native')::numeric) end;
$$;
create function collection_dependency_private.promise_signature(p_row jsonb, p_due numeric, p_disputed numeric, p_open boolean)
returns jsonb language sql immutable set search_path = pg_catalog as $$
  select case when p_row is null or p_row->>'status' <> 'active' then jsonb_build_array(false, 0)
    when p_due is null then jsonb_build_array(true, 'unavailable', p_row->'promised_amount_native', p_row->'qualifying_paid_amount_native')
    when not p_open then jsonb_build_array(false, 0)
    else jsonb_build_array(true, least(greatest(p_due - p_disputed, 0), greatest(
      (p_row->>'promised_amount_native')::numeric - (p_row->>'qualifying_paid_amount_native')::numeric, 0))) end;
$$;

-- Called after the scope lock; fresh statement snapshots observe a promotion
-- that completed while the mutation waited. Candidate rows are never selected.
create function collection_dependency_private.invoice_context(p_user uuid, p_tenant text, p_source text, p_invoice text)
returns table(customer_source_id text, amount_due_native numeric, is_open boolean)
language sql volatile set search_path = pg_catalog as $$
  select i.customer_source_id,
    case when i.amount_due_native >= 0 and i.amount_due_native < 'Infinity'::numeric then i.amount_due_native end,
    coalesce(upper(btrim(i.type)) = 'ACCREC' and upper(btrim(i.status)) = 'AUTHORISED'
      and nullif(btrim(i.customer_source_id), '') is not null
      and i.amount_due_native > 0 and i.amount_due_native < 'Infinity'::numeric, false)
  from public.canonical_invoices i
  where i.user_id = p_user and i.tenant_id = p_tenant and i.source_system = p_source and i.source_id = p_invoice
    and i.sync_run_id is not distinct from (
      select s.active_sync_run_id from public.xero_sync_tenant_state s
      where s.user_id = p_user and s.tenant_id = p_tenant and p_source = 'xero')
  limit 1;
$$;

create function collection_dependency_private.dispute_changed()
returns trigger language plpgsql security definer set search_path = pg_catalog as $$
declare a jsonb; b jsonb; scope jsonb; context record; financial boolean;
begin
  if tg_op <> 'INSERT' then a := to_jsonb(old); end if;
  if tg_op <> 'DELETE' then b := to_jsonb(new); end if;
  -- Ignore revision/updated_at churn without dropping the domain's audit writes.
  if (a - array['revision','updated_at']) is not distinct from (b - array['revision','updated_at']) then return null; end if;
  -- Existing commands never reassign durable provider identity. For privileged
  -- reassignment, invalidate both scopes rather than accidentally using NEW only.
  for scope in select value from (select distinct value from jsonb_array_elements(jsonb_build_array(a, b))
    where value <> 'null'::jsonb) candidates order by value->>'user_id', value->>'tenant_id', value->>'source_system'
  loop
    if a is not null and b is not null
      and row(a->>'user_id',a->>'tenant_id',a->>'source_system',a->>'invoice_source_id')
          is not distinct from row(b->>'user_id',b->>'tenant_id',b->>'source_system',b->>'invoice_source_id')
      and scope = a then continue; end if;
    perform collection_dependency_private.lock_financial_scope((scope->>'user_id')::uuid, scope->>'tenant_id', scope->>'source_system');
    select * into context from collection_dependency_private.invoice_context(
      (scope->>'user_id')::uuid, scope->>'tenant_id', scope->>'source_system', scope->>'invoice_source_id');
    financial := collection_dependency_private.dispute_coverage(
      case when a->>'user_id'=scope->>'user_id' and a->>'tenant_id'=scope->>'tenant_id'
        and a->>'source_system'=scope->>'source_system' and a->>'invoice_source_id'=scope->>'invoice_source_id' then a end,
      context.amount_due_native, coalesce(context.is_open,false)) is distinct from
      collection_dependency_private.dispute_coverage(
      case when b->>'user_id'=scope->>'user_id' and b->>'tenant_id'=scope->>'tenant_id'
        and b->>'source_system'=scope->>'source_system' and b->>'invoice_source_id'=scope->>'invoice_source_id' then b end,
      context.amount_due_native, coalesce(context.is_open,false));
    if financial then
      perform collection_dependency_private.advance_financial((scope->>'user_id')::uuid,
        scope->>'tenant_id', scope->>'source_system', array[context.customer_source_id]);
    else
      perform collection_dependency_private.advance_projection((scope->>'user_id')::uuid,
        scope->>'tenant_id', scope->>'source_system');
    end if;
  end loop;
  return null;
end $$;
create trigger collection_dependency_disputes after insert or update or delete on public.invoice_disputes
  for each row execute function collection_dependency_private.dispute_changed();

create function collection_dependency_private.promise_changed()
returns trigger language plpgsql security definer set search_path = pg_catalog as $$
declare a jsonb; b jsonb; scope jsonb; context record; disputed numeric; financial boolean;
begin
  if tg_op <> 'INSERT' then a := to_jsonb(old); end if;
  if tg_op <> 'DELETE' then b := to_jsonb(new); end if;
  scope := coalesce(b,a);
  -- Evaluation provenance alone is not a feature/projection input. Paid totals
  -- still enter the financial comparison, even without a lifecycle event.
  if (a - array['revision','updated_at','evaluated_at','evaluated_sync_run_id']) is not distinct from
     (b - array['revision','updated_at','evaluated_at','evaluated_sync_run_id']) then return null; end if;
  perform collection_dependency_private.lock_financial_scope((scope->>'user_id')::uuid, scope->>'tenant_id', scope->>'source_system');
  select * into context from collection_dependency_private.invoice_context(
    (scope->>'user_id')::uuid, scope->>'tenant_id', scope->>'source_system', scope->>'invoice_source_id');
  select collection_dependency_private.dispute_coverage(to_jsonb(d), context.amount_due_native, coalesce(context.is_open,false))
    into disputed from public.invoice_disputes d where d.user_id=(scope->>'user_id')::uuid and d.tenant_id=scope->>'tenant_id'
      and d.source_system=scope->>'source_system' and d.invoice_source_id=scope->>'invoice_source_id';
  financial := collection_dependency_private.promise_signature(a,context.amount_due_native,coalesce(disputed,0),coalesce(context.is_open,false))
    is distinct from collection_dependency_private.promise_signature(b,context.amount_due_native,coalesce(disputed,0),coalesce(context.is_open,false));
  if financial then
    perform collection_dependency_private.advance_financial((scope->>'user_id')::uuid,
      scope->>'tenant_id',scope->>'source_system',array[scope->>'customer_source_id']);
  else
    perform collection_dependency_private.advance_projection((scope->>'user_id')::uuid,scope->>'tenant_id',scope->>'source_system');
  end if;
  return null;
end $$;
create trigger collection_dependency_promises after insert or update or delete on public.invoice_promises
  for each row execute function collection_dependency_private.promise_changed();

create function collection_dependency_private.projection_changed()
returns trigger language plpgsql security definer set search_path = pg_catalog as $$
declare a jsonb; b jsonb; scope jsonb; scopes jsonb;
begin
  if tg_op <> 'INSERT' then a := to_jsonb(old); end if;
  if tg_op <> 'DELETE' then b := to_jsonb(new); end if;
  if (a - 'updated_at') is not distinct from (b - 'updated_at') then return null; end if;
  -- Overrides predate provider columns; their effective provider is Xero.
  scopes := jsonb_build_array(
    case when a is not null then jsonb_build_object('user',a->>'user_id','tenant',a->>'tenant_id','source',coalesce(a->>'source_system','xero')) end,
    case when b is not null then jsonb_build_object('user',b->>'user_id','tenant',b->>'tenant_id','source',coalesce(b->>'source_system','xero')) end);
  for scope in select value from (select distinct value from jsonb_array_elements(scopes)
    where value <> 'null'::jsonb) candidates order by value::text loop
    perform collection_dependency_private.advance_projection((scope->>'user')::uuid,scope->>'tenant',scope->>'source');
  end loop;
  return null;
end $$;
create trigger collection_dependency_overrides after insert or update or delete on public.customer_overrides
  for each row execute function collection_dependency_private.projection_changed();
create trigger collection_dependency_actions after insert or update or delete on public.collection_actions
  for each row execute function collection_dependency_private.projection_changed();

create function collection_dependency_private.generation_changed()
returns trigger language plpgsql security definer set search_path = pg_catalog as $$
declare a uuid; b uuid; owner_id uuid; tenant text;
begin
  if tg_op <> 'INSERT' then a := old.active_sync_run_id; owner_id := old.user_id; tenant := old.tenant_id; end if;
  if tg_op <> 'DELETE' then b := new.active_sync_run_id; owner_id := new.user_id; tenant := new.tenant_id; end if;
  if a is not distinct from b then return null; end if;
  perform collection_dependency_private.lock_financial_scope(owner_id,tenant,'xero');
  -- G invalidates customer accounting bases. No mass customer increment.
  perform collection_dependency_private.advance_financial(owner_id,tenant,'xero');
  return null;
end $$;
create trigger collection_dependency_generation after insert or update or delete on public.xero_sync_tenant_state
  for each row execute function collection_dependency_private.generation_changed();

-- Certification normally happens only on a candidate and is covered by G at
-- publication. Defensively cover a changed certificate on the *active* run:
-- availability is customer-wide, so every current customer's credit feature can
-- change even when its balance is zero. This is not generation publication.
create function collection_dependency_private.credit_certificate_changed()
returns trigger language plpgsql security definer set search_path = pg_catalog as $$
declare a jsonb; b jsonb; scope jsonb; current_run uuid; customers text[];
begin
  if tg_op <> 'INSERT' then a := to_jsonb(old); end if;
  if tg_op <> 'DELETE' then b := to_jsonb(new); end if;
  scope := coalesce(b,a);
  if (a->'readiness_state',a->'reason_code',a->'consistency_result',a->'contract_version',a->'invoice_money_contract_version')
    is not distinct from
     (b->'readiness_state',b->'reason_code',b->'consistency_result',b->'contract_version',b->'invoice_money_contract_version') then return null; end if;
  perform collection_dependency_private.lock_financial_scope((scope->>'user_id')::uuid,scope->>'tenant_id',scope->>'source_system');
  select active_sync_run_id into current_run from public.xero_sync_tenant_state
    where user_id=(scope->>'user_id')::uuid and tenant_id=scope->>'tenant_id';
  if current_run is distinct from (scope->>'sync_run_id')::uuid then return null; end if;
  select array_agg(distinct source_id order by source_id) into customers from public.canonical_customers
    where user_id=(scope->>'user_id')::uuid and tenant_id=scope->>'tenant_id' and source_system=scope->>'source_system' and sync_run_id=current_run;
  perform collection_dependency_private.advance_financial((scope->>'user_id')::uuid,scope->>'tenant_id',scope->>'source_system',coalesce(customers,'{}'));
  return null;
end $$;
create trigger collection_dependency_credit after insert or update or delete on public.xero_customer_credit_validations
  for each row execute function collection_dependency_private.credit_certificate_changed();

-- One SQL snapshot obtains G/F/P/rCustomer together. Bigints are decimal text,
-- never JSON numbers subject to JavaScript precision loss. Missing rows mean 0;
-- missing migration/functions remain errors, never fabricated zeros.
create function public.read_collection_dependencies(p_user_id uuid,p_tenant_id text,p_source_system text,p_customer_source_id text default null)
returns jsonb language sql stable security invoker set search_path = pg_catalog as $$
  select jsonb_build_object('userId',p_user_id,'tenantId',p_tenant_id,'sourceSystem',p_source_system,
    'generationId',s.active_sync_run_id,'generationStatus',r.status,'financialEpoch',coalesce(h.financial_epoch,0)::text,
    'projectionRevision',coalesce(h.projection_revision,0)::text,
    'customerFinancialRevision',case when p_customer_source_id is not null then coalesce(c.financial_revision,0)::text end,
    'customerSourceId',p_customer_source_id)
  from (values(1)) one(dummy)
  left join public.xero_sync_tenant_state s on p_source_system='xero' and s.user_id=p_user_id and s.tenant_id=p_tenant_id
  left join public.xero_sync_runs r on r.id=s.active_sync_run_id and r.user_id=p_user_id and r.tenant_id=p_tenant_id
  left join public.collection_dependency_heads h on h.user_id=p_user_id and h.tenant_id=p_tenant_id and h.source_system=p_source_system
  left join public.collection_customer_financial_revisions c on c.user_id=p_user_id and c.tenant_id=p_tenant_id
    and c.source_system=p_source_system and c.customer_source_id=p_customer_source_id;
$$;
revoke all on function public.read_collection_dependencies(uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.read_collection_dependencies(uuid,text,text,text) to service_role;
revoke all on all functions in schema collection_dependency_private from public,anon,authenticated,service_role;

-- Preserve commands/evaluation exactly; align the two older entry-point locks
-- with promotion and commit_invoice_promise_request before touching Promise rows.
create or replace function public.apply_invoice_promise_command(
  p_user_id uuid,p_tenant_id text,p_command_id uuid,p_operation text,p_promise_id uuid,
  p_expected_revision bigint,p_actor_kind text,p_actor_user_id uuid,p_payload jsonb
) returns jsonb language plpgsql security definer set search_path = pg_catalog as $$
begin
  perform 1 from public.xero_sync_tenant_state where user_id=p_user_id and tenant_id=p_tenant_id for update;
  perform public.lock_invoice_promise_tenant(p_user_id,p_tenant_id);
  return public.apply_invoice_promise_command_internal(p_user_id,p_tenant_id,p_command_id,p_operation,
    p_promise_id,p_expected_revision,p_actor_kind,p_actor_user_id,p_payload);
end $$;

-- System evaluation only: no lifecycle event, terms, status or baseline inputs.
-- Generation/facts are the natural idempotency identity for this internal command.
create or replace function public.record_invoice_promise_evaluation(
  p_user_id uuid,p_tenant_id text,p_promise_id uuid,p_expected_revision bigint,
  p_sync_run_id uuid,p_paid_amount_native text,p_evaluated_at timestamptz
) returns boolean language plpgsql security definer set search_path = pg_catalog as $$
declare v_row public.invoice_promises; v_paid numeric;
begin
  perform 1 from public.xero_sync_tenant_state where user_id=p_user_id and tenant_id=p_tenant_id for update;
  perform public.lock_invoice_promise_tenant(p_user_id,p_tenant_id);
  if p_paid_amount_native is null or p_expected_revision is null or p_expected_revision <= 0
     or p_evaluated_at is null or not isfinite(p_evaluated_at) or p_evaluated_at > clock_timestamp() then
    raise exception 'invoice_promise_invalid_evaluation' using errcode='22023'; end if;
  v_paid := p_paid_amount_native::numeric;
  if not (v_paid >= 0 and v_paid < 'Infinity'::numeric) then
    raise exception 'invoice_promise_invalid_evaluation' using errcode='22023'; end if;
  if not exists(select 1 from public.xero_sync_runs r join public.xero_sync_tenant_state s
      on s.user_id=r.user_id and s.tenant_id=r.tenant_id and s.active_sync_run_id=r.id
      where r.id=p_sync_run_id and r.user_id=p_user_id and r.tenant_id=p_tenant_id and r.status='succeeded')
     or not (public.inspect_xero_accounting_evidence(p_sync_run_id,p_user_id,p_tenant_id)->>'ready')::boolean then
    raise exception 'invoice_promise_provenance_mismatch' using errcode='23503'; end if;
  if not exists(select 1 from public.xero_accounting_evidence_observations o where o.sync_run_id=p_sync_run_id
      and o.user_id=p_user_id and o.tenant_id=p_tenant_id and o.resource='payments' and o.complete
      and p_evaluated_at in (date_trunc('milliseconds',o.completed_at),
        (select date_trunc('milliseconds',max(completed_at)) from public.xero_accounting_evidence_observations
          where sync_run_id=p_sync_run_id and user_id=p_user_id and tenant_id=p_tenant_id))) then
    raise exception 'invoice_promise_evaluation_time_invalid' using errcode='22023';end if;
  select * into v_row from public.invoice_promises where id=p_promise_id and user_id=p_user_id and tenant_id=p_tenant_id for update;
  if not found or v_row.status<>'active' or v_row.source_system<>'xero' then
    raise exception 'invoice_promise_revision_conflict' using errcode='40001'; end if;
  if v_row.qualifying_paid_amount_native=v_paid and v_row.evaluated_sync_run_id=p_sync_run_id and v_row.evaluated_at=p_evaluated_at then
    return false; -- Uncertain identical retry: no revision churn or event.
  end if;
  if v_row.revision<>p_expected_revision then raise exception 'invoice_promise_revision_conflict' using errcode='40001'; end if;
  update public.invoice_promises set qualifying_paid_amount_native=v_paid,evaluated_sync_run_id=p_sync_run_id,evaluated_at=p_evaluated_at where id=v_row.id;
  return true;
end $$;
