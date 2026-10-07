-- Request preparation only. No domain mutation/claim/promotion is folded into
-- this read. STABLE nested reads share the calling statement's MVCC snapshot.
create function public.read_collection_access_context(
  p_user_id uuid, p_tenant_id text, p_usage_date date,
  p_paid_price_ids text[], p_now timestamptz, p_source_system text default 'xero'
) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog as $$
declare c jsonb; t text; g uuid; org jsonb; currencies jsonb;
  user_days integer := 0; date_consumed boolean := false;
begin
  if p_source_system is distinct from 'xero' or p_user_id is null
    or (p_tenant_id is not null and btrim(p_tenant_id)='') then
    raise exception 'collection_access_invalid_scope' using errcode='22023';
  end if;
  c := public.read_dashboard_bootstrap_context(p_user_id,p_tenant_id,p_usage_date,p_paid_price_ids,p_now);
  t := c#>>'{connection,tenant_id}';
  g := (c#>>'{snapshot,syncRunId}')::uuid;
  -- Preserve the no-connected-tenant free entitlement DTO too. Paid access
  -- deliberately never reads the free ledger.
  if not (c->>'paid')::boolean then
    select count(distinct u.usage_date),coalesce(bool_or(u.usage_date=p_usage_date),false)
      into user_days,date_consumed from public.billing_usage_days u where u.user_id=p_user_id;
  end if;
  -- A null active pointer with a success timestamp is inconsistent, not legacy.
  if t is not null and exists(select 1 from public.xero_sync_tenant_state s
    where s.user_id=p_user_id and s.tenant_id=t and s.active_sync_run_id is null
      and s.last_successful_sync_at is not null) then
    c := c || jsonb_build_object('invalidSnapshot',true,'snapshot',null);
  end if;
  if t is not null and not (c->>'invalidSnapshot')::boolean then
    select jsonb_build_object('base_currency_code',o.base_currency_code,
      'source_timezone',o.source_timezone,'country_code',o.country_code)
      into org from public.canonical_organisations o
      where o.user_id=p_user_id and o.tenant_id=t and o.source_system='xero'
        and o.sync_run_id is not distinct from g
      order by o.source_retrieved_at desc limit 1;
    -- Exact tenant-wide gross open-receivable entitlement population, including
    -- invalid/missing currency codes in the count. No invoice payload transfer.
    -- This matches deriveCollectionsCurrencyContext, not collectible features.
    select jsonb_build_object('relevantInvoiceCount',count(*),
      'invoicedCurrencies',coalesce(jsonb_agg(distinct upper(btrim(i.transaction_currency_code))
        order by upper(btrim(i.transaction_currency_code))) filter (
        where upper(btrim(coalesce(i.transaction_currency_code,''))) ~ '^[A-Z]{3}$'),'[]'::jsonb))
      into currencies from public.canonical_invoices i
      where i.user_id=p_user_id and i.tenant_id=t and i.source_system='xero'
        and i.sync_run_id is not distinct from g and upper(btrim(coalesce(i.type,'')))='ACCREC'
        and upper(btrim(coalesce(i.status,'')))='AUTHORISED'
        and btrim(coalesce(i.customer_source_id,''))<>'' and i.amount_due_native>0
        and i.amount_due_native < 'Infinity'::numeric;
  end if;
  return c || jsonb_build_object('userId',p_user_id,'sourceSystem','xero',
    'organisation',org,'currencyPopulation',currencies,
    'userUsageDays',user_days,'usageDateConsumed',date_consumed);
end $$;
revoke all on function public.read_collection_access_context(uuid,text,date,text[],timestamptz,text)
  from public,anon,authenticated;
grant execute on function public.read_collection_access_context(uuid,text,date,text[],timestamptz,text)
  to service_role;
