-- Ordered repeat-read evidence is an observational stability check, not a Xero transaction snapshot.
alter table public.xero_customer_credit_validations
  add column validation_started_at timestamptz,
  add column validation_completed_at timestamptz,
  add column validation_fencing_token bigint;
alter table public.xero_customer_credit_validations
  add constraint customer_credit_validation_period check (
    (validation_started_at is null and validation_completed_at is null)
    or (validation_started_at is not null and validation_completed_at is not null
      and isfinite(validation_started_at) and isfinite(validation_completed_at)
      and validation_completed_at >= validation_started_at)),
  add constraint customer_credit_ready_evidence check (
    readiness_state <> 'ready' or (reason_code = 'stable_observation' and consistency_result = 'matched'
      and validation_started_at is not null and validation_fencing_token is not null));

create function public.record_xero_customer_credit_stability_validation(
  p_sync_run_id uuid,p_user_id uuid,p_tenant_id text,p_lease_owner uuid,p_fencing_token bigint,
  p_contract_version text,p_invoice_money_contract_version text,p_validation jsonb
) returns void language plpgsql security definer set search_path = pg_catalog as $$
declare
  v_state text := p_validation->>'readiness_state';
  v_reason text := p_validation->>'reason_code';
  v_result text := p_validation->>'consistency_result';
  v_started timestamptz;
  v_completed timestamptz;
  v_resource text;
  v_initial jsonb;
  v_verified jsonb;
  v_stored_count bigint;
  v_obs record;
begin
  perform public.assert_xero_generation_write_authority(p_sync_run_id,p_user_id,p_tenant_id,p_lease_owner,p_fencing_token);
  if p_contract_version is distinct from 'customer_credit_v1'
    or p_invoice_money_contract_version is distinct from 'invoice_exact_v1'
    or v_state is null or v_reason is null or v_result is null
    or v_state not in ('ready','unavailable')
    or v_reason not in ('stable_observation','initial_invoice_incomplete','overpayments_incomplete',
      'prepayments_incomplete','credit_notes_incomplete','invoice_verification_incomplete',
      'credit_verification_incomplete','invoice_state_changed','credit_state_changed',
      'invalid_invoice_state','invalid_credit_state','missing_version_evidence',
      'validation_timeout','evidence_changed_after_validation')
    or v_result not in ('matched','changed','incomplete')
    or jsonb_typeof(p_validation->'resource_observations') is distinct from 'object' then
    raise exception 'Invalid customer-credit validation contract';
  end if;
  v_started := (p_validation->>'validation_started_at')::timestamptz;
  v_completed := (p_validation->>'validation_completed_at')::timestamptz;
  if v_started is null or v_completed is null or not isfinite(v_started) or not isfinite(v_completed)
    or v_completed < v_started then raise exception 'Invalid customer-credit validation period'; end if;

  select * into v_obs from public.xero_customer_credit_validations
    where sync_run_id=p_sync_run_id and user_id=p_user_id and tenant_id=p_tenant_id and source_system='xero'
    for update;
  if not found or v_obs.contract_version <> p_contract_version
    or v_obs.invoice_money_contract_version <> p_invoice_money_contract_version then
    raise exception 'Missing exact-version customer-credit foundation';
  end if;
  if v_obs.validation_started_at is not null then
    if v_obs.readiness_state is distinct from v_state or v_obs.reason_code is distinct from v_reason
      or v_obs.consistency_result is distinct from v_result
      or v_obs.validation_started_at is distinct from v_started
      or v_obs.validation_completed_at is distinct from v_completed
      or v_obs.validation_fencing_token is distinct from p_fencing_token
      or v_obs.resource_observations is distinct from p_validation->'resource_observations' then
      raise exception 'Customer-credit stability validation already recorded for generation';
    end if;
    return;
  end if;
  if v_state = 'ready' then
    if v_reason <> 'stable_observation' or v_result <> 'matched'
      or not v_obs.credit_notes_complete or v_obs.credit_notes_invalid_count <> 0
      or v_obs.credit_notes_source_count <> v_obs.credit_notes_mapped_count then
      raise exception 'Customer-credit evidence cannot be certified';
    end if;
    foreach v_resource in array array['invoices','overpayments','prepayments','creditnotes'] loop
      v_initial := p_validation #> array['resource_observations','initial',v_resource];
      v_verified := p_validation #> array['resource_observations','verification',v_resource];
      if v_initial is null or v_verified is null or v_initial->>'complete' is distinct from 'true'
        or v_verified->>'complete' is distinct from 'true'
        or coalesce(v_initial->>'signature','') !~ '^[0-9a-f]{64}$'
        or v_initial->>'count' is null or v_verified->>'count' is null
        or v_initial->>'page_requests' is null or v_initial->>'populated_pages' is null
        or v_verified->>'page_requests' is null or v_verified->>'populated_pages' is null
        or v_initial->>'started_at' is null or v_initial->>'completed_at' is null
        or v_verified->>'started_at' is null or v_verified->>'completed_at' is null
        or (v_initial->>'count')::bigint < 0 or (v_verified->>'count')::bigint < 0
        or (v_initial->>'page_requests')::bigint < 1 or (v_verified->>'page_requests')::bigint < 1
        or (v_initial->>'populated_pages')::bigint < 0 or (v_verified->>'populated_pages')::bigint < 0
        or v_verified->>'signature' is distinct from v_initial->>'signature'
        or (v_verified->>'count')::bigint is distinct from (v_initial->>'count')::bigint
        or (v_initial->>'page_requests')::bigint <= (v_initial->>'populated_pages')::bigint
        or (v_verified->>'page_requests')::bigint <= (v_verified->>'populated_pages')::bigint
        or (v_initial->>'started_at')::timestamptz > (v_initial->>'completed_at')::timestamptz
        or (v_verified->>'started_at')::timestamptz > (v_verified->>'completed_at')::timestamptz then
        raise exception 'Incomplete or changed customer-credit observation';
      end if;
      if v_resource = 'invoices' then
        select count(*) into v_stored_count from public.canonical_invoices
          where sync_run_id=p_sync_run_id and user_id=p_user_id and tenant_id=p_tenant_id
            and source_system='xero' and status='AUTHORISED' and type='ACCREC';
      elsif v_resource = 'creditnotes' then
        select count(*) into v_stored_count from public.canonical_credit_note_evidence
          where sync_run_id=p_sync_run_id and user_id=p_user_id and tenant_id=p_tenant_id and source_system='xero';
        if (v_initial->>'count')::bigint <> v_obs.credit_notes_mapped_count
          or (v_initial->>'completed_at')::timestamptz is distinct from v_obs.credit_notes_completed_at then
          raise exception 'Credit-note foundation observation mismatch';
        end if;
      else
        select count(*) into v_stored_count from public.canonical_unapplied_cash_evidence
          where sync_run_id=p_sync_run_id and user_id=p_user_id and tenant_id=p_tenant_id and source_system='xero'
            and source_kind=case v_resource when 'overpayments' then 'overpayment' else 'prepayment' end;
        if not exists(select 1 from public.xero_accounting_evidence_observations o
          where o.sync_run_id=p_sync_run_id and o.user_id=p_user_id and o.tenant_id=p_tenant_id
            and o.source_system='xero' and o.resource=v_resource and o.complete
            and o.source_count=(v_initial->>'count')::bigint and o.mapped_count=v_stored_count
            and o.completed_at=(v_initial->>'completed_at')::timestamptz) then
          raise exception 'Cash foundation observation mismatch';
        end if;
      end if;
      if v_stored_count is distinct from (v_initial->>'count')::bigint then
        raise exception 'Persisted customer-credit source count mismatch';
      end if;
    end loop;
    if (p_validation #>> '{resource_observations,initial,invoices,completed_at}')::timestamptz >
        (p_validation #>> '{resource_observations,verification,invoices,started_at}')::timestamptz
      or exists(select 1 from (values ('overpayments'),('prepayments'),('creditnotes')) r(resource)
        where (p_validation #>> array['resource_observations','initial',r.resource,'completed_at'])::timestamptz >
          (p_validation #>> '{resource_observations,verification,invoices,started_at}')::timestamptz
          or (p_validation #>> array['resource_observations','verification',r.resource,'started_at'])::timestamptz <
            (p_validation #>> '{resource_observations,verification,invoices,completed_at}')::timestamptz) then
      raise exception 'Customer-credit observation order invalid';
    end if;
  end if;
  update public.xero_customer_credit_validations set readiness_state=v_state,reason_code=v_reason,
    consistency_result=v_result,resource_observations=p_validation->'resource_observations',
    validation_started_at=v_started,validation_completed_at=v_completed,validation_fencing_token=p_fencing_token
    where sync_run_id=p_sync_run_id and user_id=p_user_id and tenant_id=p_tenant_id and source_system='xero';
end $$;
revoke all on function public.record_xero_customer_credit_stability_validation(uuid,uuid,text,uuid,bigint,text,text,jsonb)
  from public,anon,authenticated;
grant execute on function public.record_xero_customer_credit_stability_validation(uuid,uuid,text,uuid,bigint,text,text,jsonb)
  to service_role;

-- A later generation-scoped accounting write invalidates the observation it changed.
create function public.invalidate_xero_customer_credit_stability() returns trigger
language plpgsql security definer set search_path = pg_catalog as $$
declare
  v_run uuid;
  v_user uuid;
  v_tenant text;
  v_source text;
begin
  if tg_op = 'DELETE' then
    v_run := old.sync_run_id; v_user := old.user_id; v_tenant := old.tenant_id; v_source := old.source_system;
  else
    v_run := new.sync_run_id; v_user := new.user_id; v_tenant := new.tenant_id; v_source := new.source_system;
  end if;
  update public.xero_customer_credit_validations set readiness_state='unavailable',
    reason_code='evidence_changed_after_validation',consistency_result='changed'
    where sync_run_id=v_run and user_id=v_user and tenant_id=v_tenant and source_system=v_source
      and readiness_state='ready';
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
revoke all on function public.invalidate_xero_customer_credit_stability() from public,anon,authenticated;
create trigger invalidate_credit_on_invoice_write after insert or update or delete on public.canonical_invoices
  for each row execute function public.invalidate_xero_customer_credit_stability();
create trigger invalidate_credit_on_cash_write after insert or update or delete on public.canonical_unapplied_cash_evidence
  for each row execute function public.invalidate_xero_customer_credit_stability();
create trigger invalidate_credit_on_credit_note_write after insert or update or delete on public.canonical_credit_note_evidence
  for each row execute function public.invalidate_xero_customer_credit_stability();
create trigger invalidate_credit_on_cash_observation_write after insert or update or delete on public.xero_accounting_evidence_observations
  for each row execute function public.invalidate_xero_customer_credit_stability();
