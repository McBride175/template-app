-- Dashboard context only. Collection scores and queue semantics remain in the
-- existing TypeScript projection. The browser cannot choose paid access.
create function public.read_dashboard_bootstrap_context(
  p_user_id uuid, p_tenant_id text, p_usage_date date,
  p_paid_price_ids text[], p_now timestamptz
) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog as $$
declare connection public.xero_connections_public; subscription public.subscriptions;
  state public.xero_sync_tenant_state; active_run public.xero_sync_runs;
  latest public.xero_sync_runs; scopes text[]; freshness timestamptz;
  snapshot jsonb; invalid_snapshot boolean := false; status_unavailable boolean := false;
  financial_epoch bigint; projection_revision bigint; paid boolean; subscription_json jsonb;
begin
  if p_user_id is null or p_usage_date is null or not isfinite(p_usage_date)
    or p_now is null or not isfinite(p_now)
    or p_paid_price_ids is null
  then raise exception 'dashboard_invalid_scope' using errcode = '22023'; end if;
  select s.* into subscription from public.subscriptions s where s.user_id = p_user_id
    order by s.updated_at desc limit 1;
  subscription_json := case when subscription.user_id is null then null else
    jsonb_build_object('status', subscription.status, 'current_period_end', subscription.current_period_end,
      'stripe_price_id', subscription.stripe_price_id) end;
  paid := coalesce(subscription.status in ('active','trialing')
    and subscription.current_period_end > p_now
    and btrim(subscription.stripe_price_id) = any(p_paid_price_ids), false);
  select c.* into connection from public.xero_connections_public c where c.user_id = p_user_id
    order by case when c.tenant_id = p_tenant_id then -1 else
      case c.auth_state when 'active' then 0 when 'reauth_required' then 1 else 2 end end,
      c.updated_at desc limit 1;
  if connection.tenant_id is not null then
    if connection.grant_id is not null then
      select g.scopes into scopes from public.xero_oauth_grants g
        where g.id = connection.grant_id and g.user_id = p_user_id;
    end if;
    select s.* into state from public.xero_sync_tenant_state s
      where s.user_id = p_user_id and s.tenant_id = connection.tenant_id;
    if state.active_sync_run_id is not null then
      select r.* into active_run from public.xero_sync_runs r
        where r.id = state.active_sync_run_id and r.user_id = p_user_id
          and r.tenant_id = connection.tenant_id and r.status = 'succeeded';
      invalid_snapshot := active_run.id is null or state.last_successful_sync_at is null;
      if not invalid_snapshot then
        snapshot := jsonb_build_object('mode','generation','syncRunId',active_run.id);
        freshness := state.last_successful_sync_at;
      end if;
    else
      snapshot := jsonb_build_object('mode','legacy','syncRunId',null);
      select max(r.fetched_at) into freshness from public.xero_raw r
        where r.user_id = p_user_id and r.tenant_id = connection.tenant_id and r.sync_run_id is null;
    end if;
    if state.latest_sync_run_id is not null then
      select r.* into latest from public.xero_sync_runs r
        where r.id = state.latest_sync_run_id and r.user_id = p_user_id
          and r.tenant_id = connection.tenant_id;
      status_unavailable := latest.id is null or
        (latest.status = 'succeeded' and latest.id is distinct from state.active_sync_run_id);
    end if;
    select h.financial_epoch, h.projection_revision into financial_epoch, projection_revision
      from public.collection_dependency_heads h where h.user_id = p_user_id
        and h.tenant_id = connection.tenant_id and h.source_system = 'xero';
  end if;
  return jsonb_build_object('subscription',subscription_json,'paid',paid,
    'connection',case when connection.tenant_id is null then null else jsonb_build_object(
      'tenant_id',connection.tenant_id,'tenant_name',connection.tenant_name,'auth_state',connection.auth_state,
      'last_refresh_error',connection.last_refresh_error,'grant_id',connection.grant_id,
      'updated_at',connection.updated_at,'reauth_required_at',connection.reauth_required_at) end,
    'grantScopes',scopes,'snapshot',snapshot,'lastSyncedAt',freshness,
    'invalidSnapshot',invalid_snapshot,'statusUnavailable',status_unavailable,
    'latestRun',case when latest.id is null then null else jsonb_build_object(
      'id',latest.id,'status',latest.status,'lease_expires_at',latest.lease_expires_at,
      'started_at',latest.started_at,'error_code',latest.error_code) end,
    'financialEpoch',coalesce(financial_epoch,0)::text,
    'projectionRevision',coalesce(projection_revision,0)::text,
    'accessDigest',md5(coalesce(subscription_json::text,'') || coalesce(connection.tenant_id,'') ||
      coalesce(connection.auth_state,'') || coalesce(connection.grant_id::text,'') || coalesce(scopes::text,'')));
end $$;
revoke all on function public.read_dashboard_bootstrap_context(uuid,text,date,text[],timestamptz)
  from public, anon, authenticated;
grant execute on function public.read_dashboard_bootstrap_context(uuid,text,date,text[],timestamptz)
  to service_role;
