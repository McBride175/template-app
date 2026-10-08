-- Phase 7.2 transport only: no creation of refresh intent from connection age.
-- pg_cron can only be installed in its configured database. Disposable replay
-- databases compile the functions and replace HTTP submission in their tests.
do $$ begin
 if current_database()='postgres' then
   create extension if not exists pg_cron;
   create extension if not exists pg_net;
   revoke all on schema net from public,anon,authenticated,service_role;
   revoke all on all tables in schema net from public,anon,authenticated,service_role;
   revoke all on all functions in schema net from public,anon,authenticated,service_role;
 end if;
end $$;

create table accounting_refresh_private.dispatch_config (
 singleton boolean primary key default true check(singleton),
 enabled boolean not null default false,
 project_ref text,
 synthetic_only boolean not null default true check(synthetic_only),
 updated_at timestamptz not null default clock_timestamp()
);
insert into accounting_refresh_private.dispatch_config(singleton) values(true);
-- Disposable certification allowlist and observations, not another queue.
create table accounting_refresh_private.synthetic_jobs (
 job_id uuid primary key references public.accounting_refresh_jobs(id) on delete cascade,
 scenario text not null check(scenario in('complete','delay_complete','retry_once','attention','disappear')),
 delay_seconds integer not null default 0 check(delay_seconds between 0 and 40),
 received_count integer not null default 0,
 claimed_count integer not null default 0,
 heartbeat_count integer not null default 0,
 completed_count integer not null default 0,
 failure_count integer not null default 0,
 last_event text,
 last_result_attempt_id uuid,
 updated_at timestamptz not null default clock_timestamp()
);
create table accounting_refresh_private.dispatch_ticks (
 id uuid primary key default gen_random_uuid(),
 source text not null check(source in('cron','immediate','completion','internal')),
 observed_at timestamptz not null default clock_timestamp(),
 duration_ms numeric not null,
 recovered_deliveries integer not null,
 recovered_attempts integer not null,
 occupied integer not null,
 eligible integer not null,
 submitted integer not null,
 result_code text not null
);
create index accounting_dispatch_tick_retention on accounting_refresh_private.dispatch_ticks(observed_at);
-- Bounded counts avoid scanning terminal history.
create index accounting_refresh_live_attempts on public.accounting_refresh_jobs(attempt_expires_at) where phase in('running','preparing');
create index accounting_refresh_live_deliveries on public.accounting_refresh_jobs(delivery_expires_at) where delivery_owner is not null;
alter table accounting_refresh_private.dispatch_config enable row level security;
alter table accounting_refresh_private.synthetic_jobs enable row level security;
alter table accounting_refresh_private.dispatch_ticks enable row level security;
revoke all on accounting_refresh_private.dispatch_config,accounting_refresh_private.synthetic_jobs,accounting_refresh_private.dispatch_ticks from public,anon,authenticated,service_role;

create function accounting_refresh_private.delivery_settings() returns jsonb
language plpgsql stable set search_path=pg_catalog as $$
declare worker_url text; internal_secret text; bypass_secret text;
begin
 select decrypted_secret into worker_url from vault.decrypted_secrets where name='accounting_refresh_worker_url';
 select decrypted_secret into internal_secret from vault.decrypted_secrets where name='accounting_refresh_internal_secret';
 select decrypted_secret into bypass_secret from vault.decrypted_secrets where name='accounting_refresh_preview_bypass';
 if worker_url is null or worker_url !~ '^https://[a-zA-Z0-9-]+\.vercel\.app/api/internal/accounting/refresh-worker$'
   or worker_url like '%-git-%' or char_length(coalesce(internal_secret,''))<32 then
   raise exception 'accounting_dispatch_configuration_invalid';end if;
 return jsonb_build_object('url',worker_url,'secret',internal_secret,'bypass',bypass_secret);
end $$;
create function accounting_refresh_private.submit_delivery(p_settings jsonb,p_project text,p_job uuid,p_delivery uuid) returns bigint
language plpgsql set search_path=pg_catalog as $$
declare headers jsonb; request_id bigint;
begin
 headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||(p_settings->>'secret'),'x-accounting-project-ref',p_project);
 if nullif(p_settings->>'bypass','') is not null then headers:=headers||jsonb_build_object('x-vercel-protection-bypass',p_settings->>'bypass');end if;
 select net.http_post(url:=p_settings->>'url',headers:=headers,
   body:=jsonb_build_object('jobId',p_job,'deliveryId',p_delivery),timeout_milliseconds:=310000) into request_id;
 return request_id;
end $$;

create function public.dispatch_accounting_refresh(p_source text default 'internal') returns jsonb
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
   -- Synthetic-only allowlist prevents delivery of any real provider intent.
   for job in select item from public.list_accounting_refresh_work(200) item
     join accounting_refresh_private.synthetic_jobs spec on spec.job_id=(item->>'id')::uuid
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

create function public.load_accounting_refresh_delivery(p_job_id uuid,p_delivery_id uuid) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog as $$
declare job public.accounting_refresh_jobs; spec accounting_refresh_private.synthetic_jobs; config accounting_refresh_private.dispatch_config;
begin
 select * into config from accounting_refresh_private.dispatch_config where singleton;
 if not config.enabled then return null;end if;
 select * into job from public.accounting_refresh_jobs where id=p_job_id and delivery_id=p_delivery_id;
 if not found or job.provider<>'foundation_certification' then return null;end if;
 if not ((job.phase in('queued','retry_wait') and job.delivery_expires_at>statement_timestamp())
   or (job.phase in('running','preparing') and job.attempt_expires_at>statement_timestamp())) then return null;end if;
 if not exists(select 1 from public.accounting_refresh_connections c where c.id=job.connection_id and c.connection_epoch=job.connection_epoch and c.invalidated_at is null) then return null;end if;
 select * into spec from accounting_refresh_private.synthetic_jobs where job_id=job.id;
 if not found then return null;end if;
 return jsonb_build_object('projectRef',config.project_ref,'job',accounting_refresh_private.job_json(job),
   'synthetic',jsonb_build_object('scenario',spec.scenario,'delaySeconds',spec.delay_seconds));
end $$;

create function public.record_accounting_refresh_worker_event(p_job_id uuid,p_attempt_id uuid,p_worker_id uuid,p_event text) returns boolean
language plpgsql security definer set search_path=pg_catalog as $$
declare job public.accounting_refresh_jobs;
begin
 select * into job from public.accounting_refresh_jobs where id=p_job_id;
 if job.provider is distinct from 'foundation_certification' or job.attempt_id is distinct from p_attempt_id
   or (p_event<>'result' and (job.worker_id is distinct from p_worker_id or job.attempt_expires_at<=clock_timestamp()))
   or not exists(select 1 from public.accounting_refresh_connections c where c.id=job.connection_id and c.connection_epoch=job.connection_epoch and c.invalidated_at is null)
   or p_event is null or p_event not in('claimed','heartbeat','result') then raise exception 'accounting_worker_event_invalid' using errcode='40001';end if;
 update accounting_refresh_private.synthetic_jobs set claimed_count=claimed_count+case when p_event='claimed' then 1 else 0 end,
   heartbeat_count=heartbeat_count+case when p_event='heartbeat' then 1 else 0 end,
   completed_count=completed_count+case when p_event='result' and job.phase='complete' then 1 else 0 end,
   failure_count=failure_count+case when p_event='result' and job.phase in('retry_wait','attention_required','reconnect_required') then 1 else 0 end,
   last_result_attempt_id=case when p_event='result' then p_attempt_id else last_result_attempt_id end,
   last_event=p_event,updated_at=clock_timestamp() where job_id=job.id and (p_event<>'result' or last_result_attempt_id is distinct from p_attempt_id);
 return true;
end $$;

-- Explicit Test-only activation; migrations never create a cron job or enable config.
create function public.set_accounting_refresh_cron(p_enabled boolean) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare config accounting_refresh_private.dispatch_config; existing record; cron_id bigint;
begin
 select * into config from accounting_refresh_private.dispatch_config where singleton for update;
 if config.project_ref is distinct from 'rbmxegyiwntomhpbepnu' then raise exception 'accounting_dispatch_test_only' using errcode='42501';end if;
 if p_enabled is null then raise exception 'accounting_dispatch_invalid_activation';end if;
 if p_enabled then perform accounting_refresh_private.delivery_settings();end if;
 for existing in select jobid from cron.job where jobname='yuohme-accounting-dispatch-v1' loop perform cron.unschedule(existing.jobid);end loop;
 update accounting_refresh_private.dispatch_config set enabled=p_enabled,updated_at=clock_timestamp() where singleton;
 if p_enabled then select cron.schedule('yuohme-accounting-dispatch-v1','* * * * *','select public.dispatch_accounting_refresh(''cron'');') into cron_id;end if;
 return jsonb_build_object('enabled',p_enabled,'jobId',cron_id);
end $$;

revoke all on function public.dispatch_accounting_refresh(text),public.load_accounting_refresh_delivery(uuid,uuid),
 public.record_accounting_refresh_worker_event(uuid,uuid,uuid,text),public.set_accounting_refresh_cron(boolean) from public,anon,authenticated;
grant execute on function public.dispatch_accounting_refresh(text),public.load_accounting_refresh_delivery(uuid,uuid),
 public.record_accounting_refresh_worker_event(uuid,uuid,uuid,text),public.set_accounting_refresh_cron(boolean) to service_role;
revoke all on function accounting_refresh_private.delivery_settings(),accounting_refresh_private.submit_delivery(jsonb,text,uuid,uuid) from public,anon,authenticated,service_role;
