-- Executed by the Test-only guard script. All fixture/control writes roll back.
-- No provider connection/grant, accounting generation, billing claim or scheduler.
begin;
do $$
declare
  owner_a uuid:=gen_random_uuid(); owner_b uuid:=gen_random_uuid(); worker uuid:=gen_random_uuid(); dispatcher uuid:=gen_random_uuid();
  c jsonb; other_c jsonb; other_provider jsonb; j jsonb; reserved jsonb; held jsonb; result jsonb; next_c jsonb;
  before_business jsonb:='{}'; after_business jsonb:='{}'; table_name text; n bigint; fingerprint text;
  business_tables text[]:=array['xero_oauth_grants','xero_connections_public','xero_raw','xero_sync_tenant_state','xero_sync_runs',
    'xero_sync_run_steps','xero_sync_run_validations','canonical_organisations','canonical_customers','canonical_invoices','canonical_payments',
    'canonical_payment_evidence','canonical_unapplied_cash_evidence','canonical_credit_note_evidence','xero_accounting_evidence_observations',
    'xero_customer_credit_validations','invoice_promises','invoice_promise_events','invoice_disputes','customer_overrides','collection_actions',
    'billing_usage_days','subscriptions','collection_dependency_heads','collection_customer_financial_revisions','collection_customer_bases',
    'collection_basis_manifests','collection_customer_features','collection_portfolio_calculations','collection_portfolio_base_scores','xero_scheduled_sync_runs'];
  role_name text; control_table text; rpc_count integer;
begin
  foreach table_name in array business_tables loop
    execute format('select count(*), md5(coalesce(string_agg(row_to_json(t)::text, '''' order by row_to_json(t)::text),'''')) from public.%I t',table_name) into n,fingerprint;
    before_business:=before_business||jsonb_build_object(table_name,jsonb_build_array(n,fingerprint));
  end loop;
  select count(*) into rpc_count from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace
    where ns.nspname='public' and p.proname in('register_accounting_refresh_connection','accept_accounting_refresh','read_accounting_refresh_control',
    'list_accounting_refresh_work','reserve_accounting_refresh_delivery','release_accounting_refresh_delivery','claim_accounting_refresh_attempt',
    'heartbeat_accounting_refresh_attempt','update_accounting_refresh_attempt','advance_accounting_refresh_epoch','cancel_accounting_refresh',
    'recover_accounting_refresh_work','set_accounting_refresh_schedule')
    and p.prosecdef and p.proconfig=array['search_path=pg_catalog'] and has_function_privilege('service_role',p.oid,'execute')
    and not has_function_privilege('anon',p.oid,'execute') and not has_function_privilege('authenticated',p.oid,'execute');
  if rpc_count<>13 then raise exception 'certification_rpc_security';end if;
  foreach control_table in array array['accounting_refresh_connections','accounting_refresh_jobs','accounting_refresh_request_keys'] loop
    foreach role_name in array array['anon','authenticated'] loop
      if has_table_privilege(role_name,'public.'||control_table,'SELECT,INSERT,UPDATE,DELETE') then raise exception 'certification_table_security';end if;
    end loop;
    if has_table_privilege('service_role','public.'||control_table,'INSERT,UPDATE,DELETE') then raise exception 'certification_direct_write';end if;
    if not exists(select 1 from pg_class where oid=('public.'||control_table)::regclass and relrowsecurity) then raise exception 'certification_rls';end if;
  end loop;
  execute 'set local role anon';
  begin
    perform public.list_accounting_refresh_work(1);raise exception 'certification_anon_execute';
  exception when insufficient_privilege then null;end;
  execute 'reset role';
  execute 'set local role authenticated';
  begin
    perform public.list_accounting_refresh_work(1);raise exception 'certification_browser_execute';
  exception when insufficient_privilege then null;end;
  execute 'reset role';

  insert into auth.users(id,aud,role,email,created_at,updated_at) values
    (owner_a,'authenticated','authenticated',owner_a::text||'@foundation.invalid',now(),now()),
    (owner_b,'authenticated','authenticated',owner_b::text||'@foundation.invalid',now(),now());
  execute 'set local role service_role';
  c:=public.register_accounting_refresh_connection(owner_a,'foundation_certification','same-org','same-org','verified-test-only');
  other_c:=public.register_accounting_refresh_connection(owner_b,'foundation_certification','same-org','same-org','verified-test-only');
  other_provider:=public.register_accounting_refresh_connection(owner_a,'another_certification','same-org','same-org','verified-test-only');
  j:=public.accept_accounting_refresh((c->>'connectionId')::uuid,owner_a,'foundation_certification','same-org',1,'scheduled','stable-key')->'job';
  result:=public.accept_accounting_refresh((c->>'connectionId')::uuid,owner_a,'foundation_certification','same-org',1,'manual','stable-key');
  if result->>'resultCode'<>'replayed' or result->'job'->>'id'<>j->>'id' then raise exception 'certification_idempotency';end if;
  result:=public.accept_accounting_refresh((c->>'connectionId')::uuid,owner_a,'foundation_certification','same-org',1,'onboarding',null);
  if result->'job'->>'id'<>j->>'id' or result->'job'->>'priority'<>'60' then raise exception 'certification_coalescing_priority';end if;
  result:=public.accept_accounting_refresh((other_c->>'connectionId')::uuid,owner_b,'foundation_certification','same-org',1,'manual','stable-key');
  if result->'job'->>'id'=j->>'id' then raise exception 'certification_owner_isolation';end if;
  result:=public.accept_accounting_refresh((other_provider->>'connectionId')::uuid,owner_a,'another_certification','same-org',1,'manual','stable-key');
  if result->'job'->>'id'=j->>'id' then raise exception 'certification_provider_isolation';end if;
  begin
    perform public.accept_accounting_refresh((c->>'connectionId')::uuid,owner_b,'foundation_certification','same-org',1,'manual');
    raise exception 'certification_foreign_scope';
  exception when insufficient_privilege then null;end;
  begin
    perform public.accept_accounting_refresh((c->>'connectionId')::uuid,owner_a,'another_certification','same-org',1,'manual');
    raise exception 'certification_provider_scope';
  exception when insufficient_privilege then null;end;
  begin
    perform public.register_accounting_refresh_connection(owner_a,'xero','missing-org','missing-org','unlinked');
    raise exception 'certification_xero_ownership';
  exception when insufficient_privilege then null;end;

  reserved:=public.reserve_accounting_refresh_delivery((j->>'id')::uuid,owner_a,'foundation_certification','same-org',1,dispatcher,60);
  if not (reserved->>'reserved')::boolean then raise exception 'certification_reservation';end if;
  result:=public.reserve_accounting_refresh_delivery((j->>'id')::uuid,owner_a,'foundation_certification','same-org',1,gen_random_uuid(),60);
  if (result->>'reserved')::boolean then raise exception 'certification_duplicate_delivery';end if;
  held:=public.claim_accounting_refresh_attempt((j->>'id')::uuid,owner_a,'foundation_certification','same-org',1,
    (reserved->'job'->>'deliveryId')::uuid,worker,300)->'job';
  if held->>'phase'<>'running' or held->>'attemptNumber'<>'1' then raise exception 'certification_claim';end if;
  result:=public.claim_accounting_refresh_attempt((j->>'id')::uuid,owner_a,'foundation_certification','same-org',1,
    (reserved->'job'->>'deliveryId')::uuid,gen_random_uuid(),300);
  if (result->>'claimed')::boolean then raise exception 'certification_duplicate_claim';end if;
  perform public.heartbeat_accounting_refresh_attempt((j->>'id')::uuid,owner_a,'foundation_certification','same-org',1,
    (held->>'attemptId')::uuid,worker,1,300);
  result:=public.update_accounting_refresh_attempt((j->>'id')::uuid,owner_a,'foundation_certification','same-org',1,
    (held->>'attemptId')::uuid,worker,1,'fail','rate_limited','provider_rate_limited',clock_timestamp()+interval '5 minutes',
    clock_timestamp()+interval '1 hour','provider',null);
  if result->>'phase'<>'retry_wait' or result->>'retryCount'<>'1' or (result->>'nextEligibleAt')::timestamptz<now()+interval '59 minutes' then raise exception 'certification_retry';end if;
  result:=public.accept_accounting_refresh((c->>'connectionId')::uuid,owner_a,'foundation_certification','same-org',1,'manual');
  if result->'job'->>'phase'<>'retry_wait' or result->'job'->>'id'<>j->>'id' then raise exception 'certification_cooldown_bypass';end if;
  next_c:=public.advance_accounting_refresh_epoch((c->>'connectionId')::uuid,owner_a,'foundation_certification','same-org',1,'disconnect');
  if next_c->>'epoch'<>'2' or not (next_c->>'invalidated')::boolean then raise exception 'certification_epoch';end if;
  begin
    perform public.heartbeat_accounting_refresh_attempt((j->>'id')::uuid,owner_a,'foundation_certification','same-org',1,(held->>'attemptId')::uuid,worker,1,300);
    raise exception 'certification_stale_epoch';
  exception when serialization_failure then null;end;
  next_c:=public.advance_accounting_refresh_epoch((c->>'connectionId')::uuid,owner_a,'foundation_certification','same-org',2,'reconnect');
  result:=public.accept_accounting_refresh((c->>'connectionId')::uuid,owner_a,'foundation_certification','same-org',3,'reconnect','fresh-key');
  if result->'job'->>'id'=j->>'id' or result->'job'->'connection'->>'epoch'<>'3' then raise exception 'certification_reconnect';end if;
  execute 'reset role';
  if exists(select 1 from public.accounting_refresh_jobs where phase not in('complete','cancelled') group by user_id,provider,provider_organisation_id having count(*)>1) then raise exception 'certification_singleflight';end if;
  foreach table_name in array business_tables loop
    execute format('select count(*), md5(coalesce(string_agg(row_to_json(t)::text, '''' order by row_to_json(t)::text),'''')) from public.%I t',table_name) into n,fingerprint;
    after_business:=after_business||jsonb_build_object(table_name,jsonb_build_array(n,fingerprint));
  end loop;
  if after_business is distinct from before_business then raise exception 'certification_business_integrity';end if;
  if exists(select 1 from pg_extension where extname in('pg_cron','pg_net','pgmq')) then raise exception 'certification_scheduler_enabled';end if;
end $$;
rollback;
select 'phase_7_1_hosted_control_certified_rollback_only';
