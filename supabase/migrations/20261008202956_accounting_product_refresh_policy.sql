-- Phase 7.5: product requests only. No scheduled intent creation or billing.
create function public.accept_product_accounting_refresh(
 p_connection_id uuid,p_user_id uuid,p_provider text,p_provider_organisation_id text,
 p_connection_epoch bigint,p_trigger text,p_idempotency_key text default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare c public.accounting_refresh_connections; j public.accounting_refresh_jobs;
 s public.xero_sync_tenant_state; r public.xero_sync_runs; result jsonb;
 now_at timestamptz:=clock_timestamp(); until_at timestamptz;
begin
 if p_trigger not in ('opportunistic','manual','onboarding','reconnect') or p_trigger is null then
  raise exception 'accounting_product_trigger_invalid' using errcode='22023';end if;
 c:=accounting_refresh_private.lock_connection(p_connection_id,p_user_id,p_provider,p_provider_organisation_id,p_connection_epoch);
 if not accounting_refresh_private.available(c) then
  return jsonb_build_object('outcome','reconnect_required','job',null,'nextEligibleAt',null);end if;
 -- Replay through the existing scoped idempotency implementation, even after completion.
 if p_idempotency_key is not null and exists(select 1 from public.accounting_refresh_request_keys k
  where k.connection_id=c.id and k.key_hash=sha256(convert_to(p_idempotency_key,'UTF8'))) then
  result:=public.accept_accounting_refresh(c.id,c.user_id,c.provider,c.provider_organisation_id,c.connection_epoch,p_trigger,p_idempotency_key,null);
 else
  select * into j from public.accounting_refresh_jobs where connection_id=c.id and phase not in ('complete','cancelled') for update;
  if found then
   result:=public.accept_accounting_refresh(c.id,c.user_id,c.provider,c.provider_organisation_id,c.connection_epoch,p_trigger,p_idempotency_key,null);
  else
   -- Provider details remain within this small Xero authority bridge.
   if c.provider<>'xero' then raise exception 'accounting_provider_unsupported' using errcode='22023';end if;
   select * into s from public.xero_sync_tenant_state where user_id=c.user_id and tenant_id=c.provider_organisation_id;
   if s.active_sync_run_id is not null then
    select * into r from public.xero_sync_runs where id=s.active_sync_run_id and user_id=c.user_id and tenant_id=c.provider_organisation_id and status='succeeded';
    if not found or r.snapshot_as_of is null then
     return jsonb_build_object('outcome','attention_required','job',null,'nextEligibleAt',null);end if;
   end if;
   if p_trigger='reconnect' and r.id is not null then
    select * into j from public.accounting_refresh_jobs where connection_id=c.id and connection_epoch=c.connection_epoch
     and generation_run_id=r.id and phase='complete' and completion_kind='prepared' order by requested_at desc limit 1;
    if found then return jsonb_build_object('outcome','current','job',accounting_refresh_private.job_json(j),'nextEligibleAt',null);end if;
   end if;
   if p_trigger='onboarding' and r.id is not null then
    if (public.read_accounting_preparation_readiness(c.user_id,c.provider,c.provider_organisation_id,(now_at at time zone 'UTC')::date)->>'ready')::boolean then
     select * into j from public.accounting_refresh_jobs where connection_id=c.id and generation_run_id=r.id and phase='complete' order by requested_at desc limit 1;
     return jsonb_build_object('outcome','current','job',case when j.id is null then null else accounting_refresh_private.job_json(j) end,'nextEligibleAt',null);
    end if;
    -- Returning onboarding can prepare today's derivatives from already-promoted accounting.
    result:=public.accept_accounting_refresh(c.id,c.user_id,c.provider,c.provider_organisation_id,c.connection_epoch,p_trigger,p_idempotency_key,null);
    update public.accounting_refresh_jobs set work_stage='derivatives',generation_run_id=r.id,next_eligible_at=now_at
     where id=(result#>>'{job,id}')::uuid returning * into j;
    return jsonb_build_object('outcome','preparing','job',accounting_refresh_private.job_json(j),'nextEligibleAt',now_at);
   end if;
   until_at:=greatest(c.cooldown_until,c.provider_not_before);
   if p_trigger='manual' then
    until_at:=greatest(until_at,s.last_successful_sync_at+interval '5 minutes',
     (select max(requested_at)+interval '5 minutes' from public.accounting_refresh_jobs where connection_id=c.id and trigger='manual'));end if;
   if p_trigger in ('manual','opportunistic') and until_at>now_at then return jsonb_build_object('outcome','cooldown','job',null,'nextEligibleAt',until_at);end if;
   if p_trigger='opportunistic' and r.snapshot_as_of>now_at-interval '60 minutes' then
    return jsonb_build_object('outcome','not_due','job',null,'nextEligibleAt',null);end if;
   result:=public.accept_accounting_refresh(c.id,c.user_id,c.provider,c.provider_organisation_id,c.connection_epoch,p_trigger,p_idempotency_key,null);
  end if;
 end if;
 return jsonb_build_object('outcome',case result#>>'{job,phase}'
  when 'complete' then 'current' when 'cancelled' then 'current' when 'preparing' then 'preparing'
  when 'retry_wait' then 'retry_wait' when 'reconnect_required' then 'reconnect_required'
  when 'attention_required' then 'attention_required'
  else case when result->>'resultCode'='accepted' then 'started' else 'already_running' end end,
  'job',result->'job','nextEligibleAt',result#>'{job,nextEligibleAt}');
end $$;
revoke all on function public.accept_product_accounting_refresh(uuid,uuid,text,text,bigint,text,text) from public,anon,authenticated;
grant execute on function public.accept_product_accounting_refresh(uuid,uuid,text,text,bigint,text,text) to service_role;
