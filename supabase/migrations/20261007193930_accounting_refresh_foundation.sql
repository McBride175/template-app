-- Phase 7.1: dormant service-only control plane. No triggers on business tables,
-- provider retrieval, generation writes, billing claims, cron or HTTP delivery.
create schema accounting_refresh_private authorization postgres;
revoke all on schema accounting_refresh_private from public, anon, authenticated, service_role;

create table public.accounting_refresh_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider ~ '^[a-z][a-z0-9_]{0,31}$'),
  provider_organisation_id text not null check (provider_organisation_id = btrim(provider_organisation_id) and char_length(provider_organisation_id) between 1 and 500),
  connection_key text not null check (char_length(connection_key) between 1 and 500),
  authority_key text not null check (char_length(authority_key) between 1 and 500),
  connection_epoch bigint not null default 1 check (connection_epoch > 0),
  invalidated_at timestamptz check (isfinite(invalidated_at)),
  last_epoch_reason text check (last_epoch_reason in ('disconnect','reconnect','credential_relink','organisation_changed')),
  cooldown_until timestamptz check (isfinite(cooldown_until)),
  provider_not_before timestamptz check (isfinite(provider_not_before)),
  last_product_activity_at timestamptz check (isfinite(last_product_activity_at)),
  next_scheduled_due_at timestamptz check (isfinite(next_scheduled_due_at)),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (user_id, provider, provider_organisation_id),
  unique (id, user_id, provider, provider_organisation_id)
);
create table public.accounting_refresh_jobs (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null,
  user_id uuid not null,
  provider text not null,
  provider_organisation_id text not null,
  connection_epoch bigint not null check (connection_epoch > 0),
  phase text not null default 'queued' check (phase in ('queued','running','preparing','complete','retry_wait','reconnect_required','attention_required','cancelled')),
  work_stage text not null default 'accounting' check (work_stage in ('accounting','derivatives')),
  trigger text not null check (trigger in ('scheduled','opportunistic','manual','onboarding','reconnect','internal')),
  latest_trigger text not null check (latest_trigger in ('scheduled','opportunistic','manual','onboarding','reconnect','internal')),
  priority smallint generated always as (case trigger when 'onboarding' then 60 when 'manual' then 50 when 'reconnect' then 40 when 'internal' then 30 when 'opportunistic' then 20 else 10 end) stored,
  request_count bigint not null default 1 check (request_count > 0),
  requested_at timestamptz not null default clock_timestamp(),
  last_requested_at timestamptz not null default clock_timestamp(),
  next_eligible_at timestamptz not null default clock_timestamp() check (isfinite(next_eligible_at)),
  delivery_id uuid,
  delivery_owner uuid,
  delivery_expires_at timestamptz check (isfinite(delivery_expires_at)),
  last_reserved_at timestamptz,
  attempt_number integer not null default 0 check (attempt_number >= 0),
  attempt_id uuid,
  worker_id uuid,
  attempt_expires_at timestamptz check (isfinite(attempt_expires_at)),
  claimed_at timestamptz,
  heartbeat_at timestamptz,
  retry_count integer not null default 0 check (retry_count >= 0),
  failure_class text check (failure_class in ('transient','rate_limited','quota_limited','reconnect_required','deterministic_failure','preparation_failure','unknown')),
  failure_code text check (failure_code ~ '^[a-z][a-z0-9_]{0,63}$'),
  failed_at timestamptz,
  retry_source text not null default 'none' check (retry_source in ('local','provider','probe','none')),
  provider_not_before timestamptz check (isfinite(provider_not_before)),
  generation_run_id uuid,
  completed_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  foreign key (connection_id,user_id,provider,provider_organisation_id)
    references public.accounting_refresh_connections(id,user_id,provider,provider_organisation_id) on delete cascade,
  unique (id,connection_id,user_id,provider,provider_organisation_id),
  check ((phase in ('complete','cancelled')) = (completed_at is not null)),
  check ((phase in ('running','preparing')) = (worker_id is not null and attempt_expires_at is not null)),
  check ((worker_id is null) = (attempt_expires_at is null)),
  check ((attempt_number = 0) = (attempt_id is null)),
  check (attempt_number = 0 or (claimed_at is not null and heartbeat_at is not null)),
  check ((delivery_owner is null) = (delivery_expires_at is null)),
  check (delivery_owner is null or (delivery_id is not null and phase in ('queued','retry_wait'))),
  check ((failure_class is null) = (failure_code is null)),
  check (failure_class is null or failed_at is not null),
  check (phase <> 'preparing' or work_stage = 'derivatives')
);
-- Blocked and retry-wait jobs are nonterminal: a new click cannot bypass them.
create unique index accounting_refresh_one_active_job
  on public.accounting_refresh_jobs(user_id,provider,provider_organisation_id)
  where phase not in ('complete','cancelled');
create index accounting_refresh_eligible
  on public.accounting_refresh_jobs(next_eligible_at,priority desc,requested_at,id)
  where phase in ('queued','retry_wait');
create index accounting_refresh_attempt_expiry on public.accounting_refresh_jobs(attempt_expires_at)
  where phase in ('running','preparing');
create index accounting_refresh_delivery_expiry on public.accounting_refresh_jobs(delivery_expires_at)
  where delivery_owner is not null;
create index accounting_refresh_recent on public.accounting_refresh_jobs(connection_id,requested_at desc,id desc);
create index accounting_refresh_retention on public.accounting_refresh_jobs(completed_at,id)
  where phase in ('complete','cancelled');
create index accounting_refresh_schedule on public.accounting_refresh_connections(next_scheduled_due_at,id)
  where invalidated_at is null and next_scheduled_due_at is not null;

create table public.accounting_refresh_request_keys (
  connection_id uuid not null,
  user_id uuid not null,
  provider text not null,
  provider_organisation_id text not null,
  key_hash bytea not null check (octet_length(key_hash) = 32),
  job_id uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key (user_id,provider,provider_organisation_id,key_hash),
  foreign key (job_id,connection_id,user_id,provider,provider_organisation_id)
    references public.accounting_refresh_jobs(id,connection_id,user_id,provider,provider_organisation_id) on delete cascade
);
create index accounting_refresh_request_job on public.accounting_refresh_request_keys(job_id);

create function accounting_refresh_private.priority(p_trigger text) returns smallint
language sql immutable set search_path=pg_catalog as $$
 select case p_trigger when 'onboarding' then 60 when 'manual' then 50 when 'reconnect' then 40 when 'internal' then 30 when 'opportunistic' then 20 when 'scheduled' then 10 else null end::smallint
$$;
create function accounting_refresh_private.job_json(j public.accounting_refresh_jobs) returns jsonb
language sql stable set search_path=pg_catalog as $$
 select jsonb_build_object('id',j.id,'connection',jsonb_build_object('connectionId',j.connection_id,'ownerId',j.user_id,
   'provider',j.provider,'providerOrganisationId',j.provider_organisation_id,'epoch',j.connection_epoch::text),
   'phase',j.phase,'stage',j.work_stage,'trigger',j.trigger,'latestTrigger',j.latest_trigger,'priority',j.priority,
   'requestCount',j.request_count::text,'requestedAt',j.requested_at,'lastRequestedAt',j.last_requested_at,
   'nextEligibleAt',j.next_eligible_at,'claimedAt',j.claimed_at,'heartbeatAt',j.heartbeat_at,
   'completedAt',j.completed_at,'failedAt',j.failed_at,'attemptNumber',j.attempt_number,'retryCount',j.retry_count,
   'failureClass',j.failure_class,'failureCode',j.failure_code,'retrySource',j.retry_source,'providerNotBefore',j.provider_not_before,
   'generationRunId',j.generation_run_id,'deliveryId',j.delivery_id,'deliveryOwner',j.delivery_owner,
   'deliveryExpiresAt',j.delivery_expires_at,'lastReservedAt',j.last_reserved_at,'attemptId',j.attempt_id,
   'workerId',j.worker_id,'attemptExpiresAt',j.attempt_expires_at)
$$;
-- Only this small compatibility predicate knows Xero storage. Other providers
-- require a trusted server connector to register their verified connection.
create function accounting_refresh_private.available(c public.accounting_refresh_connections) returns boolean
language sql stable set search_path=pg_catalog as $$
 select c.invalidated_at is null and case when c.provider='xero' then exists(
   select 1 from public.xero_connections_public x join public.xero_oauth_grants g on g.id=x.grant_id and g.user_id=x.user_id
   where x.user_id=c.user_id and x.tenant_id=c.provider_organisation_id and x.tenant_id=c.connection_key
     and x.auth_state='active' and x.grant_id::text=c.authority_key) else true end
$$;
create function accounting_refresh_private.lock_connection(p_connection uuid,p_user uuid,p_provider text,p_org text,p_epoch bigint)
returns public.accounting_refresh_connections language plpgsql set search_path=pg_catalog as $$
declare c public.accounting_refresh_connections;
begin
 select * into c from public.accounting_refresh_connections where id=p_connection and user_id=p_user
   and provider=p_provider and provider_organisation_id=p_org for update;
 if not found then raise exception 'accounting_refresh_invalid_scope' using errcode='42501';end if;
 if p_epoch is null or c.connection_epoch<>p_epoch then raise exception 'accounting_refresh_stale_epoch' using errcode='40001';end if;
 return c;
end $$;
create function accounting_refresh_private.immutable_job() returns trigger
language plpgsql set search_path=pg_catalog as $$
begin
 if row(new.id,new.connection_id,new.user_id,new.provider,new.provider_organisation_id,new.connection_epoch,new.requested_at,new.created_at)
   is distinct from row(old.id,old.connection_id,old.user_id,old.provider,old.provider_organisation_id,old.connection_epoch,old.requested_at,old.created_at)
   or old.phase in ('complete','cancelled') or (old.work_stage='derivatives' and new.work_stage<>'derivatives') then
   raise exception 'accounting_refresh_immutable_identity' using errcode='22023';end if;
 new.updated_at:=clock_timestamp();return new;
end $$;
create trigger accounting_refresh_job_identity before update on public.accounting_refresh_jobs
 for each row execute function accounting_refresh_private.immutable_job();

create function public.register_accounting_refresh_connection(p_user_id uuid,p_provider text,p_provider_organisation_id text,p_connection_key text,p_authority_key text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare c public.accounting_refresh_connections; v_now timestamptz:=clock_timestamp();
begin
 if p_user_id is null or p_provider is null or p_provider !~ '^[a-z][a-z0-9_]{0,31}$'
   or p_provider_organisation_id is null or p_provider_organisation_id<>btrim(p_provider_organisation_id)
   or char_length(p_provider_organisation_id) not between 1 and 500
   or nullif(btrim(p_connection_key),'') is null or char_length(p_connection_key)>500
   or nullif(btrim(p_authority_key),'') is null or char_length(p_authority_key)>500 then
   raise exception 'accounting_refresh_invalid_connection' using errcode='22023';end if;
 if p_provider='xero' and not exists(select 1 from public.xero_connections_public x where x.user_id=p_user_id
   and x.tenant_id=p_provider_organisation_id and x.tenant_id=p_connection_key
   and coalesce(x.grant_id::text,'unlinked')=p_authority_key
   and (x.grant_id is null or exists(select 1 from public.xero_oauth_grants g where g.id=x.grant_id and g.user_id=p_user_id))) then
   raise exception 'accounting_refresh_invalid_connection' using errcode='42501';end if;
 insert into public.accounting_refresh_connections(user_id,provider,provider_organisation_id,connection_key,authority_key)
   values(p_user_id,p_provider,p_provider_organisation_id,p_connection_key,p_authority_key)
   on conflict(user_id,provider,provider_organisation_id) do nothing;
 select * into c from public.accounting_refresh_connections where user_id=p_user_id and provider=p_provider
   and provider_organisation_id=p_provider_organisation_id for update;
 if row(c.connection_key,c.authority_key) is distinct from row(p_connection_key,p_authority_key) then
   update public.accounting_refresh_connections set connection_epoch=connection_epoch+1,connection_key=p_connection_key,
     authority_key=p_authority_key,last_epoch_reason='credential_relink',updated_at=v_now where id=c.id returning * into c;
   update public.accounting_refresh_jobs set phase='cancelled',completed_at=v_now,worker_id=null,attempt_expires_at=null,
     delivery_owner=null,delivery_expires_at=null where connection_id=c.id and phase not in('complete','cancelled');
 end if;
 return jsonb_build_object('connectionId',c.id,'ownerId',c.user_id,'provider',c.provider,
   'providerOrganisationId',c.provider_organisation_id,'epoch',c.connection_epoch::text,'invalidated',c.invalidated_at is not null);
end $$;

create function public.accept_accounting_refresh(p_connection_id uuid,p_user_id uuid,p_provider text,p_provider_organisation_id text,
 p_connection_epoch bigint,p_trigger text,p_idempotency_key text default null,p_not_before timestamptz default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare c public.accounting_refresh_connections; j public.accounting_refresh_jobs; v_hash bytea; v_now timestamptz:=clock_timestamp(); v_due timestamptz; v_joined boolean;
begin
 c:=accounting_refresh_private.lock_connection(p_connection_id,p_user_id,p_provider,p_provider_organisation_id,p_connection_epoch);
 if accounting_refresh_private.priority(p_trigger) is null or (p_not_before is not null and not isfinite(p_not_before))
   or (p_idempotency_key is not null and (char_length(p_idempotency_key) not between 1 and 128 or p_idempotency_key<>btrim(p_idempotency_key))) then
   raise exception 'accounting_refresh_invalid_request' using errcode='22023';end if;
 if p_idempotency_key is not null then
   v_hash:=sha256(convert_to(p_idempotency_key,'UTF8'));
   select job.* into j from public.accounting_refresh_request_keys k join public.accounting_refresh_jobs job on job.id=k.job_id
     where k.user_id=p_user_id and k.provider=p_provider and k.provider_organisation_id=p_provider_organisation_id and k.key_hash=v_hash;
   if found then return jsonb_build_object('resultCode','replayed','job',accounting_refresh_private.job_json(j));end if;
 end if;
 if not accounting_refresh_private.available(c) then raise exception 'accounting_refresh_connection_unavailable' using errcode='55000';end if;
 v_due:=greatest(v_now,coalesce(p_not_before,v_now),c.cooldown_until,c.provider_not_before);
 select * into j from public.accounting_refresh_jobs where connection_id=c.id and phase not in('complete','cancelled') for update;
 v_joined:=found;
 if v_joined then
   if j.connection_epoch<>c.connection_epoch then raise exception 'accounting_refresh_stale_epoch' using errcode='40001';end if;
   update public.accounting_refresh_jobs set request_count=request_count+1,last_requested_at=v_now,latest_trigger=p_trigger,
     trigger=case when accounting_refresh_private.priority(p_trigger)>priority then p_trigger else trigger end,
     next_eligible_at=case when phase='queued' then greatest(least(next_eligible_at,v_due),c.cooldown_until,c.provider_not_before,provider_not_before) else next_eligible_at end
     where id=j.id returning * into j;
 else
   insert into public.accounting_refresh_jobs(connection_id,user_id,provider,provider_organisation_id,connection_epoch,trigger,latest_trigger,next_eligible_at)
     values(c.id,c.user_id,c.provider,c.provider_organisation_id,c.connection_epoch,p_trigger,p_trigger,v_due) returning * into j;
 end if;
 if v_hash is not null then insert into public.accounting_refresh_request_keys(connection_id,user_id,provider,provider_organisation_id,key_hash,job_id)
   values(c.id,c.user_id,c.provider,c.provider_organisation_id,v_hash,j.id);end if;
 return jsonb_build_object('resultCode',case when v_joined then 'coalesced' else 'accepted' end,'job',accounting_refresh_private.job_json(j));
end $$;

create function public.read_accounting_refresh_control(p_user_id uuid,p_provider text,p_provider_organisation_id text)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
declare c public.accounting_refresh_connections; j public.accounting_refresh_jobs;
begin
 select * into c from public.accounting_refresh_connections where user_id=p_user_id and provider=p_provider and provider_organisation_id=p_provider_organisation_id;
 if not found then raise exception 'accounting_refresh_invalid_scope' using errcode='42501';end if;
 select * into j from public.accounting_refresh_jobs where connection_id=c.id order by requested_at desc,id desc limit 1;
 return jsonb_build_object('connection',jsonb_build_object('connectionId',c.id,'ownerId',c.user_id,'provider',c.provider,
   'providerOrganisationId',c.provider_organisation_id,'epoch',c.connection_epoch::text),
   'invalidated',c.invalidated_at is not null,'lastProductActivityAt',c.last_product_activity_at,'nextScheduledDueAt',c.next_scheduled_due_at,
   'job',case when j.id is null then null else accounting_refresh_private.job_json(j) end);
end $$;

create function public.list_accounting_refresh_work(p_limit integer default 25)
returns setof jsonb language sql stable security definer set search_path=pg_catalog as $$
 select accounting_refresh_private.job_json(j) from public.accounting_refresh_jobs j
 join public.accounting_refresh_connections c on c.id=j.connection_id
 where j.phase in('queued','retry_wait') and j.next_eligible_at<=statement_timestamp()
   and (j.delivery_expires_at is null or j.delivery_expires_at<=statement_timestamp())
   and j.connection_epoch=c.connection_epoch and accounting_refresh_private.available(c)
 order by (j.requested_at<statement_timestamp()-interval '30 minutes') desc,j.priority desc,j.next_eligible_at,j.requested_at,j.id
 limit greatest(0,least(coalesce(p_limit,25),200))
$$;

create function public.reserve_accounting_refresh_delivery(p_job_id uuid,p_user_id uuid,p_provider text,p_provider_organisation_id text,
 p_connection_epoch bigint,p_delivery_owner uuid,p_ttl_seconds integer default 60)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare j public.accounting_refresh_jobs; c public.accounting_refresh_connections; v_now timestamptz:=clock_timestamp();
begin
 select * into j from public.accounting_refresh_jobs where id=p_job_id;
 c:=accounting_refresh_private.lock_connection(j.connection_id,p_user_id,p_provider,p_provider_organisation_id,p_connection_epoch);
 select * into j from public.accounting_refresh_jobs where id=p_job_id for update;
 if p_delivery_owner is null or p_ttl_seconds is null or p_ttl_seconds not between 15 and 300 then raise exception 'accounting_refresh_invalid_reservation' using errcode='22023';end if;
 if j.connection_epoch<>c.connection_epoch or not accounting_refresh_private.available(c) then raise exception 'accounting_refresh_connection_unavailable' using errcode='55000';end if;
 if j.phase not in('queued','retry_wait') or j.next_eligible_at>v_now then return jsonb_build_object('reserved',false,'resultCode','not_eligible');end if;
 if j.delivery_expires_at>v_now then return jsonb_build_object('reserved',j.delivery_owner=p_delivery_owner,'resultCode',
   case when j.delivery_owner=p_delivery_owner then 'already_reserved' else 'delivery_held' end,'job',accounting_refresh_private.job_json(j));end if;
 update public.accounting_refresh_jobs set delivery_id=gen_random_uuid(),delivery_owner=p_delivery_owner,
   delivery_expires_at=v_now+make_interval(secs=>p_ttl_seconds),last_reserved_at=v_now where id=j.id returning * into j;
 return jsonb_build_object('reserved',true,'resultCode','reserved','job',accounting_refresh_private.job_json(j));
end $$;

create function public.claim_accounting_refresh_attempt(p_job_id uuid,p_user_id uuid,p_provider text,p_provider_organisation_id text,
 p_connection_epoch bigint,p_delivery_id uuid,p_worker_id uuid,p_ttl_seconds integer default 300)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare j public.accounting_refresh_jobs; c public.accounting_refresh_connections; v_now timestamptz:=clock_timestamp();
begin
 select * into j from public.accounting_refresh_jobs where id=p_job_id;
 c:=accounting_refresh_private.lock_connection(j.connection_id,p_user_id,p_provider,p_provider_organisation_id,p_connection_epoch);
 select * into j from public.accounting_refresh_jobs where id=p_job_id for update;
 if p_delivery_id is null or p_worker_id is null or p_ttl_seconds is null or p_ttl_seconds not between 60 and 900 then raise exception 'accounting_refresh_invalid_claim' using errcode='22023';end if;
 if j.connection_epoch<>c.connection_epoch or not accounting_refresh_private.available(c) then raise exception 'accounting_refresh_connection_unavailable' using errcode='55000';end if;
 if j.phase in('running','preparing') then
   return jsonb_build_object('claimed',j.worker_id=p_worker_id and j.delivery_id=p_delivery_id and j.attempt_expires_at>v_now,
     'resultCode',case when j.worker_id=p_worker_id and j.delivery_id=p_delivery_id and j.attempt_expires_at>v_now then 'already_claimed' else 'attempt_held' end,
     'job',accounting_refresh_private.job_json(j));
 end if;
 if j.phase not in('queued','retry_wait') or j.next_eligible_at>v_now or j.delivery_id is distinct from p_delivery_id or j.delivery_expires_at is null or j.delivery_expires_at<=v_now then
   return jsonb_build_object('claimed',false,'resultCode','reservation_invalid');end if;
 update public.accounting_refresh_jobs set phase=case when work_stage='derivatives' then 'preparing' else 'running' end,
   attempt_number=attempt_number+1,attempt_id=gen_random_uuid(),worker_id=p_worker_id,
   attempt_expires_at=v_now+make_interval(secs=>p_ttl_seconds),claimed_at=v_now,heartbeat_at=v_now,
  delivery_owner=null,delivery_expires_at=null where id=j.id returning * into j;
 update public.accounting_refresh_connections set cooldown_until=greatest(cooldown_until,v_now+interval '5 minutes'),updated_at=v_now where id=c.id;
 return jsonb_build_object('claimed',true,'resultCode','claimed','job',accounting_refresh_private.job_json(j));
end $$;

create function public.release_accounting_refresh_delivery(p_job_id uuid,p_user_id uuid,p_provider text,p_provider_organisation_id text,
 p_connection_epoch bigint,p_delivery_id uuid,p_delivery_owner uuid)
returns boolean language plpgsql security definer set search_path=pg_catalog as $$
declare j public.accounting_refresh_jobs; c public.accounting_refresh_connections;
begin
 select * into j from public.accounting_refresh_jobs where id=p_job_id;
 c:=accounting_refresh_private.lock_connection(j.connection_id,p_user_id,p_provider,p_provider_organisation_id,p_connection_epoch);
 if j.connection_epoch<>c.connection_epoch then raise exception 'accounting_refresh_stale_epoch' using errcode='40001';end if;
 update public.accounting_refresh_jobs set delivery_owner=null,delivery_expires_at=null
   where id=p_job_id and phase in('queued','retry_wait') and delivery_id=p_delivery_id and delivery_owner=p_delivery_owner;
 return found;
end $$;

create function accounting_refresh_private.lock_attempt(p_job uuid,p_user uuid,p_provider text,p_org text,p_epoch bigint,p_attempt uuid,p_worker uuid,p_number integer)
returns public.accounting_refresh_jobs language plpgsql set search_path=pg_catalog as $$
declare j public.accounting_refresh_jobs; c public.accounting_refresh_connections;
begin
 select * into j from public.accounting_refresh_jobs where id=p_job;
 c:=accounting_refresh_private.lock_connection(j.connection_id,p_user,p_provider,p_org,p_epoch);
 select * into j from public.accounting_refresh_jobs where id=p_job for update;
 if j.connection_epoch<>c.connection_epoch or not accounting_refresh_private.available(c) then raise exception 'accounting_refresh_stale_epoch' using errcode='40001';end if;
 if j.phase not in('running','preparing') or j.attempt_id is distinct from p_attempt or j.worker_id is distinct from p_worker
   or j.attempt_number is distinct from p_number or j.attempt_expires_at<=clock_timestamp() then
   raise exception 'accounting_refresh_stale_attempt' using errcode='40001';end if;
 return j;
end $$;
create function public.heartbeat_accounting_refresh_attempt(p_job_id uuid,p_user_id uuid,p_provider text,p_provider_organisation_id text,
 p_connection_epoch bigint,p_attempt_id uuid,p_worker_id uuid,p_attempt_number integer,p_ttl_seconds integer default 300)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare j public.accounting_refresh_jobs;
begin
 j:=accounting_refresh_private.lock_attempt(p_job_id,p_user_id,p_provider,p_provider_organisation_id,p_connection_epoch,p_attempt_id,p_worker_id,p_attempt_number);
 if p_ttl_seconds is null or p_ttl_seconds not between 60 and 900 then raise exception 'accounting_refresh_invalid_heartbeat' using errcode='22023';end if;
 update public.accounting_refresh_jobs set heartbeat_at=clock_timestamp(),attempt_expires_at=clock_timestamp()+make_interval(secs=>p_ttl_seconds)
   where id=j.id returning * into j;
 return accounting_refresh_private.job_json(j);
end $$;

create function public.update_accounting_refresh_attempt(p_job_id uuid,p_user_id uuid,p_provider text,p_provider_organisation_id text,
 p_connection_epoch bigint,p_attempt_id uuid,p_worker_id uuid,p_attempt_number integer,p_operation text,
 p_failure_class text default null,p_failure_code text default null,p_retry_at timestamptz default null,
 p_provider_not_before timestamptz default null,p_retry_source text default 'none',p_generation_run_id uuid default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare j public.accounting_refresh_jobs; c public.accounting_refresh_connections; v_now timestamptz:=clock_timestamp(); v_phase text; v_promoted boolean:=false;
begin
 j:=accounting_refresh_private.lock_attempt(p_job_id,p_user_id,p_provider,p_provider_organisation_id,p_connection_epoch,p_attempt_id,p_worker_id,p_attempt_number);
 select * into c from public.accounting_refresh_connections where id=j.connection_id;
 if p_operation is null or p_operation not in('bind_generation','preparing','complete','fail','requeue')
   or (p_retry_at is not null and not isfinite(p_retry_at)) or (p_provider_not_before is not null and not isfinite(p_provider_not_before)) then
   raise exception 'accounting_refresh_invalid_update' using errcode='22023';end if;
 if p_generation_run_id is not null then
   if p_provider='xero' and not exists(select 1 from public.xero_sync_runs r where r.id=p_generation_run_id and r.user_id=p_user_id and r.tenant_id=p_provider_organisation_id) then
     raise exception 'accounting_refresh_generation_scope' using errcode='42501';end if;
   if j.generation_run_id is not null and j.generation_run_id<>p_generation_run_id and not(
     j.work_stage='accounting' and p_provider='xero' and exists(select 1 from public.xero_sync_runs r
       where r.id=j.generation_run_id and r.user_id=j.user_id and r.tenant_id=j.provider_organisation_id and r.status in('failed','abandoned')))
     then raise exception 'accounting_refresh_generation_conflict' using errcode='40001';end if;
   j.generation_run_id:=p_generation_run_id;
 end if;
 if p_provider='xero' and j.generation_run_id is not null then
   select exists(select 1 from public.xero_sync_runs r where r.id=j.generation_run_id and r.user_id=j.user_id and r.tenant_id=j.provider_organisation_id and r.status='succeeded') into v_promoted;
 end if;
 if v_promoted then j.work_stage:='derivatives';end if;
 if p_operation='bind_generation' then
   if j.generation_run_id is null then raise exception 'accounting_refresh_generation_required' using errcode='22023';end if;
   update public.accounting_refresh_jobs set generation_run_id=j.generation_run_id,work_stage=j.work_stage where id=j.id returning * into j;
 elsif p_operation='preparing' then
   if j.generation_run_id is null or (p_provider='xero' and not v_promoted) then raise exception 'accounting_refresh_generation_not_promoted' using errcode='55000';end if;
   update public.accounting_refresh_jobs set phase='preparing',work_stage='derivatives',generation_run_id=j.generation_run_id where id=j.id returning * into j;
 elsif p_operation='complete' then
   update public.accounting_refresh_jobs set phase='complete',work_stage=j.work_stage,generation_run_id=j.generation_run_id,completed_at=v_now,
     worker_id=null,attempt_expires_at=null,failure_class=null,failure_code=null,retry_source='none' where id=j.id returning * into j;
   update public.accounting_refresh_connections set cooldown_until=greatest(cooldown_until,v_now+interval '5 minutes'),updated_at=v_now where id=c.id;
 elsif p_operation='requeue' then
   update public.accounting_refresh_jobs set phase='queued',work_stage=j.work_stage,generation_run_id=j.generation_run_id,worker_id=null,attempt_expires_at=null,
     next_eligible_at=greatest(v_now,p_retry_at,c.cooldown_until,c.provider_not_before,j.provider_not_before) where id=j.id returning * into j;
 else
   if p_failure_class is null or p_failure_class not in('transient','rate_limited','quota_limited','reconnect_required','deterministic_failure','preparation_failure','unknown')
     or p_failure_code is null or p_failure_code !~ '^[a-z][a-z0-9_]{0,63}$' or p_retry_source is null or p_retry_source not in('local','provider','probe','none') then
     raise exception 'accounting_refresh_invalid_failure' using errcode='22023';end if;
   if p_failure_class='preparation_failure' and j.work_stage<>'derivatives' then raise exception 'accounting_refresh_invalid_preparation' using errcode='22023';end if;
   v_phase:=case when p_failure_class='reconnect_required' then 'reconnect_required'
     when p_failure_class in('deterministic_failure','unknown') or p_retry_at is null then 'attention_required' else 'retry_wait' end;
   if v_phase<>'retry_wait' and (p_retry_at is not null or p_retry_source<>'none') then raise exception 'accounting_refresh_permanent_retry' using errcode='22023';end if;
   if v_phase='retry_wait' and p_retry_source='none' then raise exception 'accounting_refresh_retry_source_required' using errcode='22023';end if;
   update public.accounting_refresh_connections set provider_not_before=greatest(provider_not_before,p_provider_not_before),
     cooldown_until=greatest(cooldown_until,p_retry_at,p_provider_not_before),updated_at=v_now where id=c.id returning * into c;
   update public.accounting_refresh_jobs set phase=v_phase,work_stage=j.work_stage,generation_run_id=j.generation_run_id,worker_id=null,attempt_expires_at=null,
     retry_count=retry_count+1,failure_class=p_failure_class,failure_code=p_failure_code,failed_at=v_now,retry_source=p_retry_source,
     provider_not_before=greatest(provider_not_before,p_provider_not_before),
     next_eligible_at=greatest(v_now,p_retry_at,c.cooldown_until,c.provider_not_before) where id=j.id returning * into j;
 end if;
 return accounting_refresh_private.job_json(j);
end $$;

create function public.advance_accounting_refresh_epoch(p_connection_id uuid,p_user_id uuid,p_provider text,p_provider_organisation_id text,p_expected_epoch bigint,p_reason text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare c public.accounting_refresh_connections; v_now timestamptz:=clock_timestamp(); v_authority text;
begin
 c:=accounting_refresh_private.lock_connection(p_connection_id,p_user_id,p_provider,p_provider_organisation_id,p_expected_epoch);
 if p_reason is null or p_reason not in('disconnect','reconnect','credential_relink','organisation_changed') then raise exception 'accounting_refresh_invalid_epoch_reason' using errcode='22023';end if;
 v_authority:=c.authority_key;
 if p_reason in('reconnect','credential_relink') and p_provider='xero' then
   select x.grant_id::text into v_authority from public.xero_connections_public x
   join public.xero_oauth_grants g on g.id=x.grant_id and g.user_id=x.user_id
   where x.user_id=p_user_id and x.tenant_id=p_provider_organisation_id and x.auth_state='active';
   if not found then raise exception 'accounting_refresh_connection_unavailable' using errcode='55000';end if;
 end if;
 update public.accounting_refresh_connections set connection_epoch=connection_epoch+1,last_epoch_reason=p_reason,
   authority_key=v_authority,invalidated_at=case when p_reason in('disconnect','organisation_changed') then v_now else null end,
   updated_at=v_now where id=c.id returning * into c;
 update public.accounting_refresh_jobs set phase='cancelled',completed_at=v_now,worker_id=null,attempt_expires_at=null,
   delivery_owner=null,delivery_expires_at=null where connection_id=c.id and phase not in('complete','cancelled');
 return jsonb_build_object('connectionId',c.id,'ownerId',c.user_id,'provider',c.provider,
   'providerOrganisationId',c.provider_organisation_id,'epoch',c.connection_epoch::text,'invalidated',c.invalidated_at is not null);
end $$;

create function public.cancel_accounting_refresh(p_job_id uuid,p_user_id uuid,p_provider text,p_provider_organisation_id text,p_connection_epoch bigint)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare j public.accounting_refresh_jobs; c public.accounting_refresh_connections;
begin
 select * into j from public.accounting_refresh_jobs where id=p_job_id;
 c:=accounting_refresh_private.lock_connection(j.connection_id,p_user_id,p_provider,p_provider_organisation_id,p_connection_epoch);
 select * into j from public.accounting_refresh_jobs where id=p_job_id for update;
 if j.connection_epoch<>c.connection_epoch then raise exception 'accounting_refresh_stale_epoch' using errcode='40001';end if;
 if j.phase not in('complete','cancelled') then
   update public.accounting_refresh_jobs set phase='cancelled',completed_at=clock_timestamp(),worker_id=null,attempt_expires_at=null,
     delivery_owner=null,delivery_expires_at=null where id=j.id returning * into j;
 end if;
 return accounting_refresh_private.job_json(j);
end $$;

create function public.recover_accounting_refresh_work(p_limit integer default 25)
returns integer language plpgsql security definer set search_path=pg_catalog as $$
declare candidate record; c public.accounting_refresh_connections; j public.accounting_refresh_jobs; recovered integer:=0; v_now timestamptz:=clock_timestamp(); v_promoted boolean;
begin
 for candidate in select id,connection_id from public.accounting_refresh_jobs
   where (phase in('running','preparing') and attempt_expires_at<=v_now) or delivery_expires_at<=v_now
   order by coalesce(attempt_expires_at,delivery_expires_at),id limit greatest(0,least(coalesce(p_limit,25),200))
 loop
   select * into c from public.accounting_refresh_connections where id=candidate.connection_id for update skip locked;
   if not found then continue;end if;
   select * into j from public.accounting_refresh_jobs where id=candidate.id for update skip locked;
   if not found or j.phase in('complete','cancelled') then continue;end if;
   if j.connection_epoch<>c.connection_epoch or c.invalidated_at is not null then
     update public.accounting_refresh_jobs set phase='cancelled',completed_at=v_now,worker_id=null,attempt_expires_at=null,delivery_owner=null,delivery_expires_at=null where id=j.id;
     recovered:=recovered+1;
   elsif j.phase in('running','preparing') and j.attempt_expires_at<=v_now then
     v_promoted:=false;
     if j.provider='xero' and j.generation_run_id is not null then
       select exists(select 1 from public.xero_sync_runs r where r.id=j.generation_run_id and r.user_id=j.user_id and r.tenant_id=j.provider_organisation_id and r.status='succeeded') into v_promoted;
     end if;
     update public.accounting_refresh_jobs set phase='retry_wait',work_stage=case when v_promoted then 'derivatives' else work_stage end,
       worker_id=null,attempt_expires_at=null,delivery_owner=null,delivery_expires_at=null,
       failure_class=case when work_stage='derivatives' or v_promoted then 'preparation_failure' else 'transient' end,
       failure_code='attempt_lease_expired',failed_at=v_now,retry_count=retry_count+1,retry_source='local',
       next_eligible_at=greatest(v_now+interval '5 minutes',c.cooldown_until,c.provider_not_before,j.provider_not_before) where id=j.id;
     update public.accounting_refresh_connections set cooldown_until=greatest(cooldown_until,v_now+interval '5 minutes'),updated_at=v_now where id=c.id;
     recovered:=recovered+1;
   elsif j.delivery_expires_at<=v_now then
     update public.accounting_refresh_jobs set delivery_owner=null,delivery_expires_at=null where id=j.id;
     recovered:=recovered+1;
   end if;
 end loop;
 return recovered;
end $$;

create function public.set_accounting_refresh_schedule(p_connection_id uuid,p_user_id uuid,p_provider text,p_provider_organisation_id text,
 p_connection_epoch bigint,p_activity_kind text default null,p_next_due_at timestamptz default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare c public.accounting_refresh_connections;
begin
 c:=accounting_refresh_private.lock_connection(p_connection_id,p_user_id,p_provider,p_provider_organisation_id,p_connection_epoch);
 if (p_activity_kind is not null and p_activity_kind not in('dashboard','queue','customer','collection_action'))
   or (p_next_due_at is not null and not isfinite(p_next_due_at)) then raise exception 'accounting_refresh_invalid_activity' using errcode='22023';end if;
 update public.accounting_refresh_connections set last_product_activity_at=case when p_activity_kind is not null then clock_timestamp() else last_product_activity_at end,
   next_scheduled_due_at=p_next_due_at,updated_at=clock_timestamp() where id=c.id returning * into c;
 return jsonb_build_object('lastProductActivityAt',c.last_product_activity_at,'nextScheduledDueAt',c.next_scheduled_due_at);
end $$;

-- SELECT for controlled server readers only. Mutation authority is the RPCs.
alter table public.accounting_refresh_connections enable row level security;
alter table public.accounting_refresh_jobs enable row level security;
alter table public.accounting_refresh_request_keys enable row level security;
revoke all on public.accounting_refresh_connections,public.accounting_refresh_jobs,public.accounting_refresh_request_keys from public,anon,authenticated,service_role;
grant select on public.accounting_refresh_connections,public.accounting_refresh_jobs,public.accounting_refresh_request_keys to service_role;
revoke all on all functions in schema accounting_refresh_private from public,anon,authenticated,service_role;
-- Explicitly enumerate just this migration's public functions; no global grants.
revoke all on function public.register_accounting_refresh_connection(uuid,text,text,text,text),
 public.accept_accounting_refresh(uuid,uuid,text,text,bigint,text,text,timestamptz),
 public.read_accounting_refresh_control(uuid,text,text),public.list_accounting_refresh_work(integer),
 public.reserve_accounting_refresh_delivery(uuid,uuid,text,text,bigint,uuid,integer),
 public.claim_accounting_refresh_attempt(uuid,uuid,text,text,bigint,uuid,uuid,integer),
 public.release_accounting_refresh_delivery(uuid,uuid,text,text,bigint,uuid,uuid),
 public.heartbeat_accounting_refresh_attempt(uuid,uuid,text,text,bigint,uuid,uuid,integer,integer),
 public.update_accounting_refresh_attempt(uuid,uuid,text,text,bigint,uuid,uuid,integer,text,text,text,timestamptz,timestamptz,text,uuid),
 public.advance_accounting_refresh_epoch(uuid,uuid,text,text,bigint,text),
 public.cancel_accounting_refresh(uuid,uuid,text,text,bigint),public.recover_accounting_refresh_work(integer),
 public.set_accounting_refresh_schedule(uuid,uuid,text,text,bigint,text,timestamptz) from public,anon,authenticated;
grant execute on function public.register_accounting_refresh_connection(uuid,text,text,text,text),
 public.accept_accounting_refresh(uuid,uuid,text,text,bigint,text,text,timestamptz),
 public.read_accounting_refresh_control(uuid,text,text),public.list_accounting_refresh_work(integer),
 public.reserve_accounting_refresh_delivery(uuid,uuid,text,text,bigint,uuid,integer),
 public.claim_accounting_refresh_attempt(uuid,uuid,text,text,bigint,uuid,uuid,integer),
 public.release_accounting_refresh_delivery(uuid,uuid,text,text,bigint,uuid,uuid),
 public.heartbeat_accounting_refresh_attempt(uuid,uuid,text,text,bigint,uuid,uuid,integer,integer),
 public.update_accounting_refresh_attempt(uuid,uuid,text,text,bigint,uuid,uuid,integer,text,text,text,timestamptz,timestamptz,text,uuid),
 public.advance_accounting_refresh_epoch(uuid,uuid,text,text,bigint,text),
 public.cancel_accounting_refresh(uuid,uuid,text,text,bigint),public.recover_accounting_refresh_work(integer),
 public.set_accounting_refresh_schedule(uuid,uuid,text,text,bigint,text,timestamptz) to service_role;
