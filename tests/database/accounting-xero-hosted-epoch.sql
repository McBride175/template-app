-- Rollback-only Test certificate. Candidate copies current canonical truth;
-- no provider retrieval, credential change, worker HTTP or persistent fixture.
do $$
declare u uuid:=current_setting('yuohme.cert_owner')::uuid; tenant text:=current_setting('yuohme.cert_tenant');
 c jsonb; j jsonb; reserved jsonb; claimed jsonb; old_g uuid; run record; step record; table_name text; cols text;
 owner uuid:=gen_random_uuid(); worker uuid:=gen_random_uuid(); validated record; refused boolean:=false;
begin
 select active_sync_run_id into old_g from public.xero_sync_tenant_state where user_id=u and tenant_id=tenant;
 if old_g is null then raise exception 'certificate_requires_authoritative_generation';end if;
 select public.register_accounting_refresh_connection(u,'xero',tenant,tenant,grant_id::text) into c from public.xero_connections_public where user_id=u and tenant_id=tenant and auth_state='active';
 if c is null then raise exception 'certificate_requires_owned_connection';end if;
 j:=public.accept_accounting_refresh((c->>'connectionId')::uuid,u,'xero',tenant,(c->>'epoch')::bigint,'internal',gen_random_uuid()::text)->'job';
 reserved:=public.reserve_accounting_refresh_delivery((j->>'id')::uuid,u,'xero',tenant,(c->>'epoch')::bigint,gen_random_uuid(),60)->'job';
 claimed:=public.claim_accounting_refresh_attempt((j->>'id')::uuid,u,'xero',tenant,(c->>'epoch')::bigint,(reserved->>'deliveryId')::uuid,worker,300)->'job';
 select * into run from public.acquire_accounting_xero_run((j->>'id')::uuid,(claimed->>'attemptId')::uuid,worker,1,(c->>'epoch')::bigint,owner);
 if not run.acquired then raise exception 'certificate_generation_not_acquired';end if;
 foreach table_name in array array['xero_raw','canonical_organisations','canonical_customers','canonical_invoices','canonical_payments',
   'canonical_payment_evidence','canonical_unapplied_cash_evidence','canonical_credit_note_evidence','xero_accounting_evidence_observations','xero_customer_credit_validations'] loop
   select string_agg(quote_ident(attname),',' order by attnum) into cols from pg_attribute
     where attrelid=('public.'||table_name)::regclass and attnum>0 and not attisdropped and attgenerated='' and attidentity='';
   execute format('insert into public.%I(%s) select %s from public.%I t cross join lateral jsonb_populate_record(null::public.%I,to_jsonb(t)||jsonb_build_object(''id'',gen_random_uuid(),''sync_run_id'',$1,''validation_fencing_token'',$2)) copied where t.sync_run_id=$3',
     table_name,cols,(select string_agg('copied.'||quote_ident(attname),',' order by attnum) from pg_attribute where attrelid=('public.'||table_name)::regclass and attnum>0 and not attisdropped and attgenerated='' and attidentity=''),table_name,table_name)
     using run.sync_run_id,run.fencing_token,old_g;
 end loop;
 for step in select * from public.xero_sync_run_steps where sync_run_id=old_g loop
   perform public.complete_xero_sync_run_step(run.sync_run_id,owner,run.fencing_token,step.step_key,step.record_count);
 end loop;
 select * into validated from public.record_xero_sync_run_readiness(run.sync_run_id,u,tenant,owner,run.fencing_token,'collections_readiness_v2');
 if not validated.validated then raise exception 'certificate_candidate_not_valid';end if;
 perform public.advance_accounting_refresh_epoch((c->>'connectionId')::uuid,u,'xero',tenant,(c->>'epoch')::bigint,'credential_relink');
 begin
   perform public.promote_xero_sync_run_with_promises(run.sync_run_id,owner,run.fencing_token,clock_timestamp(),null);
 exception when serialization_failure then refused:=true;end;
 if not refused or (select active_sync_run_id from public.xero_sync_tenant_state where user_id=u and tenant_id=tenant) is distinct from old_g then
   raise exception 'certificate_epoch_publication_fence_failed';end if;
 raise notice 'Valid candidate publication refused at stale epoch; previous active generation retained; rollback follows';
end $$;
select jsonb_build_object('epochPublicationRefused',true,'validCandidate',true,'previousGenerationRetained',true,'rollback',true);
