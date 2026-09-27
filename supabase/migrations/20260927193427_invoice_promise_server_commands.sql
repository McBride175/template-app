-- Phase 6: scoped authenticated-server commands. No browser database grants.
-- Preserve the Phase 2 command validations; extend its private executor solely
-- for multiple ordered events carrying one user-intent fingerprint.
create function public.apply_invoice_promise_request_step(
  p_user_id uuid, p_tenant_id text, p_command_id uuid, p_operation text,
  p_promise_id uuid, p_expected_revision bigint, p_actor_kind text, p_actor_user_id uuid, p_payload jsonb,
  p_request_fingerprint text, p_command_event_sequence bigint
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
  if p_command_event_sequence is null or (p_request_fingerprint is not null and p_request_fingerprint !~ '^[a-f0-9]{64}$') or p_command_event_sequence < 1 then
    raise exception 'invoice_promise_invalid_request' using errcode='22023';end if;
  v_fingerprint := coalesce(p_request_fingerprint,v_fingerprint);
  -- Serializes an uncertain retry before creation generates a new Promise ID.
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text || ':' || p_command_id::text,0));
  select * into v_event from public.invoice_promise_events
    where user_id = p_user_id and command_id = p_command_id and command_event_sequence=p_command_event_sequence limit 1;
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
    effective_at,evidence,source_sync_run_id,resolver_version,command_event_sequence)
  values (v_row.id,p_user_id,p_tenant_id,
    coalesce((select max(event_sequence) from public.invoice_promise_events where promise_id = v_row.id),0)+1,
    v_row.revision,case p_operation when 'create' then 'created' when 'change_terms' then 'changed'
      when 'change_note' then 'note_changed' when 'cancel' then 'cancelled' else v_status end,
    p_actor_kind,p_actor_user_id,v_before,public.invoice_promise_terms(v_row),p_command_id,v_fingerprint,
    v_effective,case when p_operation = 'resolve' then p_payload->'evidence' end,
    case when p_operation = 'resolve' then v_run end,
    case when p_operation = 'resolve' then p_payload->>'resolution_contract_version' end,p_command_event_sequence)
  returning * into v_event;
  return jsonb_build_object('promise_id',v_row.id,'revision',v_row.revision,
    'status',v_row.status,'event_sequence',v_event.event_sequence);
end $$;

-- Both existing single-event callers and Phase 6 use the same validated core.
-- Legacy fingerprints remain computed from the original normalized arguments.
create or replace function public.apply_invoice_promise_command_internal(
  p_user_id uuid,p_tenant_id text,p_command_id uuid,p_operation text,p_promise_id uuid,
  p_expected_revision bigint,p_actor_kind text,p_actor_user_id uuid,p_payload jsonb
) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
begin
 return public.apply_invoice_promise_request_step(p_user_id,p_tenant_id,p_command_id,p_operation,
   p_promise_id,p_expected_revision,p_actor_kind,p_actor_user_id,p_payload,null,1);
end $$;

create function public.invoice_promise_server_row(p public.invoice_promises)
returns jsonb language sql immutable set search_path=pg_catalog as $$
 select to_jsonb(p)||jsonb_build_object('promised_amount_native',trim_scale(p.promised_amount_native)::text,
   'qualifying_paid_amount_native',trim_scale(p.qualifying_paid_amount_native)::text,'revision',p.revision::text);
$$;

create function public.read_invoice_promise_request(p_user uuid,p_tenant text,p_command uuid,p_intent jsonb)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
declare e public.invoice_promise_events; fingerprint text;
begin
 fingerprint:=encode(sha256(convert_to(jsonb_build_object('version',1,'user',p_user,'tenant',p_tenant,'intent',p_intent)::text,'UTF8')),'hex');
 select * into e from public.invoice_promise_events where user_id=p_user and command_id=p_command order by command_event_sequence desc limit 1;
 if not found then return null;end if;
 if e.tenant_id<>p_tenant or e.command_fingerprint<>fingerprint then raise exception 'invoice_promise_command_conflict' using errcode='23505';end if;
 return jsonb_build_object('promise',(select public.invoice_promise_server_row(p) from public.invoice_promises p where id=e.promise_id and user_id=p_user and tenant_id=p_tenant),
 'events',(select jsonb_agg(jsonb_build_object('id',id,'event_sequence',event_sequence::text,'event_type',event_type,
 'occurred_at',occurred_at,'effective_at',effective_at,'before_terms',before_terms,'after_terms',after_terms,'actor_kind',actor_kind) order by command_event_sequence)
 from public.invoice_promise_events where user_id=p_user and command_id=p_command),'replayed',true);
end $$;

-- One SQL statement holds the generation for all reads. Commit rechecks it under
-- the same state-row -> tenant advisory lock order used by accounting promotion.
create function public.prepare_invoice_promise_request(p_user uuid,p_tenant text,p_invoice text,p_promise uuid,p_financial boolean)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
declare run uuid; invoice jsonb; promise jsonb; evidence jsonb; observation jsonb; value jsonb;
begin
 select s.active_sync_run_id into run from public.xero_sync_tenant_state s join public.xero_sync_runs r on r.id=s.active_sync_run_id and r.user_id=s.user_id and r.tenant_id=s.tenant_id and r.status='succeeded'
 where s.user_id=p_user and s.tenant_id=p_tenant;
 if run is null then raise exception 'invoice_promise_accounting_unavailable' using errcode='55000';end if;
 if p_promise is not null then
   select public.invoice_promise_server_row(p) into promise from public.invoice_promises p where id=p_promise and user_id=p_user and tenant_id=p_tenant and source_system='xero';
   if promise is null then raise exception 'invoice_promise_not_found' using errcode='P0002';end if;
   p_invoice:=promise->>'invoice_source_id';
 end if;
 select jsonb_build_object('user_id',user_id,'tenant_id',tenant_id,'source_system',source_system,'source_id',source_id,
 'customer_source_id',customer_source_id,'type',type,'status',status,'amount_due_native',amount_due_native::text,
 'transaction_currency_code',transaction_currency_code,'organisation_base_currency_code',organisation_base_currency_code,
 'xero_currency_rate',xero_currency_rate::text,'currency_conversion_status',currency_conversion_status,'sync_run_id',sync_run_id)
 into invoice from public.canonical_invoices where user_id=p_user and tenant_id=p_tenant and sync_run_id=run and source_system='xero' and source_id=p_invoice;
 if p_promise is null or p_financial then
 observation:=public.inspect_xero_accounting_evidence(run,p_user,p_tenant);
 -- Readiness must also agree with actual generation row counts.
 observation:=observation||jsonb_build_object('ready',coalesce((observation->>'ready')::boolean,false) and not exists(
 select 1 from public.xero_accounting_evidence_observations o where o.sync_run_id=run and o.user_id=p_user and o.tenant_id=p_tenant
 and o.mapped_count<>case o.resource when 'payments' then (select count(*) from public.canonical_payment_evidence where sync_run_id=run and user_id=p_user and tenant_id=p_tenant)
 else (select count(*) from public.canonical_unapplied_cash_evidence where sync_run_id=run and user_id=p_user and tenant_id=p_tenant and source_kind=case o.resource when 'overpayments' then 'overpayment' else 'prepayment' end) end));
 observation:=observation||jsonb_build_object('sync_run_id',run,'user_id',p_user,'tenant_id',p_tenant,'source_system','xero','status','succeeded','authoritative',true,
 'organisation_base_currency_code',(select base_currency_code from public.canonical_organisations where user_id=p_user and tenant_id=p_tenant and sync_run_id=run));
 end if; -- Note/cancel only need held identity, not evidence readiness/count scans.
 if p_financial then
  evidence:=jsonb_build_object('payments',coalesce((select jsonb_agg(to_jsonb(p) order by source_id) from public.canonical_payment_evidence_exact p where user_id=p_user and tenant_id=p_tenant and sync_run_id=run),'[]'::jsonb),
  'cash',coalesce((select jsonb_agg(to_jsonb(c) order by source_kind,source_id) from public.canonical_unapplied_cash_evidence_exact c where user_id=p_user and tenant_id=p_tenant and sync_run_id=run),'[]'::jsonb));
 end if;
 value:=jsonb_build_object('sync_run_id',run,'invoice',invoice,'promise',promise,'observation',observation,'evidence',evidence,
 'payment_ids',case when p_promise is not null then '[]'::jsonb else coalesce((select jsonb_agg(source_id order by source_id) from public.canonical_payment_evidence where user_id=p_user and tenant_id=p_tenant and sync_run_id=run and source_system='xero' and invoice_source_id=p_invoice),'[]'::jsonb) end);
 return value||jsonb_build_object('digest',encode(sha256(convert_to(value::text,'UTF8')),'hex'));
end $$;

create function public.commit_invoice_promise_request(p_user uuid,p_tenant text,p_command uuid,p_intent jsonb,p_run uuid,p_digest text,p_steps jsonb,p_evaluation jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare held jsonb; replay jsonb; step jsonb; result jsonb; id uuid; rev bigint; seq bigint:=0; fingerprint text; op text;
begin
 if p_user is null or nullif(btrim(p_tenant),'') is null or p_command is null or jsonb_typeof(p_intent)<>'object'
 or p_intent->>'operation' not in ('create','edit','cancel') or jsonb_typeof(p_steps)<>'array' or jsonb_array_length(p_steps) not between 1 and 3 then
 raise exception 'invoice_promise_invalid_request' using errcode='22023';end if;
 perform 1 from public.xero_sync_tenant_state where user_id=p_user and tenant_id=p_tenant for update;
 perform public.lock_invoice_promise_tenant(p_user,p_tenant);
 perform pg_advisory_xact_lock(hashtextextended(p_user::text||':'||p_command::text,0));
 replay:=public.read_invoice_promise_request(p_user,p_tenant,p_command,p_intent);
 if replay is not null then return replay;end if;
 held:=public.prepare_invoice_promise_request(p_user,p_tenant,p_intent->>'invoiceSourceId',(p_intent->>'promiseId')::uuid,
   p_intent->>'operation'='edit' and (p_intent ? 'amount' or p_intent ? 'promisedDate'));
 if held->>'sync_run_id' is distinct from p_run::text or held->>'digest' is distinct from p_digest then
 raise exception 'invoice_promise_snapshot_conflict' using errcode='40001';end if;
 id:=(p_intent->>'promiseId')::uuid;rev:=(p_intent->>'expectedRevision')::bigint;
 if p_intent->>'operation'='create' and (held->'observation'->>'ready')::boolean is distinct from true then
 raise exception 'invoice_promise_evidence_unavailable' using errcode='55000';end if;
 fingerprint:=encode(sha256(convert_to(jsonb_build_object('version',1,'user',p_user,'tenant',p_tenant,'intent',p_intent)::text,'UTF8')),'hex');
 for step in select value from jsonb_array_elements(p_steps) loop
  seq:=seq+1;op:=step->>'operation';
  if (p_intent->>'operation'='create' and (seq<>1 or op<>'create'))
   or (p_intent->>'operation'='cancel' and (seq<>1 or op<>'cancel'))
   or (p_intent->>'operation'='edit' and op not in ('change_terms','change_note','resolve'))
   or (op='resolve' and (step->'payload'->>'status' not in ('kept','missed','unclear') or step->'payload'->>'evaluated_sync_run_id'<>p_run::text)) then
   raise exception 'invoice_promise_invalid_request_step' using errcode='22023';end if;
  -- Bind authoritative derived inputs and edited user terms to the prepared intent.
  if op='create' and (step->'payload'->>'invoice_source_id' is distinct from held->'invoice'->>'source_id'
    or step->'payload'->>'customer_source_id' is distinct from held->'invoice'->>'customer_source_id'
    or step->'payload'->>'currency_code' is distinct from held->'invoice'->>'transaction_currency_code'
    or step->'payload'->>'source_system' is distinct from 'xero'
    or step->'payload'->>'creation_sync_run_id' is distinct from p_run::text
    or step->'payload'->'payment_baseline'->'payment_ids' is distinct from held->'payment_ids'
    or (step->'payload'->>'promised_amount_native')::numeric>(held->'invoice'->>'amount_due_native')::numeric) then
    raise exception 'invoice_promise_creation_context_conflict' using errcode='40001';end if;
  if op in ('create','change_terms') and (
    step->'payload'->>'promised_amount_native' is distinct from coalesce(p_intent->>'amount',held->'promise'->>'promised_amount_native')
    or step->'payload'->>'promised_date' is distinct from coalesce(p_intent->>'promisedDate',held->'promise'->>'promised_date')) then
    raise exception 'invoice_promise_intent_conflict' using errcode='22023';end if;
  if op='change_note' and step->'payload'->'note' is distinct from p_intent->'note' then
    raise exception 'invoice_promise_intent_conflict' using errcode='22023';end if;
  result:=public.apply_invoice_promise_request_step(p_user,p_tenant,p_command,op,id,rev,
   case when op='resolve' then 'system' else 'user' end,case when op='resolve' then null else p_user end,step->'payload',fingerprint,seq);
  id:=(result->>'promise_id')::uuid;rev:=(result->>'revision')::bigint;
 end loop;
 if p_evaluation is not null then
  if p_intent->>'operation'<>'edit' or not (p_intent ? 'amount' or p_intent ? 'promisedDate') or op='resolve' then raise exception 'invoice_promise_invalid_evaluation' using errcode='22023';end if;
  perform public.record_invoice_promise_evaluation(p_user,p_tenant,id,rev,p_run,p_evaluation->>'qualifying_paid_amount_native',(p_evaluation->>'evaluated_at')::timestamptz);
 end if;
 return public.read_invoice_promise_request(p_user,p_tenant,p_command,p_intent)||jsonb_build_object('replayed',false);
end $$;

create function public.read_invoice_promises(p_user uuid,p_tenant text,p_invoice text,p_history boolean default false,p_limit integer default 20)
returns jsonb language sql stable security definer set search_path=pg_catalog as $$
 select coalesce(jsonb_agg(public.invoice_promise_server_row(p) order by created_at desc,id),'[]'::jsonb) from
 (select * from public.invoice_promises where user_id=p_user and tenant_id=p_tenant and source_system='xero' and invoice_source_id=p_invoice and (p_history or status='active') order by (status='active') desc,created_at desc,id limit least(greatest(p_limit,1),50)) p;
$$;
create function public.read_invoice_promise_history(p_user uuid,p_tenant text,p_promise uuid,p_limit integer default 50)
returns jsonb language sql stable security definer set search_path=pg_catalog as $$
 select coalesce(jsonb_agg(value order by sequence desc),'[]'::jsonb) from
 (select event_sequence as sequence,jsonb_build_object('id',id,'event_sequence',event_sequence::text,'event_type',event_type,'occurred_at',occurred_at,'effective_at',effective_at,'before_terms',before_terms,'after_terms',after_terms,'actor_kind',actor_kind) as value
 from public.invoice_promise_events where user_id=p_user and tenant_id=p_tenant and promise_id=p_promise order by event_sequence desc limit least(greatest(p_limit,1),100)) e;
$$;
revoke all on function public.invoice_promise_server_row(public.invoice_promises),public.apply_invoice_promise_request_step(uuid,text,uuid,text,uuid,bigint,text,uuid,jsonb,text,bigint) from public,anon,authenticated,service_role;
revoke all on function public.read_invoice_promise_request(uuid,text,uuid,jsonb),public.prepare_invoice_promise_request(uuid,text,text,uuid,boolean),public.commit_invoice_promise_request(uuid,text,uuid,jsonb,uuid,text,jsonb,jsonb),public.read_invoice_promises(uuid,text,text,boolean,integer),public.read_invoice_promise_history(uuid,text,uuid,integer) from public,anon,authenticated,service_role;
grant execute on function public.read_invoice_promise_request(uuid,text,uuid,jsonb),public.prepare_invoice_promise_request(uuid,text,text,uuid,boolean),public.commit_invoice_promise_request(uuid,text,uuid,jsonb,uuid,text,jsonb,jsonb),public.read_invoice_promises(uuid,text,text,boolean,integer),public.read_invoice_promise_history(uuid,text,uuid,integer) to service_role;
