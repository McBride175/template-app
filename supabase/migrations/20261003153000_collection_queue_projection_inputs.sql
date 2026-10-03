-- One statement snapshot of the ready financial calculation and its current
-- operational overlay. Financial scoring remains exclusively in TypeScript.
create function public.read_collection_queue_projection_inputs(
  p_user_id uuid, p_tenant_id text, p_evaluation_date date, p_overdue_only boolean
) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog as $$
declare ctx jsonb; v_calculation_id uuid; head jsonb; rank_rows jsonb; overrides jsonb;
  actions jsonb; review_rows jsonb; projection_revision text; prior_actions boolean;
begin
  if p_user_id is null or p_tenant_id is null or btrim(p_tenant_id) = ''
    or p_evaluation_date is null or not isfinite(p_evaluation_date) or p_overdue_only is null
  then raise exception 'collection_queue_invalid_scope' using errcode = '22023'; end if;

  ctx := collection_materialization_private.context(p_user_id, p_tenant_id);
  select coalesce(h.projection_revision, 0)::text into projection_revision
    from (values(1)) one(dummy)
    left join public.collection_dependency_heads h on h.user_id = p_user_id
      and h.tenant_id = p_tenant_id and h.source_system = 'xero';
  select c.id into v_calculation_id from public.collection_portfolio_calculations c
    where c.user_id = p_user_id and c.tenant_id = p_tenant_id and c.source_system = 'xero'
      and c.generation_id = (ctx->>'generationId')::uuid
      and c.financial_epoch = (ctx->>'financialEpoch')::bigint
      and c.evaluation_date = p_evaluation_date
      and c.basis_version = ctx->>'basisVersion' and c.feature_version = ctx->>'featureVersion'
      and c.scoring_model_version = 'collection_scoring_50_25_15_10_v1'
      and c.scoring_scope = 'collections' and c.overdue_only = p_overdue_only
      and c.calculation_version = 'portfolio_base_v1'
      and c.evidence_identity = ctx->>'evidenceIdentity';
  if ctx->>'generationStatus' is distinct from 'succeeded'
    or (ctx->>'generationReady')::boolean is distinct from true
    or not collection_portfolio_private.valid(v_calculation_id)
  then v_calculation_id := null; end if;
  if v_calculation_id is null then
    return jsonb_build_object('context', ctx, 'projectionRevision', projection_revision,
      'head', null, 'rankRows', '[]'::jsonb);
  end if;

  head := collection_portfolio_private.head(v_calculation_id);
  select coalesce(jsonb_agg(jsonb_build_object(
    'customerId', s.customer_source_id, 'order', s.population_order,
    'customerName', s.payload#>>'{score,input,customer_name}',
    'amountDecimal', s.payload#>>'{projection,customer_to_chase_overdue_base_decimal}',
    'baseScore', s.base_score,
    'hasActionableOverdueBalance', (s.payload#>>'{score,input,has_actionable_overdue_balance}')::boolean,
    'payloadDigest', s.payload_digest) order by s.population_order), '[]'::jsonb)
    into rank_rows from public.collection_portfolio_base_scores s
    where s.calculation_id = v_calculation_id and s.scoring_member;
  select coalesce(jsonb_agg(jsonb_build_object('customer_source_id', o.customer_source_id,
    'override_level', o.override_level) order by o.customer_source_id), '[]'::jsonb)
    into overrides from public.customer_overrides o
    where o.user_id = p_user_id and o.tenant_id = p_tenant_id;
  select exists(select 1 from public.collection_actions a where a.user_id = p_user_id
    and a.tenant_id = p_tenant_id and a.source_system = 'xero') into prior_actions;
  select coalesce(jsonb_agg(jsonb_build_object(
    'customer_source_id', ranked.customer_source_id, 'action_format', ranked.action_format,
    'id', ranked.id, 'action_type', ranked.action_type, 'outcome', ranked.outcome,
    'note', ranked.note, 'next_action_date', ranked.next_action_date,
    'action_timestamp', ranked.action_timestamp)
    order by ranked.customer_source_id, ranked.action_format), '[]'::jsonb)
    into actions from (
      select distinct on (a.customer_source_id,
        case when a.action_type = 'outcome' then 'v1' else 'legacy' end)
        a.customer_source_id,
        case when a.action_type = 'outcome' then 'v1' else 'legacy' end as action_format,
        a.id, a.action_type, a.outcome,
        case when a.action_type = 'outcome' then left(a.note, 160) else null end as note,
        a.next_action_date, a.action_timestamp
      from public.collection_actions a
      where a.user_id = p_user_id and a.tenant_id = p_tenant_id and a.source_system = 'xero'
        and a.action_type in ('outcome', 'called', 'emailed', 'postponed')
        and exists(select 1 from public.collection_portfolio_base_scores s
          where s.calculation_id = v_calculation_id and s.customer_source_id = a.customer_source_id)
      order by a.customer_source_id,
        case when a.action_type = 'outcome' then 'v1' else 'legacy' end,
        a.action_timestamp desc, a.id desc
    ) ranked;
  review_rows := '[]'::jsonb;
  if (head#>>'{metadata,reviewRequiredCustomerCount}')::integer > 0 then
    select coalesce(jsonb_agg(r.value order by r.value->>'customer_source_id'), '[]'::jsonb)
      into review_rows from public.collection_customer_features f
      cross join lateral jsonb_array_elements(f.result->'result'->'reviewRequiredCustomers') r(value)
      where f.user_id = p_user_id and f.tenant_id = p_tenant_id and f.source_system = 'xero'
        and f.generation_id = (ctx->>'generationId')::uuid
        and f.basis_version = ctx->>'basisVersion' and f.feature_version = ctx->>'featureVersion'
        and f.evaluation_date = p_evaluation_date and f.evidence_identity = ctx->>'evidenceIdentity'
        and f.complete;
  end if;
  return jsonb_build_object('context', ctx, 'projectionRevision', projection_revision,
    'head', head, 'rankRows', rank_rows, 'overrides', overrides, 'actions', actions,
    'hasPriorActionActivity', prior_actions, 'reviewRequiredCustomers', review_rows);
end $$;

revoke all on function public.read_collection_queue_projection_inputs(uuid,text,date,boolean)
  from public, anon, authenticated;
grant execute on function public.read_collection_queue_projection_inputs(uuid,text,date,boolean)
  to service_role;

-- Hydrate only selected rows after the application has applied exact JS tie
-- ordering/eligibility. The first read's manifest digest certified the entire
-- rank population; callers compare selected payload digests across snapshots.
create function public.read_collection_queue_projection_details(
  p_user_id uuid, p_tenant_id text, p_evaluation_date date,
  p_overdue_only boolean, p_calculation_id uuid,
  p_expected_projection_revision bigint, p_customer_ids text[]
) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog as $$
declare ctx jsonb; revision bigint; matching uuid; details jsonb;
begin
  if p_user_id is null or p_tenant_id is null or btrim(p_tenant_id) = ''
    or p_evaluation_date is null or not isfinite(p_evaluation_date)
    or p_overdue_only is null or p_calculation_id is null
    or p_expected_projection_revision is null or p_expected_projection_revision < 0
    or p_customer_ids is null or cardinality(p_customer_ids) > 200
    or cardinality(p_customer_ids) <> (select count(distinct id) from unnest(p_customer_ids) id)
  then raise exception 'collection_queue_invalid_details' using errcode = '22023'; end if;
  ctx := collection_materialization_private.context(p_user_id, p_tenant_id);
  select coalesce(h.projection_revision, 0) into revision from (values(1)) one(dummy)
    left join public.collection_dependency_heads h on h.user_id = p_user_id
      and h.tenant_id = p_tenant_id and h.source_system = 'xero';
  select c.id into matching from public.collection_portfolio_calculations c
    where c.id = p_calculation_id and c.user_id = p_user_id and c.tenant_id = p_tenant_id
      and c.source_system = 'xero' and c.generation_id = (ctx->>'generationId')::uuid
      and c.financial_epoch = (ctx->>'financialEpoch')::bigint
      and c.evaluation_date = p_evaluation_date
      and c.basis_version = ctx->>'basisVersion' and c.feature_version = ctx->>'featureVersion'
      and c.scoring_model_version = 'collection_scoring_50_25_15_10_v1'
      and c.scoring_scope = 'collections' and c.overdue_only = p_overdue_only
      and c.calculation_version = 'portfolio_base_v1'
      and c.evidence_identity = ctx->>'evidenceIdentity'
      and c.complete and c.payload_digest = c.manifest_digest;
  if matching is null or revision is distinct from p_expected_projection_revision
    or ctx->>'generationStatus' is distinct from 'succeeded'
    or (ctx->>'generationReady')::boolean is distinct from true
  then return jsonb_build_object('valid', false); end if;
  select coalesce(jsonb_agg(jsonb_build_object('customerId', s.customer_source_id,
    'payload', s.payload, 'payloadDigest', s.payload_digest)
    order by array_position(p_customer_ids, s.customer_source_id)), '[]'::jsonb)
    into details from public.collection_portfolio_base_scores s
    where s.calculation_id = matching and s.customer_source_id = any(p_customer_ids);
  if jsonb_array_length(details) <> cardinality(p_customer_ids) then
    return jsonb_build_object('valid', false); end if;
  return jsonb_build_object('valid', true, 'rows', details,
    'projectionRevision', revision::text, 'generationId', ctx->>'generationId',
    'financialEpoch', ctx->>'financialEpoch');
end $$;

revoke all on function public.read_collection_queue_projection_details(uuid,text,date,boolean,uuid,bigint,text[])
  from public, anon, authenticated;
grant execute on function public.read_collection_queue_projection_details(uuid,text,date,boolean,uuid,bigint,text[])
  to service_role;
