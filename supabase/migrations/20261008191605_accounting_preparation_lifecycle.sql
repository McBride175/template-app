-- Phase 7.4 closes existing post-promotion work. No refresh intent is generated,
-- no provider access, no scoring implementation, no new derivative/cache table.
alter table public.accounting_refresh_jobs
 add column preparation_retry_count integer not null default 0 check(preparation_retry_count>=0),
 add column completion_kind text check(completion_kind in('prepared','superseded')),
 add column completion_identity jsonb check(completion_identity is null or jsonb_typeof(completion_identity)='object'),
 add column preparation_diagnostics jsonb not null default '{}'::jsonb check(jsonb_typeof(preparation_diagnostics)='object'),
 add constraint accounting_preparation_generation_required check(work_stage<>'derivatives' or generation_run_id is not null),
 add constraint accounting_completion_audit check(completion_kind is null or (phase='complete' and work_stage='derivatives' and completion_identity is not null));
alter table accounting_refresh_private.dispatch_config add column preparation_enabled boolean not null default false;
create index accounting_refresh_parked_preparation on public.accounting_refresh_jobs(next_eligible_at,priority desc,requested_at,id)
 where phase='preparing' and worker_id is null;

-- Disposable Test-only control injection; never accounting or derivative truth.
create table accounting_refresh_private.preparation_test_controls (
 job_id uuid primary key references public.accounting_refresh_jobs(id) on delete cascade,
 scenario text not null check(scenario in('fail_after_features_once','lose_completion_response_once','abandon_once')),
 consumed boolean not null default false
);
alter table accounting_refresh_private.preparation_test_controls enable row level security;
revoke all on accounting_refresh_private.preparation_test_controls from public,anon,authenticated,service_role;

alter function accounting_refresh_private.job_json(public.accounting_refresh_jobs) rename to job_json_foundation;
create function accounting_refresh_private.job_json(j public.accounting_refresh_jobs) returns jsonb
language sql stable set search_path=pg_catalog as $$
 select accounting_refresh_private.job_json_foundation(j)||jsonb_build_object('preparationRetryCount',j.preparation_retry_count,'completionKind',j.completion_kind)
$$;
create function accounting_refresh_private.utc_date() returns date
language sql volatile set search_path=pg_catalog as $$select (clock_timestamp() at time zone 'UTC')::date$$;

create function accounting_refresh_private.preparation_attempt(p_job uuid,p_attempt uuid,p_worker uuid,p_number integer,p_epoch bigint)
returns public.accounting_refresh_jobs language plpgsql set search_path=pg_catalog as $$
declare j public.accounting_refresh_jobs;
begin
 select * into j from public.accounting_refresh_jobs where id=p_job;
 if not found or j.provider<>'xero' or j.work_stage<>'derivatives' or j.generation_run_id is null then
   raise exception 'accounting_preparation_invalid_scope' using errcode='42501';end if;
 j:=accounting_refresh_private.lock_attempt(j.id,j.user_id,j.provider,j.provider_organisation_id,p_epoch,p_attempt,p_worker,p_number);
 if not exists(select 1 from public.xero_sync_runs r where r.id=j.generation_run_id and r.user_id=j.user_id and r.tenant_id=j.provider_organisation_id and r.status='succeeded') then
   raise exception 'accounting_preparation_not_promoted' using errcode='40001';end if;
 return j;
end $$;

create function public.read_accounting_preparation(p_job_id uuid,p_attempt_id uuid,p_worker_id uuid,p_attempt_number integer,p_connection_epoch bigint)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare j public.accounting_refresh_jobs; ctx jsonb;
begin
 j:=accounting_refresh_private.preparation_attempt(p_job_id,p_attempt_id,p_worker_id,p_attempt_number,p_connection_epoch);
 ctx:=collection_materialization_private.context(j.user_id,j.provider_organisation_id)-'certificate';
 return jsonb_build_object('resultCode',case when ctx->>'generationId'=j.generation_run_id::text then 'current' else 'superseded' end,
   'context',ctx,'boundGenerationId',j.generation_run_id,'job',accounting_refresh_private.job_json(j));
end $$;

-- The pure Phase 7.1 retry policy remains the worker proposal. Expired attempts
-- need the equivalent durable recovery timing in SQL (certified against it).
create function accounting_refresh_private.retry_preparation(j public.accounting_refresh_jobs,p_code text,p_retry_at timestamptz default null)
returns jsonb language plpgsql set search_path=pg_catalog as $$
declare t timestamptz:=clock_timestamp(); due timestamptz; n integer:=j.preparation_retry_count;
begin
 if p_code is null or p_code !~ '^[a-z][a-z0-9_]{0,63}$' then raise exception 'accounting_preparation_invalid_code' using errcode='22023';end if;
 if n<4 then due:=coalesce(p_retry_at,t+make_interval(secs=>round((array[60,300,900,3600])[n+1]*(0.9+random()*0.2))::integer));end if;
 if due is not null and (not isfinite(due) or due<t) then raise exception 'accounting_preparation_invalid_retry' using errcode='22023';end if;
 update public.accounting_refresh_jobs set phase=case when due is null then 'attention_required' else 'retry_wait' end,
   worker_id=null,attempt_expires_at=null,delivery_owner=null,delivery_expires_at=null,
   retry_count=retry_count+1,preparation_retry_count=n+1,failure_class='preparation_failure',failure_code=p_code,failed_at=t,
   retry_source=case when due is null then 'none' else 'local' end,next_eligible_at=coalesce(due,t)
   where id=j.id returning * into j;
 return accounting_refresh_private.job_json(j);
end $$;
create function public.fail_accounting_preparation(p_job_id uuid,p_attempt_id uuid,p_worker_id uuid,p_attempt_number integer,p_connection_epoch bigint,
 p_failure_code text,p_retry_at timestamptz default null) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare j public.accounting_refresh_jobs;
begin
 j:=accounting_refresh_private.preparation_attempt(p_job_id,p_attempt_id,p_worker_id,p_attempt_number,p_connection_epoch);
 return accounting_refresh_private.retry_preparation(j,p_failure_code,p_retry_at);
end $$;

-- Full feature population checked through the existing validity reader. Payloads
-- stay within PostgreSQL; no alternative financial calculation/validity rules.
create function accounting_refresh_private.features_current(p_user uuid,p_tenant text,p_date date,p_context jsonb) returns boolean
language plpgsql set search_path=pg_catalog as $$
declare page jsonb; item jsonb; cursor text; n integer:=0; expected integer;
begin
 loop
   page:=public.read_collection_customer_materialization(p_user,p_tenant,p_date,null,cursor,500);
   if page#>>'{context,generationId}' is distinct from p_context->>'generationId'
     or page#>>'{context,financialEpoch}' is distinct from p_context->>'financialEpoch'
     or page#>>'{context,evidenceIdentity}' is distinct from p_context->>'evidenceIdentity'
     or (page->>'invalidActivePromise')::boolean then return false;end if;
   if cursor is null then
     if page->'manifest' is null or page->'manifest'='null'::jsonb or (page#>>'{manifest,complete}')::boolean is distinct from true then return false;end if;
     expected:=(page#>>'{manifest,basis_count}')::integer;
   end if;
   for item in select value from jsonb_array_elements(page->'items') loop
     if (item->>'basisComplete')::boolean is distinct from true or item->'feature' is null or item->'feature'='null'::jsonb then return false;end if;
     n:=n+1;cursor:=item->>'customerId';
   end loop;
   exit when jsonb_array_length(page->'items')<500;
 end loop;
 return n=expected;
end $$;

create function public.complete_accounting_preparation(p_job_id uuid,p_attempt_id uuid,p_worker_id uuid,p_attempt_number integer,p_connection_epoch bigint,
 p_evaluation_date date,p_all_calculation_id uuid default null,p_overdue_calculation_id uuid default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare j public.accounting_refresh_jobs; ctx jsonb; normal jsonb; overdue jsonb; outcome text; audit jsonb; verify_started timestamptz:=clock_timestamp(); verify_ms numeric;
begin
 j:=accounting_refresh_private.preparation_attempt(p_job_id,p_attempt_id,p_worker_id,p_attempt_number,p_connection_epoch);
 perform collection_dependency_private.lock_financial_scope(j.user_id,j.provider_organisation_id,'xero');
 ctx:=collection_materialization_private.context(j.user_id,j.provider_organisation_id)-'certificate';
 if ctx->>'generationStatus' is distinct from 'succeeded' or (ctx->>'generationReady')::boolean is distinct from true then
   return jsonb_build_object('resultCode','accounting_unavailable');end if;
 if ctx->>'generationId' is distinct from j.generation_run_id::text then
   outcome:='superseded';audit:=jsonb_build_object('boundGenerationId',j.generation_run_id,'authoritativeGenerationId',ctx->>'generationId');
 else
   if p_evaluation_date is distinct from accounting_refresh_private.utc_date() then return jsonb_build_object('resultCode','date_changed');end if;
   perform 1 from public.xero_customer_credit_validations where user_id=j.user_id and tenant_id=j.provider_organisation_id and sync_run_id=j.generation_run_id for share;
   ctx:=collection_materialization_private.context(j.user_id,j.provider_organisation_id)-'certificate';
   perform 1 from public.collection_customer_features where user_id=j.user_id and tenant_id=j.provider_organisation_id and generation_id=j.generation_run_id for share;
   perform 1 from public.collection_portfolio_calculations where id in(p_all_calculation_id,p_overdue_calculation_id) for share;
   perform 1 from public.collection_portfolio_base_scores where calculation_id in(p_all_calculation_id,p_overdue_calculation_id) for share;
   normal:=public.read_collection_portfolio_calculation(j.user_id,j.provider_organisation_id,p_evaluation_date,false,'collections','{}',null,2000);
   overdue:=public.read_collection_portfolio_calculation(j.user_id,j.provider_organisation_id,p_evaluation_date,true,'collections','{}',null,2000);
   if normal#>>'{head,calculationId}' is distinct from p_all_calculation_id::text or overdue#>>'{head,calculationId}' is distinct from p_overdue_calculation_id::text
     or p_all_calculation_id is null or p_overdue_calculation_id is null
     or not accounting_refresh_private.features_current(j.user_id,j.provider_organisation_id,p_evaluation_date,ctx) then
     return jsonb_build_object('resultCode','identity_changed');end if;
   -- Lock excludes G/F/evidence drift. The existing readers validate date/model/
   -- version/checksums; P is deliberately outside financial completion authority.
   if p_evaluation_date is distinct from accounting_refresh_private.utc_date() then return jsonb_build_object('resultCode','date_changed');end if;
   outcome:='prepared';audit:=(normal#>'{head,identity}')||jsonb_build_object('allCalculationId',p_all_calculation_id,'overdueCalculationId',p_overdue_calculation_id);
 end if;
 j:=accounting_refresh_private.preparation_attempt(p_job_id,p_attempt_id,p_worker_id,p_attempt_number,p_connection_epoch);
 verify_ms:=extract(epoch from(clock_timestamp()-verify_started))*1000;
 update public.accounting_refresh_jobs set phase='complete',completed_at=clock_timestamp(),completion_kind=outcome,completion_identity=audit,
   preparation_diagnostics=preparation_diagnostics||jsonb_build_object('verificationMs',verify_ms,'totalMs',coalesce((preparation_diagnostics->>'totalMs')::numeric,0)+verify_ms),
   worker_id=null,attempt_expires_at=null,delivery_owner=null,delivery_expires_at=null,failure_class=null,failure_code=null,retry_source='none'
   where id=j.id returning * into j;
 return jsonb_build_object('resultCode',outcome,'job',accounting_refresh_private.job_json(j),'identity',audit,'verificationMs',verify_ms);
end $$;

-- Computed status, not another ready authority. No construction/provider work.
create function public.read_accounting_preparation_readiness(p_user_id uuid,p_provider text,p_provider_organisation_id text,p_evaluation_date date)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
declare ctx jsonb; normal jsonb; overdue jsonb; ready boolean;
begin
 if p_provider is distinct from 'xero' or not exists(select 1 from public.xero_connections_public where user_id=p_user_id and tenant_id=p_provider_organisation_id) then
   raise exception 'accounting_preparation_invalid_scope' using errcode='42501';end if;
 ctx:=collection_materialization_private.context(p_user_id,p_provider_organisation_id)-'certificate';
 normal:=public.read_collection_portfolio_calculation(p_user_id,p_provider_organisation_id,p_evaluation_date,false,'collections','{}',null,0);
 overdue:=public.read_collection_portfolio_calculation(p_user_id,p_provider_organisation_id,p_evaluation_date,true,'collections','{}',null,0);
 ready:=normal->'head'<>'null'::jsonb and overdue->'head'<>'null'::jsonb
   and normal#>>'{context,generationId}'=ctx->>'generationId' and overdue#>>'{context,generationId}'=ctx->>'generationId'
   and normal#>>'{context,financialEpoch}'=ctx->>'financialEpoch' and overdue#>>'{context,financialEpoch}'=ctx->>'financialEpoch'
   and normal#>>'{context,evidenceIdentity}'=ctx->>'evidenceIdentity' and overdue#>>'{context,evidenceIdentity}'=ctx->>'evidenceIdentity'
   and accounting_refresh_private.features_current(p_user_id,p_provider_organisation_id,p_evaluation_date,ctx);
 return jsonb_build_object('ready',coalesce(ready,false),'context',ctx,'evaluationDate',p_evaluation_date,
   'allCalculationId',normal#>>'{head,calculationId}','overdueCalculationId',overdue#>>'{head,calculationId}');
end $$;

create function public.record_accounting_preparation(p_job_id uuid,p_attempt_id uuid,p_worker_id uuid,p_attempt_number integer,p_connection_epoch bigint,
 p_diagnostics jsonb) returns boolean language plpgsql security definer set search_path=pg_catalog as $$
declare j public.accounting_refresh_jobs;
begin
 j:=accounting_refresh_private.preparation_attempt(p_job_id,p_attempt_id,p_worker_id,p_attempt_number,p_connection_epoch);
 if p_diagnostics is null or jsonb_typeof(p_diagnostics)<>'object' or p_diagnostics-array['totalMs','featureMs','featureHits','featureMisses','basisHits','basisMisses','basisBuilds','featuresRebuilt','customerCount','basisCount','portfolioHits','portfolioMisses','portfolioMs','benchmarkMs','scoreMs','publicationMs','readMs','verificationMs','drifts']<>'{}'
   or exists(select 1 from jsonb_each(p_diagnostics) e where jsonb_typeof(e.value)<>'number' or (e.value::text)::numeric<0) then
   raise exception 'accounting_preparation_invalid_diagnostics' using errcode='22023';end if;
 update public.accounting_refresh_jobs set preparation_diagnostics=p_diagnostics where id=j.id;return true;
end $$;
create function public.consume_accounting_preparation_control(p_job_id uuid,p_attempt_id uuid,p_worker_id uuid,p_attempt_number integer,p_connection_epoch bigint)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare j public.accounting_refresh_jobs; scenario text;
begin
 j:=accounting_refresh_private.preparation_attempt(p_job_id,p_attempt_id,p_worker_id,p_attempt_number,p_connection_epoch);
 if not exists(select 1 from accounting_refresh_private.dispatch_config where singleton and project_ref='rbmxegyiwntomhpbepnu') then return '{}'::jsonb;end if;
 update accounting_refresh_private.preparation_test_controls set consumed=true where job_id=j.id and not consumed returning preparation_test_controls.scenario into scenario;
 return jsonb_build_object('scenario',scenario);
end $$;

-- Normalize a parked preparing row to a derivative queue reservation within the
-- same short transaction; claim restores preparing. There is no accounting rewind.
alter function public.reserve_accounting_refresh_delivery(uuid,uuid,text,text,bigint,uuid,integer) rename to reserve_accounting_refresh_delivery_foundation;
revoke all on function public.reserve_accounting_refresh_delivery_foundation(uuid,uuid,text,text,bigint,uuid,integer) from public,anon,authenticated,service_role;
create function public.reserve_accounting_refresh_delivery(p_job_id uuid,p_user_id uuid,p_provider text,p_provider_organisation_id text,
 p_connection_epoch bigint,p_delivery_owner uuid,p_ttl_seconds integer default 60) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare c public.accounting_refresh_connections; j public.accounting_refresh_jobs;
begin
 select * into j from public.accounting_refresh_jobs where id=p_job_id;
 c:=accounting_refresh_private.lock_connection(j.connection_id,p_user_id,p_provider,p_provider_organisation_id,p_connection_epoch);
 select * into j from public.accounting_refresh_jobs where id=p_job_id for update;
 if j.phase='preparing' and j.work_stage='derivatives' and j.worker_id is null and j.next_eligible_at<=clock_timestamp() then
   update public.accounting_refresh_jobs set phase='queued' where id=j.id;
 end if;
 return public.reserve_accounting_refresh_delivery_foundation(p_job_id,p_user_id,p_provider,p_provider_organisation_id,p_connection_epoch,p_delivery_owner,p_ttl_seconds);
end $$;
create or replace function public.list_accounting_refresh_work(p_limit integer default 25)
returns setof jsonb language sql stable security definer set search_path=pg_catalog as $$
 select accounting_refresh_private.job_json(j) from public.accounting_refresh_jobs j
 join public.accounting_refresh_connections c on c.id=j.connection_id
 where (j.phase in('queued','retry_wait') or (j.phase='preparing' and j.work_stage='derivatives' and j.worker_id is null)) and j.next_eligible_at<=statement_timestamp()
   and (j.delivery_expires_at is null or j.delivery_expires_at<=statement_timestamp())
   and j.connection_epoch=c.connection_epoch and accounting_refresh_private.available(c)
 order by (j.requested_at<statement_timestamp()-interval '30 minutes') desc,j.priority desc,j.next_eligible_at,j.requested_at,j.id
 limit greatest(0,least(coalesce(p_limit,25),200))
$$;


alter function accounting_refresh_private.handoff_xero(public.accounting_refresh_jobs) rename to handoff_xero_publication;
create function accounting_refresh_private.handoff_xero(j public.accounting_refresh_jobs) returns jsonb
language plpgsql set search_path=pg_catalog as $$
begin
 if j.work_stage='derivatives' then
   return jsonb_build_object('resultCode','promoted','job',accounting_refresh_private.job_json(j),'runId',j.generation_run_id);
 end if;
 return accounting_refresh_private.handoff_xero_publication(j);
end $$;

-- Exact committed-run recovery must not clear a live preparation attempt or
-- bypass its retry delay. Expired derivative attempts use independent backoff.
create or replace function public.recover_accounting_refresh_work(p_limit integer default 25) returns integer
language plpgsql security definer set search_path=pg_catalog as $$
declare candidate record; c public.accounting_refresh_connections; j public.accounting_refresh_jobs; n integer:=0; t timestamptz:=clock_timestamp();
begin
 for candidate in select id,connection_id from public.accounting_refresh_jobs
   where (phase in('running','preparing') and attempt_expires_at<=t) or delivery_expires_at<=t
   order by coalesce(attempt_expires_at,delivery_expires_at),id limit greatest(0,least(coalesce(p_limit,25),200)) loop
   select * into c from public.accounting_refresh_connections where id=candidate.connection_id for update skip locked;
   if not found then continue;end if;
   select * into j from public.accounting_refresh_jobs where id=candidate.id for update skip locked;
   if not found or j.phase in('complete','cancelled') then continue;end if;
   if j.connection_epoch<>c.connection_epoch or not accounting_refresh_private.available(c) then
     update public.accounting_refresh_jobs set phase='cancelled',completed_at=t,worker_id=null,attempt_expires_at=null,delivery_owner=null,delivery_expires_at=null where id=j.id;
   elsif j.phase in('running','preparing') and j.attempt_expires_at<=t then
     if j.work_stage='derivatives' then
       perform accounting_refresh_private.retry_preparation(j,'attempt_lease_expired');
     elsif j.provider='xero' and exists(select 1 from public.xero_sync_runs r where r.id=j.generation_run_id and r.user_id=j.user_id and r.tenant_id=j.provider_organisation_id and r.status='succeeded') then
       perform accounting_refresh_private.handoff_xero(j);
     else
       update public.accounting_refresh_jobs set phase='retry_wait',worker_id=null,attempt_expires_at=null,delivery_owner=null,delivery_expires_at=null,
         retry_count=retry_count+1,failure_class='transient',failure_code='attempt_lease_expired',failed_at=t,retry_source='local',
         next_eligible_at=greatest(t+interval '5 minutes',c.cooldown_until,c.provider_not_before,j.provider_not_before) where id=j.id;
     end if;
   elsif j.delivery_expires_at<=t then
     update public.accounting_refresh_jobs set delivery_owner=null,delivery_expires_at=null where id=j.id;
   else continue;end if;
   n:=n+1;
 end loop;
 return n;
end $$;

-- All Xero completion goes through exact derivative proof. Existing synthetic
-- control acknowledgements and pre-promotion update contracts remain available.
alter function public.update_accounting_refresh_attempt(uuid,uuid,text,text,bigint,uuid,uuid,integer,text,text,text,timestamptz,timestamptz,text,uuid) rename to update_accounting_refresh_attempt_foundation;
revoke all on function public.update_accounting_refresh_attempt_foundation(uuid,uuid,text,text,bigint,uuid,uuid,integer,text,text,text,timestamptz,timestamptz,text,uuid) from public,anon,authenticated,service_role;
create function public.update_accounting_refresh_attempt(p_job_id uuid,p_user_id uuid,p_provider text,p_provider_organisation_id text,
 p_connection_epoch bigint,p_attempt_id uuid,p_worker_id uuid,p_attempt_number integer,p_operation text,
 p_failure_class text default null,p_failure_code text default null,p_retry_at timestamptz default null,
 p_provider_not_before timestamptz default null,p_retry_source text default 'none',p_generation_run_id uuid default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare j public.accounting_refresh_jobs;
begin
 select * into j from public.accounting_refresh_jobs where id=p_job_id;
 if j.user_id is distinct from p_user_id or j.provider is distinct from p_provider or j.provider_organisation_id is distinct from p_provider_organisation_id then
   raise exception 'accounting_refresh_invalid_scope' using errcode='42501';end if;
 j:=accounting_refresh_private.lock_attempt(p_job_id,p_user_id,p_provider,p_provider_organisation_id,p_connection_epoch,p_attempt_id,p_worker_id,p_attempt_number);
 if j.provider='xero' and p_operation='complete' then raise exception 'accounting_preparation_proof_required' using errcode='42501';end if;
 if j.provider='xero' and j.work_stage='derivatives' and p_operation='fail' then
   if p_failure_class is distinct from 'preparation_failure' then raise exception 'accounting_preparation_failure_required' using errcode='22023';end if;
   return public.fail_accounting_preparation(j.id,p_attempt_id,p_worker_id,p_attempt_number,p_connection_epoch,p_failure_code,p_retry_at);
 end if;
 return public.update_accounting_refresh_attempt_foundation(p_job_id,p_user_id,p_provider,p_provider_organisation_id,p_connection_epoch,p_attempt_id,p_worker_id,p_attempt_number,p_operation,p_failure_class,p_failure_code,p_retry_at,p_provider_not_before,p_retry_source,p_generation_run_id);
end $$;
create or replace function public.dispatch_accounting_refresh(p_source text default 'internal') returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare config accounting_refresh_private.dispatch_config; start_at timestamptz:=clock_timestamp(); now_at timestamptz;
 recovered_deliveries integer:=0; recovered_attempts integer:=0; occupied integer:=0; eligible integer:=0; submitted integer:=0;
 settings jsonb; job jsonb; reservation jsonb; result_code text:='idle'; duration numeric;
begin
 if p_source is null or p_source not in('cron','immediate','completion','internal') then raise exception 'accounting_dispatch_invalid_source' using errcode='22023';end if;
 -- Serialize capacity calculation plus reservation/submit across all dispatch sources.
 if not pg_try_advisory_xact_lock(hashtextextended('accounting-refresh-dispatch',0)) then
   return jsonb_build_object('resultCode','dispatcher_busy','submitted',0);end if;
 select * into config from accounting_refresh_private.dispatch_config where singleton;
 if not config.enabled then return jsonb_build_object('resultCode','disabled','submitted',0);end if;
 now_at:=clock_timestamp();
 select count(*) filter(where phase in('running','preparing') and attempt_expires_at<=now_at),
   count(*) filter(where delivery_expires_at<=now_at) into recovered_attempts,recovered_deliveries
   from (select phase,attempt_expires_at,delivery_expires_at from public.accounting_refresh_jobs
     where (phase in('running','preparing') and attempt_expires_at<=now_at) or delivery_expires_at<=now_at
     order by coalesce(attempt_expires_at,delivery_expires_at),id limit 25) expired;
 perform public.recover_accounting_refresh_work(25);
 select count(*) into occupied from (
   select id from public.accounting_refresh_jobs where phase in('running','preparing') and attempt_expires_at>now_at
   union all select id from public.accounting_refresh_jobs where delivery_owner is not null and delivery_expires_at>now_at
 ) live;
 if occupied>=4 then result_code:='capacity_full';
 else
   -- The existing eligible-work contract supplies cooldown/priority/aging rules.
   -- Separate Test gates select provider vs preparation work; both share
   -- capacity and reservations. No connection-age scan or new intent.
   for job in select item from public.list_accounting_refresh_work(200) item
     left join accounting_refresh_private.synthetic_jobs spec on spec.job_id=(item->>'id')::uuid
     where ((item#>>'{connection,provider}'='foundation_certification' and spec.job_id is not null)
       or (config.xero_enabled and config.project_ref='rbmxegyiwntomhpbepnu' and item#>>'{connection,provider}'='xero' and item->>'stage'='accounting')
       or (config.preparation_enabled and config.project_ref='rbmxegyiwntomhpbepnu' and item#>>'{connection,provider}'='xero' and item->>'stage'='derivatives'))
     order by ((item->>'requestedAt')::timestamptz<statement_timestamp()-interval '30 minutes') desc,
       (item->>'priority')::integer desc,(item->>'nextEligibleAt')::timestamptz,(item->>'requestedAt')::timestamptz,item->>'id'
     limit 4-occupied
   loop
     eligible:=eligible+1;
     if settings is null then settings:=accounting_refresh_private.delivery_settings();end if;
     reservation:=public.reserve_accounting_refresh_delivery((job->>'id')::uuid,(job#>>'{connection,ownerId}')::uuid,
       job#>>'{connection,provider}',job#>>'{connection,providerOrganisationId}',(job#>>'{connection,epoch}')::bigint,gen_random_uuid(),60);
     if (reservation->>'reserved')::boolean then
       perform accounting_refresh_private.submit_delivery(settings,config.project_ref,(job->>'id')::uuid,(reservation->'job'->>'deliveryId')::uuid);
       submitted:=submitted+1;
     end if;
   end loop;
   if submitted>0 then result_code:='submitted';end if;
 end if;
 duration:=extract(epoch from(clock_timestamp()-start_at))*1000;
 insert into accounting_refresh_private.dispatch_ticks(source,duration_ms,recovered_deliveries,recovered_attempts,occupied,eligible,submitted,result_code)
   values(p_source,duration,recovered_deliveries,recovered_attempts,occupied,eligible,submitted,result_code);
 delete from accounting_refresh_private.dispatch_ticks where id in(select id from accounting_refresh_private.dispatch_ticks where observed_at<now_at-interval '7 days' order by observed_at limit 100);
 return jsonb_build_object('resultCode',result_code,'durationMs',duration,'recoveredDeliveries',recovered_deliveries,
   'recoveredAttempts',recovered_attempts,'occupied',occupied,'freeSlots',greatest(0,4-occupied),'eligible',eligible,'submitted',submitted);
end $$;

create or replace function public.load_accounting_refresh_delivery(p_job_id uuid,p_delivery_id uuid) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog as $$
declare job public.accounting_refresh_jobs; spec accounting_refresh_private.synthetic_jobs; config accounting_refresh_private.dispatch_config;
begin
 select * into config from accounting_refresh_private.dispatch_config where singleton;
 if not config.enabled then return null;end if;
 select * into job from public.accounting_refresh_jobs where id=p_job_id and delivery_id=p_delivery_id;
 if not found then return null;end if;
 if not ((job.phase in('queued','retry_wait') and job.delivery_expires_at>statement_timestamp())
   or (job.phase in('running','preparing') and job.attempt_expires_at>statement_timestamp())) then return null;end if;
 if not exists(select 1 from public.accounting_refresh_connections c where c.id=job.connection_id and c.connection_epoch=job.connection_epoch and accounting_refresh_private.available(c)) then return null;end if;
 if job.provider='foundation_certification' then
   select * into spec from accounting_refresh_private.synthetic_jobs where job_id=job.id;
   if not found then return null;end if;
   return jsonb_build_object('projectRef',config.project_ref,'mode','synthetic','job',accounting_refresh_private.job_json(job),
     'synthetic',jsonb_build_object('scenario',spec.scenario,'delaySeconds',spec.delay_seconds));
 elsif job.provider='xero' and job.work_stage='derivatives' and config.preparation_enabled and config.project_ref='rbmxegyiwntomhpbepnu' then
   return jsonb_build_object('projectRef',config.project_ref,'mode','preparation','job',accounting_refresh_private.job_json(job));
 elsif job.provider='xero' and job.work_stage='accounting' and config.xero_enabled and config.project_ref='rbmxegyiwntomhpbepnu' then
   return jsonb_build_object('projectRef',config.project_ref,'mode','xero','job',accounting_refresh_private.job_json(job));
 end if;
 return null;
end $$;


revoke all on all functions in schema accounting_refresh_private from public,anon,authenticated,service_role;
revoke all on function public.read_accounting_preparation(uuid,uuid,uuid,integer,bigint),
 public.read_accounting_preparation_readiness(uuid,text,text,date),
 public.complete_accounting_preparation(uuid,uuid,uuid,integer,bigint,date,uuid,uuid),
 public.fail_accounting_preparation(uuid,uuid,uuid,integer,bigint,text,timestamptz),
 public.record_accounting_preparation(uuid,uuid,uuid,integer,bigint,jsonb),
 public.consume_accounting_preparation_control(uuid,uuid,uuid,integer,bigint),
 public.reserve_accounting_refresh_delivery(uuid,uuid,text,text,bigint,uuid,integer),
 public.update_accounting_refresh_attempt(uuid,uuid,text,text,bigint,uuid,uuid,integer,text,text,text,timestamptz,timestamptz,text,uuid) from public,anon,authenticated;
grant execute on function public.read_accounting_preparation(uuid,uuid,uuid,integer,bigint),
 public.read_accounting_preparation_readiness(uuid,text,text,date),
 public.complete_accounting_preparation(uuid,uuid,uuid,integer,bigint,date,uuid,uuid),
 public.fail_accounting_preparation(uuid,uuid,uuid,integer,bigint,text,timestamptz),
 public.record_accounting_preparation(uuid,uuid,uuid,integer,bigint,jsonb),
 public.consume_accounting_preparation_control(uuid,uuid,uuid,integer,bigint),
 public.reserve_accounting_refresh_delivery(uuid,uuid,text,text,bigint,uuid,integer),
 public.update_accounting_refresh_attempt(uuid,uuid,text,text,bigint,uuid,uuid,integer,text,text,text,timestamptz,timestamptz,text,uuid) to service_role;
