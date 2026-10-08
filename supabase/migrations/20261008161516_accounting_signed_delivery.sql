-- The hosted pg_net schema is owned by supabase_admin. Postgres cannot revoke
-- all managed grants. Never place the static worker credential in its queue.
-- A MAC is scoped to one project/job/reservation; replay cannot create work.
create or replace function accounting_refresh_private.submit_delivery(p_settings jsonb,p_project text,p_job uuid,p_delivery uuid) returns bigint
language plpgsql set search_path=pg_catalog as $$
declare headers jsonb; request_id bigint; signature text;
begin
 signature:=encode(extensions.hmac(p_project||':'||p_job::text||':'||p_delivery::text,p_settings->>'secret','sha256'),'hex');
 headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||signature,'x-accounting-project-ref',p_project);
 -- Preview protection is a separate layer. Current Test has no bypass token.
 if nullif(p_settings->>'bypass','') is not null then headers:=headers||jsonb_build_object('x-vercel-protection-bypass',p_settings->>'bypass');end if;
 select net.http_post(url:=p_settings->>'url',headers:=headers,
   body:=jsonb_build_object('jobId',p_job,'deliveryId',p_delivery),timeout_milliseconds:=310000) into request_id;
 return request_id;
end $$;
revoke all on function accounting_refresh_private.submit_delivery(jsonb,text,uuid,uuid) from public,anon,authenticated,service_role;
