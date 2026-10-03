-- One scoped, MVCC-consistent customer detail read. Financial values remain
-- certified Phase 3.3 derivatives; invoice presentation remains in TypeScript.
create function public.read_collection_customer_detail_bootstrap(
  p_user_id uuid, p_tenant_id text, p_customer_source_id text, p_evaluation_date date
) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog as $$
declare ctx jsonb; v_generation uuid; v_revision bigint; v_projection bigint;
  v_feature jsonb; v_override text; v_invoices jsonb; v_disputes jsonb;
  v_promises jsonb; v_currency jsonb;
begin
  if p_user_id is null or p_tenant_id is null or btrim(p_tenant_id) = ''
    or p_customer_source_id is null or btrim(p_customer_source_id) = ''
    or p_evaluation_date is null or not isfinite(p_evaluation_date)
  then raise exception 'customer_detail_invalid_scope' using errcode = '22023'; end if;
  ctx := collection_materialization_private.context(p_user_id, p_tenant_id);
  v_generation := (ctx->>'generationId')::uuid;
  if v_generation is null or ctx->>'generationStatus' is distinct from 'succeeded'
    or (ctx->>'generationReady')::boolean is distinct from true
  then return jsonb_build_object('ready',false,'context',ctx); end if;
  select coalesce(sum(r.financial_revision),0) into v_revision
    from public.collection_customer_financial_revisions r
    where r.user_id=p_user_id and r.tenant_id=p_tenant_id and r.source_system='xero'
      and collection_materialization_private.identity(r.customer_source_id)=p_customer_source_id;
  select coalesce(h.projection_revision,0) into v_projection
    from (values(1)) one(dummy) left join public.collection_dependency_heads h
      on h.user_id=p_user_id and h.tenant_id=p_tenant_id and h.source_system='xero';
  select f.result into v_feature from public.collection_customer_features f
    join public.collection_customer_bases b on b.user_id=f.user_id and b.tenant_id=f.tenant_id
      and b.source_system=f.source_system and b.generation_id=f.generation_id
      and b.customer_source_id=f.customer_source_id and b.basis_version=f.basis_version
    where f.user_id=p_user_id and f.tenant_id=p_tenant_id and f.source_system='xero'
      and f.generation_id=v_generation and f.customer_source_id=p_customer_source_id
      and f.basis_version=ctx->>'basisVersion' and f.feature_version=ctx->>'featureVersion'
      and f.customer_financial_revision=v_revision and f.evaluation_date=p_evaluation_date
      and f.evidence_identity=ctx->>'evidenceIdentity' and f.complete and b.complete;
  select o.override_level into v_override from public.customer_overrides o
    where o.user_id=p_user_id and o.tenant_id=p_tenant_id
      and o.customer_source_id=p_customer_source_id;
  -- Current selected-customer accounting rows only. An aggregate has no REST
  -- default page limit, including for customers with 1,000+ invoices.
  select coalesce(jsonb_agg(to_jsonb(i) order by i.source_id),'[]'::jsonb) into v_invoices from (
    select user_id,tenant_id,source_id,source_system,customer_source_id,type,status,
      amount_due_native::text as amount_due_native,amount_due_base::text as amount_due_base,
      transaction_currency_code,organisation_base_currency_code,
      xero_currency_rate::text as xero_currency_rate,invoice_number,reference,issue_date,due_date
    from public.canonical_invoices where user_id=p_user_id and tenant_id=p_tenant_id
      and source_system='xero' and sync_run_id=v_generation
      and customer_source_id=p_customer_source_id and type='ACCREC'
  ) i;
  select coalesce(jsonb_agg(to_jsonb(d) order by d.id),'[]'::jsonb) into v_disputes from (
    select id,user_id,tenant_id,source_system,invoice_source_id,dispute_mode,
      recorded_disputed_amount_native::text as recorded_disputed_amount_native,
      amount_due_at_last_review_native::text as amount_due_at_last_review_native,
      note,is_active,resolved_at,created_at,updated_at,revision::text as revision
    from public.invoice_disputes where user_id=p_user_id and tenant_id=p_tenant_id
      and invoice_source_id in (select i.source_id from public.canonical_invoices i
        where i.user_id=p_user_id and i.tenant_id=p_tenant_id and i.source_system='xero'
          and i.sync_run_id=v_generation and i.customer_source_id=p_customer_source_id and i.type='ACCREC')
  ) d;
  select coalesce(jsonb_agg(to_jsonb(p) order by p.created_at desc,p.id asc),'[]'::jsonb)
    into v_promises from (
    select id,user_id,tenant_id,source_system,invoice_source_id,customer_source_id,
      currency_code,status,promised_amount_native::text as promised_amount_native,
      qualifying_paid_amount_native::text as qualifying_paid_amount_native,
      promised_date,note,revision::text as revision,created_at,resolved_at
    from public.invoice_promises where user_id=p_user_id and tenant_id=p_tenant_id
      and source_system='xero' and customer_source_id=p_customer_source_id
  ) p;
  -- The entitlement population is tenant-wide even for a targeted customer.
  -- SQL returns only its count/distinct valid currencies, not unrelated rows.
  select jsonb_build_object('relevantInvoiceCount',count(*),
    'invoicedCurrencies',coalesce(jsonb_agg(distinct upper(btrim(i.transaction_currency_code))
      order by upper(btrim(i.transaction_currency_code))) filter (
        where upper(btrim(coalesce(i.transaction_currency_code,''))) ~ '^[A-Z]{3}$'), '[]'::jsonb))
    into v_currency from public.canonical_invoices i
    where i.user_id=p_user_id and i.tenant_id=p_tenant_id and i.source_system='xero'
      and i.sync_run_id=v_generation and upper(btrim(coalesce(i.type,'')))='ACCREC'
      and upper(btrim(coalesce(i.status,'')))='AUTHORISED'
      and btrim(coalesce(i.customer_source_id,''))<>'' and i.amount_due_native>0;
  return jsonb_build_object('ready',v_feature is not null,
    'context',ctx,'customerRevision',v_revision::text,'projectionRevision',v_projection::text,
    'feature',v_feature,'overrideLevel',coalesce(v_override,'normal'),
    'invoices',v_invoices,'disputes',v_disputes,'promises',v_promises,
    'currencyPopulation',v_currency);
end $$;

revoke all on function public.read_collection_customer_detail_bootstrap(uuid,text,text,date)
  from public,anon,authenticated;
grant execute on function public.read_collection_customer_detail_bootstrap(uuid,text,text,date)
  to service_role;
