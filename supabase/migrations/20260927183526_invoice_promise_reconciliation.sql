-- Phase 5B: pure TypeScript decisions, atomically applied at fenced promotion.
-- No new Promise terms, evidence tables, queue inputs or browser capabilities.
create function public.lock_invoice_promise_tenant(p_user_id uuid,p_tenant_id text)
returns void language sql set search_path = pg_catalog as $$
  select pg_advisory_xact_lock(hashtextextended('invoice-promises:' || p_user_id::text || ':' || p_tenant_id,0));
$$;

-- Acquire the tenant lock BEFORE any Promise row/command lock, including creates.
-- The original implementation and all its validation/history checks are retained.
alter function public.apply_invoice_promise_command(uuid,text,uuid,text,uuid,bigint,text,uuid,jsonb)
  rename to apply_invoice_promise_command_internal;
revoke all on function public.apply_invoice_promise_command_internal(uuid,text,uuid,text,uuid,bigint,text,uuid,jsonb)
  from public,anon,authenticated,service_role;
create function public.apply_invoice_promise_command(
  p_user_id uuid,p_tenant_id text,p_command_id uuid,p_operation text,p_promise_id uuid,
  p_expected_revision bigint,p_actor_kind text,p_actor_user_id uuid,p_payload jsonb
) returns jsonb language plpgsql security definer set search_path = pg_catalog as $$
begin
  perform public.lock_invoice_promise_tenant(p_user_id,p_tenant_id);
  return public.apply_invoice_promise_command_internal(p_user_id,p_tenant_id,p_command_id,p_operation,
    p_promise_id,p_expected_revision,p_actor_kind,p_actor_user_id,p_payload);
end $$;

-- System evaluation only: no lifecycle event, terms, status or baseline inputs.
-- Generation/facts are the natural idempotency identity for this internal command.
create function public.record_invoice_promise_evaluation(
  p_user_id uuid,p_tenant_id text,p_promise_id uuid,p_expected_revision bigint,
  p_sync_run_id uuid,p_paid_amount_native text,p_evaluated_at timestamptz
) returns boolean language plpgsql security definer set search_path = pg_catalog as $$
declare v_row public.invoice_promises; v_paid numeric;
begin
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

-- Single held snapshot; explicit numeric text prevents JSON floating-point loss.
-- Includes only domain inputs, never raw provider/customer contact payloads.
create function public.invoice_promise_reconciliation_snapshot(p_run uuid,p_user uuid,p_tenant text)
returns jsonb language sql stable security definer set search_path = pg_catalog as $$
with org as (
  select timezone_iana,base_currency_code from public.canonical_organisations
  where sync_run_id=p_run and user_id=p_user and tenant_id=p_tenant and source_system='xero'
), observations as (
  select coalesce(jsonb_agg(to_jsonb(o) order by resource),'[]'::jsonb) as rows,
    coalesce(count(*)=3 and bool_and(o.complete and o.source_count=o.mapped_count
      and o.mapped_count=case o.resource when 'payments' then
        (select count(*) from public.canonical_payment_evidence where sync_run_id=p_run and user_id=p_user and tenant_id=p_tenant)
      else (select count(*) from public.canonical_unapplied_cash_evidence where sync_run_id=p_run and user_id=p_user and tenant_id=p_tenant
        and source_kind=case o.resource when 'overpayments' then 'overpayment' else 'prepayment' end) end),false) as complete
  from public.xero_accounting_evidence_observations o where sync_run_id=p_run and user_id=p_user and tenant_id=p_tenant
), facts as (
  select jsonb_build_object(
    'observation',jsonb_build_object('sync_run_id',p_run,'user_id',p_user,'tenant_id',p_tenant,'source_system','xero',
      'contract_version','promise_accounting_evidence_v1',
      -- Conditional authority: these facts become authoritative ONLY if commit succeeds.
      'status',case when observations.complete and org.timezone_iana is not null then 'succeeded' else 'candidate' end,
      'authoritative',observations.complete and org.timezone_iana is not null,
      'ready',observations.complete and org.timezone_iana is not null,
      'timezone_iana',org.timezone_iana,'organisation_base_currency_code',org.base_currency_code,'resources',observations.rows),
    'payments',coalesce((select jsonb_agg(to_jsonb(p) order by source_id) from public.canonical_payment_evidence_exact p
      where sync_run_id=p_run and user_id=p_user and tenant_id=p_tenant),'[]'::jsonb),
    'cash',coalesce((select jsonb_agg(to_jsonb(c) order by source_kind,source_id) from public.canonical_unapplied_cash_evidence_exact c
      where sync_run_id=p_run and user_id=p_user and tenant_id=p_tenant),'[]'::jsonb),
    'invoices',coalesce((select jsonb_agg(jsonb_build_object('sync_run_id',p_run,'user_id',p_user,'tenant_id',p_tenant,'source_system',source_system,
      'invoice_source_id',source_id,'customer_source_id',customer_source_id,'type',type,
      'currency_code',transaction_currency_code,'organisation_base_currency_code',organisation_base_currency_code,
      'xero_currency_rate',xero_currency_rate::text,'currency_conversion_status',currency_conversion_status) order by source_id)
      from public.canonical_invoices where sync_run_id=p_run and user_id=p_user and tenant_id=p_tenant),'[]'::jsonb)
  ) as value from observations left join org on true
)
select jsonb_build_object('facts',facts.value,'evidence_digest',encode(sha256(convert_to(facts.value::text,'UTF8')),'hex'),
  'promises',coalesce((select jsonb_agg(jsonb_build_object('id',id,'user_id',user_id,'tenant_id',tenant_id,'source_system',source_system,
    'invoice_source_id',invoice_source_id,'customer_source_id',customer_source_id,'currency_code',currency_code,'status',status,
    'promised_amount_native',trim_scale(promised_amount_native)::text,'qualifying_paid_amount_native',trim_scale(qualifying_paid_amount_native)::text,
    'revision',revision::text,'created_at',created_at,'promised_date',promised_date,'creation_sync_run_id',creation_sync_run_id,'payment_baseline',payment_baseline)
    order by id) from public.invoice_promises where user_id=p_user and tenant_id=p_tenant and source_system='xero' and status='active'),'[]'::jsonb)) from facts;
$$;

create function public.prepare_invoice_promise_reconciliation(p_sync_run_id uuid,p_lease_owner uuid,p_fencing_token bigint)
returns jsonb language plpgsql security definer set search_path = pg_catalog as $$
declare v_run public.xero_sync_runs;
begin
  select * into v_run from public.xero_sync_runs where id=p_sync_run_id;
  if not found then raise exception 'Xero generation not found'; end if;
  perform 1 from public.xero_sync_tenant_state where user_id=v_run.user_id and tenant_id=v_run.tenant_id for update;
  select * into v_run from public.xero_sync_runs where id=p_sync_run_id for update;
  if v_run.status='succeeded' then return jsonb_build_object('already_promoted',true,'promoted_at',v_run.completed_at);end if;
  perform public.assert_xero_generation_write_authority(p_sync_run_id,v_run.user_id,v_run.tenant_id,p_lease_owner,p_fencing_token);
  perform public.lock_invoice_promise_tenant(v_run.user_id,v_run.tenant_id);
  if not exists(select 1 from public.invoice_promises where user_id=v_run.user_id and tenant_id=v_run.tenant_id and source_system='xero' and status='active') then
    return jsonb_build_object('empty_active_set',true,'promises','[]'::jsonb);
  end if;
  return public.invoice_promise_reconciliation_snapshot(p_sync_run_id,v_run.user_id,v_run.tenant_id);
end $$;

-- Retain the proven promotion contract privately; no path may bypass reconciliation.
alter function public.promote_xero_sync_run(uuid,uuid,bigint,timestamptz) rename to promote_xero_sync_run_internal;
revoke all on function public.promote_xero_sync_run_internal(uuid,uuid,bigint,timestamptz) from public,anon,authenticated,service_role;

create function public.promote_xero_sync_run_with_promises(
  p_sync_run_id uuid,p_lease_owner uuid,p_fencing_token bigint,p_snapshot_as_of timestamptz,p_reconciliation jsonb
) returns table(promoted boolean,result_code text,promoted_at timestamptz)
language plpgsql security definer set search_path = pg_catalog as $$
declare v_run public.xero_sync_runs; v_snapshot jsonb; v_expected jsonb; v_actual jsonb;
  v_proposal jsonb; v_result jsonb; v_promoted record; v_id uuid; v_revision bigint; v_command uuid; v_hash text;
begin
  select * into v_run from public.xero_sync_runs where id=p_sync_run_id;
  if not found then return query select false,'run_not_found'::text,null::timestamptz;return;end if;
  -- Same lock order as all generation writers. Repeated/ambiguous commit is read-only.
  perform 1 from public.xero_sync_tenant_state where user_id=v_run.user_id and tenant_id=v_run.tenant_id for update;
  select * into v_run from public.xero_sync_runs where id=p_sync_run_id for update;
  if v_run.status='succeeded' then return query select true,'already_promoted'::text,v_run.completed_at;return;end if;
  if v_run.status<>'running' then
    -- Preserve the existing fence/supersession error precedence on failed or
    -- abandoned runs. That original contract cannot publish a non-running run.
    return query select * from public.promote_xero_sync_run_internal(p_sync_run_id,p_lease_owner,p_fencing_token,p_snapshot_as_of);return;
  end if;
  perform public.lock_invoice_promise_tenant(v_run.user_id,v_run.tenant_id);
  if p_reconciliation is null then
    if exists(select 1 from public.invoice_promises where user_id=v_run.user_id and tenant_id=v_run.tenant_id and source_system='xero' and status='active') then
      return query select false,'promise_preparation_required'::text,null::timestamptz;return;end if;
  else
    v_snapshot := public.invoice_promise_reconciliation_snapshot(p_sync_run_id,v_run.user_id,v_run.tenant_id);
    if jsonb_typeof(p_reconciliation) is distinct from 'object'
       or p_reconciliation-array['evidence_digest','proposals']<>'{}'
       or jsonb_typeof(p_reconciliation->'proposals') is distinct from 'array' then
      raise exception 'invoice_promise_invalid_proposals' using errcode='22023';end if;
    if p_reconciliation->>'evidence_digest' is distinct from v_snapshot->>'evidence_digest' then
      return query select false,'promise_evidence_changed'::text,null::timestamptz;return;end if;
    select coalesce(jsonb_agg(jsonb_build_object('id',p->>'id','revision',p->>'revision') order by p->>'id'),'[]') into v_expected
      from jsonb_array_elements(v_snapshot->'promises') p;
    select coalesce(jsonb_agg(jsonb_build_object('id',p->>'promise_id','revision',p->>'expected_revision') order by p->>'promise_id'),'[]') into v_actual
      from jsonb_array_elements(p_reconciliation->'proposals') p;
    if v_expected<>v_actual then return query select false,'promise_state_changed'::text,null::timestamptz;return;end if;
    -- The readiness requirement follows the exact Active set under the shared
    -- tenant lock. Never publish new balances with stale Promise paid totals.
    if jsonb_array_length(v_snapshot->'promises')>0
       and (v_snapshot->'facts'->'observation'->>'ready')::boolean is distinct from true then
      return query select false,'promise_evidence_not_ready'::text,null::timestamptz;return;
    end if;
  end if;

  select * into v_promoted from public.promote_xero_sync_run_internal(p_sync_run_id,p_lease_owner,p_fencing_token,p_snapshot_as_of);
  if not v_promoted.promoted then return query select v_promoted.promoted,v_promoted.result_code,v_promoted.promoted_at;return;end if;
  -- Promotion is still uncommitted. Any evaluation/event failure rolls it all back.
  for v_proposal in select value from jsonb_array_elements(coalesce(p_reconciliation->'proposals','[]')) loop
    if v_proposal-array['promise_id','expected_revision','result']<>'{}' then raise exception 'invoice_promise_invalid_proposal';end if;
    v_id := (v_proposal->>'promise_id')::uuid; v_revision := (v_proposal->>'expected_revision')::bigint;
    v_result := v_proposal->'result';
    if jsonb_typeof(v_result) is distinct from 'object' or v_result->>'decision' is null or v_result->>'decision' not in ('retain_active','kept','missed','unclear','defer') then
      raise exception 'invoice_promise_invalid_decision';end if;
    if v_result->'payment_evaluation_valid' is distinct from 'true'::jsonb then
      if v_result->>'decision'<>'defer' or v_result->'transition_required' is distinct from 'false'::jsonb then raise exception 'invoice_promise_uncertified_result';end if;
      continue;
    end if;
    if v_result->>'source_sync_run_id' is distinct from p_sync_run_id::text
       or v_result->>'resolver_version' is distinct from 'promise_resolution_v1'
       or jsonb_typeof(v_result->'qualifying_paid_amount_native') is distinct from 'string'
       or jsonb_typeof(v_result->'evaluated_at') is distinct from 'string' then raise exception 'invoice_promise_result_provenance_invalid';end if;
    if v_result->>'decision' in ('kept','missed','unclear') then
      if v_result->'transition_required' is distinct from 'true'::jsonb or v_result->'terminal' is distinct from 'true'::jsonb
         or jsonb_typeof(v_result->'evidence') is distinct from 'object'
         or v_result->'evidence'->>'source_sync_run_id' is distinct from p_sync_run_id::text
         or v_result->'evidence'->>'qualifying_paid_amount_native' is distinct from v_result->>'qualifying_paid_amount_native'
         or v_result->'evidence'->>'reason_code' is distinct from v_result->>'reason_code'
         or v_result->'evidence'->>'resolver_version' is distinct from v_result->>'resolver_version'
         or not exists(select 1 from public.invoice_promises p where p.id=v_id and p.user_id=v_run.user_id and p.tenant_id=v_run.tenant_id
           and p.promised_amount_native=(v_result->'evidence'->>'promised_amount_native')::numeric
           and p.promised_date::text=v_result->'evidence'->>'promised_date' and p.currency_code=v_result->'evidence'->>'currency_code') then
        raise exception 'invoice_promise_terminal_result_invalid';end if;
      v_hash := encode(sha256(convert_to('promise-resolution:' || p_sync_run_id::text || ':' || v_id::text || ':' || v_revision::text,'UTF8')),'hex');
      v_command := (substr(v_hash,1,8)||'-'||substr(v_hash,9,4)||'-'||substr(v_hash,13,4)||'-'||substr(v_hash,17,4)||'-'||substr(v_hash,21,12))::uuid;
      perform public.apply_invoice_promise_command(v_run.user_id,v_run.tenant_id,v_command,'resolve',v_id,v_revision,'system',null,
        jsonb_build_object('status',v_result->>'decision','qualifying_paid_amount_native',v_result->>'qualifying_paid_amount_native',
          'evaluated_sync_run_id',p_sync_run_id,'evaluated_at',v_result->>'evaluated_at','resolution_reason_code',v_result->>'reason_code',
          'resolution_contract_version',v_result->>'resolver_version','effective_at',v_result->'effective_at','evidence',v_result->'evidence'));
    else
      if v_result->'transition_required' is distinct from 'false'::jsonb or v_result->'terminal' is distinct from 'false'::jsonb then
        raise exception 'invoice_promise_nonterminal_result_invalid';end if;
      perform public.record_invoice_promise_evaluation(v_run.user_id,v_run.tenant_id,v_id,v_revision,p_sync_run_id,
        v_result->>'qualifying_paid_amount_native',(v_result->>'evaluated_at')::timestamptz);
    end if;
  end loop;
  return query select v_promoted.promoted,v_promoted.result_code,v_promoted.promoted_at;
end $$;

-- Backwards-compatible empty-Promise call, with an explicit guard against bypass.
create function public.promote_xero_sync_run(p_sync_run_id uuid,p_lease_owner uuid,p_fencing_token bigint,p_snapshot_as_of timestamptz default null)
returns table(promoted boolean,result_code text,promoted_at timestamptz)
language sql security definer set search_path = pg_catalog, public as $$
  select * from public.promote_xero_sync_run_with_promises(p_sync_run_id,p_lease_owner,p_fencing_token,p_snapshot_as_of,null);
$$;

revoke all on function public.lock_invoice_promise_tenant(uuid,text),public.invoice_promise_reconciliation_snapshot(uuid,uuid,text)
  from public,anon,authenticated,service_role;
revoke all on function public.apply_invoice_promise_command(uuid,text,uuid,text,uuid,bigint,text,uuid,jsonb),
  public.record_invoice_promise_evaluation(uuid,text,uuid,bigint,uuid,text,timestamptz),
  public.prepare_invoice_promise_reconciliation(uuid,uuid,bigint),
  public.promote_xero_sync_run_with_promises(uuid,uuid,bigint,timestamptz,jsonb),public.promote_xero_sync_run(uuid,uuid,bigint,timestamptz)
  from public,anon,authenticated,service_role;
grant execute on function public.apply_invoice_promise_command(uuid,text,uuid,text,uuid,bigint,text,uuid,jsonb),
  public.record_invoice_promise_evaluation(uuid,text,uuid,bigint,uuid,text,timestamptz),
  public.prepare_invoice_promise_reconciliation(uuid,uuid,bigint),
  public.promote_xero_sync_run_with_promises(uuid,uuid,bigint,timestamptz,jsonb),public.promote_xero_sync_run(uuid,uuid,bigint,timestamptz)
  to service_role;
