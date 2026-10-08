-- Phase 7.3: bind the existing Xero engine to durable authority. No job creation,
-- scheduler activation, provider retrieval or automatic Production enablement.
alter table public.xero_oauth_grants add column authorization_revision uuid not null default gen_random_uuid();

-- Park the committed accounting handoff without keeping a dead worker lease.
alter table public.accounting_refresh_jobs drop constraint accounting_refresh_jobs_check1;
alter table public.accounting_refresh_jobs add constraint accounting_refresh_execution_authority check (
 (phase='running' and worker_id is not null and attempt_expires_at is not null)
 or (phase='preparing' and work_stage='derivatives')
 or (phase not in('running','preparing') and worker_id is null and attempt_expires_at is null));
alter table accounting_refresh_private.dispatch_config add column xero_enabled boolean not null default false;

create table accounting_refresh_private.xero_runs (
 sync_run_id uuid primary key references public.xero_sync_runs(id) on delete cascade,
 job_id uuid not null references public.accounting_refresh_jobs(id) on delete cascade,
 attempt_id uuid not null, worker_id uuid not null, attempt_number integer not null,
 connection_epoch bigint not null, lease_owner uuid not null, fencing_token bigint not null,
 bound_at timestamptz not null default clock_timestamp(),
 handoff_at timestamptz, financial_epoch bigint, projection_revision bigint,
 diagnostics jsonb not null default '{}'::jsonb check(jsonb_typeof(diagnostics)='object')
);
create index accounting_xero_run_job on accounting_refresh_private.xero_runs(job_id,bound_at desc);
alter table accounting_refresh_private.xero_runs enable row level security;
revoke all on accounting_refresh_private.xero_runs from public,anon,authenticated,service_role;

-- Capture connection authority for compatibility acquisitions too. Existing
-- generation fencing stays authoritative; this snapshot only rejects relinks.
create table accounting_refresh_private.xero_publication_connections (
 sync_run_id uuid primary key references public.xero_sync_runs(id) on delete cascade,
 connection_id uuid not null references public.accounting_refresh_connections(id) on delete cascade,
 connection_epoch bigint not null, grant_id uuid not null, authorization_revision uuid not null
);
alter table accounting_refresh_private.xero_publication_connections enable row level security;
revoke all on accounting_refresh_private.xero_publication_connections from public,anon,authenticated,service_role;

-- Called while the source connection is locked. Only control authority changes;
-- retained accounting and all operational/billing history are untouched.
create function accounting_refresh_private.invalidate_xero_scope(p_user uuid,p_tenant text,p_grant uuid,p_disconnected boolean,p_reason text)
returns void language plpgsql set search_path=pg_catalog as $$
declare c public.accounting_refresh_connections; t timestamptz:=clock_timestamp();
begin
 select * into c from public.accounting_refresh_connections where user_id=p_user and provider='xero' and provider_organisation_id=p_tenant for update;
 if not found then return;end if;
 update public.accounting_refresh_connections set connection_epoch=connection_epoch+1,
   authority_key=coalesce(p_grant::text,'unlinked'),invalidated_at=case when p_disconnected then t else null end,
   last_epoch_reason=p_reason,updated_at=t where id=c.id;
 update public.accounting_refresh_jobs set phase='cancelled',completed_at=t,worker_id=null,attempt_expires_at=null,
   delivery_owner=null,delivery_expires_at=null where connection_id=c.id and phase not in('complete','cancelled');
end $$;
create function accounting_refresh_private.xero_connection_changed() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$
begin
 if new.grant_id is distinct from old.grant_id or
   (new.auth_state is distinct from old.auth_state and (new.auth_state in('disconnected','reauth_required') or old.auth_state in('disconnected','reauth_required'))) then
   perform accounting_refresh_private.invalidate_xero_scope(new.user_id,new.tenant_id,new.grant_id,
     new.grant_id is null or new.auth_state in('disconnected','reauth_required'),
     case when new.grant_id is null or new.auth_state='disconnected' then 'disconnect' else 'credential_relink' end);
 end if;
 return new;
end $$;
create trigger accounting_xero_connection_epoch after update of grant_id,auth_state on public.xero_connections_public
 for each row execute function accounting_refresh_private.xero_connection_changed();

-- OAuth callback explicitly changes this revision; ordinary encrypted token
-- rotation does not. Lock source connections before control rows, just like
-- acquisition/publication/disconnect, including when several grants coexist.
create function accounting_refresh_private.xero_grant_relinked() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$
declare x public.xero_connections_public;
begin
 if new.authorization_revision is distinct from old.authorization_revision then
   for x in select * from public.xero_connections_public where user_id=new.user_id and grant_id=new.id order by tenant_id for update loop
     perform accounting_refresh_private.invalidate_xero_scope(x.user_id,x.tenant_id,x.grant_id,false,'credential_relink');
   end loop;
 end if;
 return new;
end $$;
create trigger accounting_xero_grant_epoch after update of authorization_revision on public.xero_oauth_grants
 for each row execute function accounting_refresh_private.xero_grant_relinked();

create function public.acquire_accounting_xero_run(p_job_id uuid,p_attempt_id uuid,p_worker_id uuid,p_attempt_number integer,p_connection_epoch bigint,p_lease_owner uuid)
returns table(acquired boolean,result_code text,sync_run_id uuid,fencing_token bigint,lease_expires_at timestamptz)
language plpgsql security definer set search_path=pg_catalog as $$
declare j public.accounting_refresh_jobs; r record;
begin
 select * into j from public.accounting_refresh_jobs where id=p_job_id;
 if not found or j.provider<>'xero' or j.work_stage<>'accounting' then raise exception 'accounting_xero_invalid_scope' using errcode='42501';end if;
 perform 1 from public.xero_connections_public where user_id=j.user_id and tenant_id=j.provider_organisation_id for update;
 j:=accounting_refresh_private.lock_attempt(j.id,j.user_id,j.provider,j.provider_organisation_id,p_connection_epoch,p_attempt_id,p_worker_id,p_attempt_number);
 -- Never refetch a run whose publication committed with a lost response.
 if j.generation_run_id is not null and exists(select 1 from public.xero_sync_runs where id=j.generation_run_id and status='succeeded') then
   return query select false,'already_promoted'::text,j.generation_run_id,null::bigint,null::timestamptz;return;
 end if;
 select * into r from public.acquire_xero_sync_run(j.user_id,j.provider_organisation_id,p_lease_owner,'collections_v1',300);
 if r.acquired then
   insert into accounting_refresh_private.xero_runs(sync_run_id,job_id,attempt_id,worker_id,attempt_number,connection_epoch,lease_owner,fencing_token)
     values(r.sync_run_id,j.id,p_attempt_id,p_worker_id,p_attempt_number,p_connection_epoch,p_lease_owner,r.fencing_token)
     on conflict on constraint xero_runs_pkey do nothing;
   if not exists(select 1 from accounting_refresh_private.xero_runs b where b.sync_run_id=r.sync_run_id and b.job_id=j.id and b.attempt_id=p_attempt_id and b.worker_id=p_worker_id) then
     raise exception 'accounting_xero_binding_conflict' using errcode='40001';end if;
   update public.accounting_refresh_jobs set generation_run_id=r.sync_run_id where id=j.id;
 elsif r.result_code='lease_held' then
   -- Observe a compatibility-route run without taking its publication authority.
   select latest_sync_run_id into r.sync_run_id from public.xero_sync_tenant_state where user_id=j.user_id and tenant_id=j.provider_organisation_id;
   update public.accounting_refresh_jobs set generation_run_id=r.sync_run_id where id=j.id;
 end if;
 return query select r.acquired,r.result_code,r.sync_run_id,r.fencing_token,r.lease_expires_at;
end $$;

create function accounting_refresh_private.handoff_xero(j public.accounting_refresh_jobs) returns jsonb
language plpgsql set search_path=pg_catalog as $$
declare r public.xero_sync_runs; d public.collection_dependency_heads;
begin
 select * into r from public.xero_sync_runs where id=j.generation_run_id;
 if r.status is distinct from 'succeeded' or r.user_id<>j.user_id or r.tenant_id<>j.provider_organisation_id then
   raise exception 'accounting_xero_not_promoted' using errcode='40001';end if;
 select * into d from public.collection_dependency_heads where user_id=j.user_id and tenant_id=j.provider_organisation_id and source_system='xero'
   and exists(select 1 from public.xero_sync_tenant_state s where s.user_id=j.user_id and s.tenant_id=j.provider_organisation_id and s.active_sync_run_id=r.id);
 update public.accounting_refresh_jobs set phase='preparing',work_stage='derivatives',worker_id=null,attempt_expires_at=null,
   delivery_owner=null,delivery_expires_at=null,failure_class=null,failure_code=null,retry_source='none' where id=j.id returning * into j;
 update accounting_refresh_private.xero_runs set handoff_at=coalesce(handoff_at,clock_timestamp()),
   financial_epoch=coalesce(financial_epoch,d.financial_epoch),projection_revision=coalesce(projection_revision,d.projection_revision) where sync_run_id=r.id;
 return jsonb_build_object('resultCode','promoted','job',accounting_refresh_private.job_json(j),'runId',r.id,
   'promotedAt',r.completed_at,'financialEpoch',d.financial_epoch::text,'projectionRevision',d.projection_revision::text);
end $$;

create function public.inspect_accounting_xero_result(p_job_id uuid,p_connection_epoch bigint)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare j public.accounting_refresh_jobs; c public.accounting_refresh_connections; r public.xero_sync_runs;
begin
 select * into j from public.accounting_refresh_jobs where id=p_job_id;
 if not found or j.provider<>'xero' then raise exception 'accounting_xero_invalid_scope' using errcode='42501';end if;
 perform 1 from public.xero_connections_public where user_id=j.user_id and tenant_id=j.provider_organisation_id for update;
 c:=accounting_refresh_private.lock_connection(j.connection_id,j.user_id,j.provider,j.provider_organisation_id,p_connection_epoch);
 select * into j from public.accounting_refresh_jobs where id=p_job_id for update;
 if j.connection_epoch<>c.connection_epoch or not accounting_refresh_private.available(c) or j.phase in('cancelled','complete') then
   raise exception 'accounting_xero_stale_authority' using errcode='40001';end if;
 select * into r from public.xero_sync_runs where id=j.generation_run_id and user_id=j.user_id and tenant_id=j.provider_organisation_id;
 if r.status='succeeded' then return accounting_refresh_private.handoff_xero(j);end if;
 return jsonb_build_object('resultCode',coalesce(r.status,'unbound'),'runId',r.id,'leaseExpiresAt',r.lease_expires_at,'errorCode',r.error_code);
end $$;

-- Keep the existing engine byte-for-byte. Both compatibility and durable paths
-- enter this boundary; only a bound durable run requires attempt authority.
alter function public.promote_xero_sync_run_with_promises(uuid,uuid,bigint,timestamptz,jsonb) rename to promote_xero_sync_run_with_promises_engine;
revoke all on function public.promote_xero_sync_run_with_promises_engine(uuid,uuid,bigint,timestamptz,jsonb) from public,anon,authenticated,service_role;
create function public.promote_xero_sync_run_with_promises(p_sync_run_id uuid,p_lease_owner uuid,p_fencing_token bigint,p_snapshot_as_of timestamptz,p_reconciliation jsonb)
returns table(promoted boolean,result_code text,promoted_at timestamptz)
language plpgsql security definer set search_path=pg_catalog as $$
declare r public.xero_sync_runs; x public.xero_connections_public; b accounting_refresh_private.xero_runs; j public.accounting_refresh_jobs; outcome record; scope record; c public.accounting_refresh_connections;
begin
 select * into r from public.xero_sync_runs where id=p_sync_run_id;
 if not found then return query select false,'run_not_found'::text,null::timestamptz;return;end if;
 select * into x from public.xero_connections_public where user_id=r.user_id and tenant_id=r.tenant_id for update;
 if x.auth_state is distinct from 'active' or x.grant_id is null then return query select false,'connection_authority_lost'::text,null::timestamptz;return;end if;
 select * into scope from accounting_refresh_private.xero_publication_connections where sync_run_id=r.id;
 if found then
   c:=accounting_refresh_private.lock_connection(scope.connection_id,r.user_id,'xero',r.tenant_id,scope.connection_epoch);
   if not accounting_refresh_private.available(c) or x.grant_id is distinct from scope.grant_id or not exists(
     select 1 from public.xero_oauth_grants g where g.id=x.grant_id and g.user_id=r.user_id and g.authorization_revision=scope.authorization_revision) then
     raise exception 'accounting_xero_connection_changed' using errcode='40001';end if;
 end if;
 select * into b from accounting_refresh_private.xero_runs where sync_run_id=r.id;
 if found then
   -- Source connection -> control connection/job -> existing state/run/Promise.
   select * into j from public.accounting_refresh_jobs where id=b.job_id;
   j:=accounting_refresh_private.lock_attempt(j.id,j.user_id,j.provider,j.provider_organisation_id,b.connection_epoch,b.attempt_id,b.worker_id,b.attempt_number);
   if b.lease_owner is distinct from p_lease_owner or b.fencing_token is distinct from p_fencing_token or j.generation_run_id is distinct from r.id then
     raise exception 'accounting_xero_stale_binding' using errcode='40001';end if;
 end if;
 select * into outcome from public.promote_xero_sync_run_with_promises_engine(p_sync_run_id,p_lease_owner,p_fencing_token,p_snapshot_as_of,p_reconciliation);
 if outcome.promoted and j.id is not null then
   j:=accounting_refresh_private.lock_attempt(j.id,j.user_id,j.provider,j.provider_organisation_id,b.connection_epoch,b.attempt_id,b.worker_id,b.attempt_number);
   perform accounting_refresh_private.handoff_xero(j);
 end if;
 return query select outcome.promoted,outcome.result_code,outcome.promoted_at;
end $$;

-- Test-only real acceptance through the same foundation RPC, with exact owned
-- source resolution in SQL. Disabled by default; no browser or HTTP endpoint.
create function public.accept_test_xero_accounting_refresh(p_user_id uuid,p_tenant_id text,p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare c jsonb; x public.xero_connections_public; config accounting_refresh_private.dispatch_config;
begin
 select * into config from accounting_refresh_private.dispatch_config where singleton;
 if config.project_ref is distinct from 'rbmxegyiwntomhpbepnu' or not config.xero_enabled then raise exception 'accounting_xero_test_disabled' using errcode='42501';end if;
 select * into x from public.xero_connections_public where user_id=p_user_id and tenant_id=p_tenant_id for update;
 if not found or x.auth_state<>'active' or x.grant_id is null then raise exception 'accounting_xero_invalid_connection' using errcode='42501';end if;
 c:=public.register_accounting_refresh_connection(x.user_id,'xero',x.tenant_id,x.tenant_id,x.grant_id::text);
 return public.accept_accounting_refresh((c->>'connectionId')::uuid,x.user_id,'xero',x.tenant_id,(c->>'epoch')::bigint,'internal',p_idempotency_key);
end $$;

revoke all on all functions in schema accounting_refresh_private from public,anon,authenticated,service_role;
revoke all on function public.acquire_accounting_xero_run(uuid,uuid,uuid,integer,bigint,uuid),public.inspect_accounting_xero_result(uuid,bigint),
 public.accept_test_xero_accounting_refresh(uuid,text,text),public.promote_xero_sync_run_with_promises(uuid,uuid,bigint,timestamptz,jsonb) from public,anon,authenticated;
grant execute on function public.acquire_accounting_xero_run(uuid,uuid,uuid,integer,bigint,uuid),public.inspect_accounting_xero_result(uuid,bigint),
 public.accept_test_xero_accounting_refresh(uuid,text,text),public.promote_xero_sync_run_with_promises(uuid,uuid,bigint,timestamptz,jsonb) to service_role;

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
   -- Explicit Test gate permits Xero accounting-stage work; parked derivative
   -- handoffs are not dispatched until Phase 7.5. No freshness intent is created.
   for job in select item from public.list_accounting_refresh_work(200) item
     left join accounting_refresh_private.synthetic_jobs spec on spec.job_id=(item->>'id')::uuid
     where ((item#>>'{connection,provider}'='foundation_certification' and spec.job_id is not null)
       or (config.xero_enabled and config.project_ref='rbmxegyiwntomhpbepnu' and item#>>'{connection,provider}'='xero' and item->>'stage'='accounting'))
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
 elsif job.provider='xero' and job.work_stage='accounting' and config.xero_enabled and config.project_ref='rbmxegyiwntomhpbepnu' then
   return jsonb_build_object('projectRef',config.project_ref,'mode','xero','job',accounting_refresh_private.job_json(job));
 end if;
 return null;
end $$;

-- Exact-run recovery precedes abandoned-attempt retry. A succeeded generation
-- is a committed result, independent of delivery diagnostics or worker liveness.
alter function public.recover_accounting_refresh_work(integer) rename to recover_accounting_refresh_work_foundation;
revoke all on function public.recover_accounting_refresh_work_foundation(integer) from public,anon,authenticated,service_role;
create function public.recover_accounting_refresh_work(p_limit integer default 25) returns integer
language plpgsql security definer set search_path=pg_catalog as $$
declare j record; recovered integer:=0;
begin
 for j in select w.id,w.connection_epoch from public.accounting_refresh_jobs w join public.xero_sync_runs r on r.id=w.generation_run_id
   where w.provider='xero' and w.phase in('running','retry_wait') and r.status='succeeded'
     and (w.attempt_expires_at<=clock_timestamp() or w.phase='retry_wait')
   order by w.attempt_expires_at,w.id limit greatest(0,least(coalesce(p_limit,25),200)) loop
   begin
     perform public.inspect_accounting_xero_result(j.id,j.connection_epoch);recovered:=recovered+1;
   exception when serialization_failure then null;end;
 end loop;
 return recovered+public.recover_accounting_refresh_work_foundation(p_limit);
end $$;
grant execute on function public.recover_accounting_refresh_work(integer) to service_role;
revoke all on function public.recover_accounting_refresh_work(integer) from public,anon,authenticated;

create function public.record_accounting_xero_diagnostics(p_job_id uuid,p_attempt_id uuid,p_run_id uuid,p_diagnostics jsonb) returns boolean
language plpgsql security definer set search_path=pg_catalog as $$
begin
 if p_diagnostics is null or jsonb_typeof(p_diagnostics)<>'object' or p_diagnostics-array['totalMs','providerMs','mappingMs','validationMs','promotionMs','providerRequests','providerRetries','promiseProposals','promiseRecomputations','contacts','invoices','payments']<>'{}' or
   exists(select 1 from jsonb_each(p_diagnostics) e where jsonb_typeof(e.value)<>'number' or (e.value::text)::numeric<0) then
   raise exception 'accounting_xero_invalid_diagnostics' using errcode='22023';end if;
 update accounting_refresh_private.xero_runs set diagnostics=p_diagnostics where sync_run_id=p_run_id and job_id=p_job_id and attempt_id=p_attempt_id;
 return found;
end $$;
revoke all on function public.record_accounting_xero_diagnostics(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.record_accounting_xero_diagnostics(uuid,uuid,uuid,jsonb) to service_role;

-- Retain the proven admission/abandonment/fence engine; record epoch authority
-- in the same short acquisition transaction, including legacy callers.
alter function public.acquire_xero_sync_run(uuid,text,uuid,text,integer) rename to acquire_xero_sync_run_engine;
revoke all on function public.acquire_xero_sync_run_engine(uuid,text,uuid,text,integer) from public,anon,authenticated,service_role;
create function public.acquire_xero_sync_run(p_user_id uuid,p_tenant_id text,p_lease_owner uuid,p_scope_version text default 'collections_v1',p_ttl_seconds integer default 300)
returns table(acquired boolean,result_code text,sync_run_id uuid,fencing_token bigint,lease_expires_at timestamptz)
language plpgsql security definer set search_path=pg_catalog as $$
declare x public.xero_connections_public; c jsonb; r record; revision uuid;
begin
 select * into x from public.xero_connections_public where user_id=p_user_id and tenant_id=btrim(p_tenant_id) for update;
 if found and x.auth_state='active' and x.grant_id is not null then
   c:=public.register_accounting_refresh_connection(x.user_id,'xero',x.tenant_id,x.tenant_id,x.grant_id::text);
   select authorization_revision into revision from public.xero_oauth_grants where id=x.grant_id and user_id=x.user_id;
 end if;
 select * into r from public.acquire_xero_sync_run_engine(p_user_id,p_tenant_id,p_lease_owner,p_scope_version,p_ttl_seconds);
 if r.acquired then
   insert into accounting_refresh_private.xero_publication_connections(sync_run_id,connection_id,connection_epoch,grant_id,authorization_revision)
     values(r.sync_run_id,(c->>'connectionId')::uuid,(c->>'epoch')::bigint,x.grant_id,revision)
     on conflict on constraint xero_publication_connections_pkey do nothing;
 end if;
 return query select r.acquired,r.result_code,r.sync_run_id,r.fencing_token,r.lease_expires_at;
end $$;
revoke all on function public.acquire_xero_sync_run(uuid,text,uuid,text,integer) from public,anon,authenticated;
grant execute on function public.acquire_xero_sync_run(uuid,text,uuid,text,integer) to service_role;

-- A revoked old refresh token cannot invalidate a newly relinked grant. Keep
-- the established refresh lock intact; fence health/token clearing by both
-- lock owner and the captured OAuth authorization revision in one transaction.
create function public.record_xero_grant_auth_failure(p_user_id uuid,p_grant_id uuid,p_lock_id uuid,p_authorization_revision uuid)
returns boolean language plpgsql security definer set search_path=pg_catalog as $$
declare g public.xero_oauth_grants;
begin
 select * into g from public.xero_oauth_grants where id=p_grant_id and user_id=p_user_id for update;
 if not found or p_lock_id is null or p_authorization_revision is null or g.refresh_lock_expires_at is null or g.refresh_lock_id is distinct from p_lock_id or g.authorization_revision is distinct from p_authorization_revision
   or g.refresh_lock_expires_at<=clock_timestamp() then return false;end if;
 update public.xero_oauth_grants set access_token_encrypted=null where id=g.id;
 update public.xero_connections_public set auth_state='reauth_required',reauth_required_at=clock_timestamp(),last_refresh_error='refresh_token_invalid'
   where user_id=g.user_id and grant_id=g.id;
 return true;
end $$;
revoke all on function public.record_xero_grant_auth_failure(uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.record_xero_grant_auth_failure(uuid,uuid,uuid,uuid) to service_role;
