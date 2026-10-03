-- Exact disposable financial calculations. No live route, score formula or domain writer changes.
create schema collection_portfolio_private authorization postgres;
revoke all on schema collection_portfolio_private from public,anon,authenticated,service_role;
create table public.collection_portfolio_calculations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  tenant_id text not null check(btrim(tenant_id)<>''), source_system text not null check(source_system='xero'),
  generation_id uuid not null, financial_epoch bigint not null check(financial_epoch>=0),
  evaluation_date date not null check(isfinite(evaluation_date)),
  basis_version text not null check(basis_version='customer_basis_v1'),
  feature_version text not null check(feature_version='customer_features_v1'),
  scoring_model_version text not null check(scoring_model_version='collection_scoring_50_25_15_10_v1'),
  scoring_scope text not null check(scoring_scope='collections'), overdue_only boolean not null,
  calculation_version text not null check(calculation_version='portfolio_base_v1'),
  evidence_identity text not null, complete boolean not null check(complete),
  feature_basis_count integer not null check(feature_basis_count>=0),
  customer_count integer not null check(customer_count>=0), scored_customer_count integer not null check(scored_customer_count>=0),
  payload jsonb not null check(jsonb_typeof(payload)='object'), population_digest text not null, manifest_digest text not null,
  payload_digest text generated always as (encode(public.digest(payload::text,'sha256'),'hex')) stored,
  published_at timestamptz not null default clock_timestamp(),
  foreign key(generation_id,user_id,tenant_id) references public.xero_sync_runs(id,user_id,tenant_id) on delete cascade,
  unique(user_id,tenant_id,source_system,generation_id,financial_epoch,evaluation_date,basis_version,feature_version,
    scoring_model_version,scoring_scope,overdue_only,calculation_version,evidence_identity)
);
create index collection_portfolio_retention on public.collection_portfolio_calculations(user_id,tenant_id,source_system,published_at desc);
create table public.collection_portfolio_base_scores (
  calculation_id uuid not null references public.collection_portfolio_calculations(id) on delete cascade,
  customer_source_id text not null, population_order integer not null,
  customer_financial_revision bigint not null check(customer_financial_revision>=0),
  payload jsonb not null check(jsonb_typeof(payload)='object'),
  exposure_score double precision generated always as ((payload#>>'{score,components,exposureScore}')::double precision) stored,
  urgency_score double precision generated always as ((payload#>>'{score,components,urgencyScore}')::double precision) stored,
  deterioration_score double precision generated always as ((payload#>>'{score,components,relativeDeteriorationScore}')::double precision) stored,
  payment_recency_score double precision generated always as ((payload#>>'{score,components,paymentRecencyScore}')::double precision) stored,
  base_score double precision generated always as ((payload#>>'{score,weighted}')::double precision) stored,
  scoring_member boolean generated always as ((payload#>>'{membership,scoring}')::boolean) stored,
  to_chase_base numeric generated always as ((payload#>>'{projection,customer_to_chase_overdue_base_decimal}')::numeric) stored,
  payload_digest text generated always as (encode(public.digest(payload::text,'sha256'),'hex')) stored,
  primary key(calculation_id,customer_source_id), unique(calculation_id,population_order)
);
alter table public.collection_portfolio_calculations enable row level security;
alter table public.collection_portfolio_base_scores enable row level security;
revoke all on public.collection_portfolio_calculations,public.collection_portfolio_base_scores from public,anon,authenticated,service_role;
grant select on public.collection_portfolio_calculations,public.collection_portfolio_base_scores to service_role;

-- Row-count and stored checksums reject missing/corrupted disposable rows. No feature/source reads.
create function collection_portfolio_private.valid(p_id uuid) returns boolean
language sql stable set search_path=pg_catalog as $$
 select coalesce((select c.complete and c.customer_count=s.n and c.scored_customer_count=s.scored
   and c.population_digest=s.digest and c.manifest_digest=c.payload_digest from public.collection_portfolio_calculations c cross join lateral(
    select count(*) n,count(*) filter(where scoring_member) scored,
      encode(sha256(convert_to(coalesce(string_agg(payload_digest,'' order by customer_source_id),''),'UTF8')),'hex') digest
    from public.collection_portfolio_base_scores where calculation_id=c.id) s where c.id=p_id),false)
$$;
create function collection_portfolio_private.head(p_id uuid) returns jsonb
language sql stable set search_path=pg_catalog as $$
 select jsonb_build_object('calculationId',id,'identity',jsonb_build_object('userId',user_id,'tenantId',tenant_id,'sourceSystem',source_system,
   'generationId',generation_id,'financialEpoch',financial_epoch::text,'evaluationDate',evaluation_date,
   'basisVersion',basis_version,'featureVersion',feature_version,'scoringModelVersion',scoring_model_version,
   'scoringScope',scoring_scope,'overdueOnly',overdue_only,'calculationVersion',calculation_version,'evidenceIdentity',evidence_identity),
   'featureBasisCount',feature_basis_count,'customerCount',customer_count,'scoredCustomerCount',scored_customer_count,
   'provenance',payload->'provenance','benchmarks',payload->'benchmarks','population',payload->'population','metadata',payload->'metadata','publishedAt',published_at)
 from public.collection_portfolio_calculations where id=p_id
$$;
-- Identity probe and requested compact rows share one database snapshot. Empty
-- customer_ids means manifest only; null means keyset page; targeted max100.
create function public.read_collection_portfolio_calculation(p_user_id uuid,p_tenant_id text,p_evaluation_date date,
  p_overdue_only boolean,p_scoring_scope text default 'collections',p_customer_ids text[] default '{}'::text[],
  p_after text default null,p_limit integer default 2000) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog as $$
declare ctx jsonb; calc uuid; previous_id uuid; rows jsonb;
begin
 if p_scoring_scope is distinct from 'collections' or p_evaluation_date is null or not isfinite(p_evaluation_date)
   or cardinality(p_customer_ids)>100 or p_user_id is null or btrim(p_tenant_id)='' then raise exception 'portfolio_invalid_scope' using errcode='22023';end if;
 ctx:=collection_materialization_private.context(p_user_id,p_tenant_id);
 select id into calc from public.collection_portfolio_calculations where user_id=p_user_id and tenant_id=p_tenant_id and source_system='xero'
   and generation_id=(ctx->>'generationId')::uuid and financial_epoch=(ctx->>'financialEpoch')::bigint
   and evaluation_date=p_evaluation_date and basis_version=ctx->>'basisVersion' and feature_version=ctx->>'featureVersion'
   and scoring_model_version='collection_scoring_50_25_15_10_v1' and scoring_scope=p_scoring_scope and overdue_only=p_overdue_only
   and calculation_version='portfolio_base_v1' and evidence_identity=ctx->>'evidenceIdentity';
 if ctx->>'generationStatus' is distinct from 'succeeded' or (ctx->>'generationReady')::boolean is distinct from true
   or not collection_portfolio_private.valid(calc) then calc:=null;end if;
 if calc is not null then
   select coalesce(jsonb_agg(payload order by customer_source_id),'[]'::jsonb) into rows from (
    select customer_source_id,payload from public.collection_portfolio_base_scores where calculation_id=calc
      and (p_customer_ids is null or customer_source_id=any(p_customer_ids)) and (p_after is null or customer_source_id>p_after)
    order by customer_source_id limit greatest(0,least(p_limit,2000))) page;
 end if;
 if calc is null then
   select id into previous_id from public.collection_portfolio_calculations where user_id=p_user_id and tenant_id=p_tenant_id and source_system='xero'
    and generation_id=(ctx->>'generationId')::uuid and evaluation_date=p_evaluation_date and scoring_scope=p_scoring_scope and overdue_only=p_overdue_only
    and basis_version=ctx->>'basisVersion' and feature_version=ctx->>'featureVersion' and calculation_version='portfolio_base_v1'
    and scoring_model_version='collection_scoring_50_25_15_10_v1' order by published_at desc limit 1;
   if not collection_portfolio_private.valid(previous_id) then previous_id:=null;end if;
 end if;
 return jsonb_build_object('previousHead',collection_portfolio_private.head(previous_id),'context',ctx,'head',collection_portfolio_private.head(calc),'rows',coalesce(rows,'[]'::jsonb));
end $$;

-- One bounded atomic publication: existing financial lock order; complete features
-- checked set-wise; manifest and all scores inserted in the same transaction.
create function public.publish_collection_portfolio_calculation(p_user_id uuid,p_tenant_id text,p_identity jsonb,p_calculation jsonb) returns uuid
language plpgsql security definer set search_path=pg_catalog as $$
declare ctx jsonb; g uuid; found_id uuid; new_id uuid; expected_count integer; feature_count integer; basis_count integer; scored integer;
  revision_population jsonb; blocked boolean; actual_count integer; actual_currency text; actual_health text;
begin
 if p_identity->>'userId' is distinct from p_user_id::text or p_identity->>'tenantId' is distinct from p_tenant_id
   or p_identity->>'sourceSystem' is distinct from 'xero' or p_identity->>'scoringScope' is distinct from 'collections'
   or p_identity->>'scoringModelVersion' is distinct from 'collection_scoring_50_25_15_10_v1'
   or p_identity->>'calculationVersion' is distinct from 'portfolio_base_v1'
   or p_identity->>'basisVersion' is distinct from 'customer_basis_v1' or p_identity->>'featureVersion' is distinct from 'customer_features_v1'
   or jsonb_typeof(p_identity->'overdueOnly') is distinct from 'boolean'
   or jsonb_typeof(p_calculation->'rows') is distinct from 'array' then raise exception 'portfolio_invalid_publication' using errcode='22023';end if;
 perform collection_dependency_private.lock_financial_scope(p_user_id,p_tenant_id,'xero');
 ctx:=collection_materialization_private.context(p_user_id,p_tenant_id);g:=(ctx->>'generationId')::uuid;
 perform 1 from public.xero_customer_credit_validations where user_id=p_user_id and tenant_id=p_tenant_id and sync_run_id=g for share;
 ctx:=collection_materialization_private.context(p_user_id,p_tenant_id);
 if ctx->>'generationId' is distinct from p_identity->>'generationId' or ctx->>'financialEpoch' is distinct from p_identity->>'financialEpoch'
   or ctx->>'evidenceIdentity' is distinct from p_identity->>'evidenceIdentity' or ctx->>'generationStatus' is distinct from 'succeeded'
   or (ctx->>'generationReady')::boolean is distinct from true then return null;end if;
 if p_identity->>'evaluationDate' is null or not isfinite((p_identity->>'evaluationDate')::date) then raise exception 'portfolio_invalid_date';end if;
 -- Previously published newer dates cannot be displaced/relabelled by an older builder.
 if exists(select 1 from public.collection_portfolio_calculations where user_id=p_user_id and tenant_id=p_tenant_id and source_system='xero'
   and generation_id=g and scoring_scope=p_identity->>'scoringScope' and overdue_only=(p_identity->>'overdueOnly')::boolean
   and evaluation_date>(p_identity->>'evaluationDate')::date) then return null;end if;
 select m.basis_count into basis_count from public.collection_basis_manifests m where m.user_id=p_user_id and m.tenant_id=p_tenant_id
   and m.source_system='xero' and m.generation_id=g and m.basis_version=p_identity->>'basisVersion' and m.complete;
 if basis_count is null then return null;end if;
 -- Lock current feature slots against concurrent publication/date replacement or pruning.
 perform 1 from public.collection_customer_features where user_id=p_user_id and tenant_id=p_tenant_id and source_system='xero' and generation_id=g for share;
 with revisions as materialized(select collection_materialization_private.identity(customer_source_id) k,sum(financial_revision)::bigint revision
   from public.collection_customer_financial_revisions where user_id=p_user_id and tenant_id=p_tenant_id and source_system='xero'
   group by collection_materialization_private.identity(customer_source_id)),
 features as(select f.*,coalesce(r.revision,0) current_revision from public.collection_customer_features f left join revisions r on r.k=f.customer_source_id
   where f.user_id=p_user_id and f.tenant_id=p_tenant_id and f.source_system='xero' and f.generation_id=g)
 select count(*),coalesce(bool_or(not complete or basis_version<>p_identity->>'basisVersion' or feature_version<>p_identity->>'featureVersion'
     or customer_financial_revision<>current_revision or evaluation_date<>(p_identity->>'evaluationDate')::date or evidence_identity<>p_identity->>'evidenceIdentity'),false),
   coalesce(sum(jsonb_array_length(result->'result'->'rows')),0),
   coalesce(jsonb_object_agg(customer_source_id,to_jsonb(customer_financial_revision)) filter(where jsonb_array_length(result->'result'->'rows')=1),'{}'::jsonb),
   min(result#>>'{result,organisationBaseCurrency}'),case when bool_or(result#>>'{result,currencyHealth,status}'='unavailable') then 'unavailable'
     when sum((result#>>'{result,currencyHealth,affectedInvoiceCount}')::integer)>0 then 'degraded' else 'healthy' end
 into feature_count,blocked,expected_count,revision_population,actual_currency,actual_health from features;
 if blocked or feature_count<>basis_count or (select count(*) from public.collection_customer_bases where user_id=p_user_id and tenant_id=p_tenant_id and source_system='xero' and generation_id=g)<>basis_count then return null;end if;
 if p_calculation#>>'{metadata,organisationBaseCurrency}' is distinct from actual_currency
   or p_calculation#>>'{metadata,currencyHealth,status}' is distinct from actual_health then return null;end if;
 blocked:=actual_health='unavailable' or actual_currency is null;
 actual_count:=jsonb_array_length(p_calculation->'rows');
 if actual_count<>(case when blocked then 0 else expected_count end) or (p_calculation#>>'{population,features}')::integer<>expected_count
   or not (p_calculation ?& array['benchmarks','population','metadata','rows'])
   or not (p_calculation->'population' ?& array['features','invoiceScope','ageing','scoring','analysed'])
   or not (p_calculation->'metadata' ?& array['organisationBaseCurrency','organisationTimezone','currencyHealth','currencyContext','sourceCounts','reviewRequiredCustomerCount'])
   or (not blocked and jsonb_typeof(p_calculation->'benchmarks') is distinct from 'object')
   or (blocked and p_calculation->'benchmarks' is distinct from 'null'::jsonb)
   or exists(select 1 from jsonb_array_elements(p_calculation->'rows') j where not (j ?& array['customerId','order','membership','projection','score'])
      or not (revision_population ? (j->>'customerId'))
      or not(j->'membership' ?& array['invoiceScope','ageing','scoring','analysed'])
      or exists(select 1 from jsonb_each(j->'membership') flag where jsonb_typeof(flag.value)<>'boolean')
      or (j->>'order')::integer<0 or (j->>'order')::integer>=actual_count
      or (j->'membership'->>'scoring')::boolean is distinct from (j->'score'<>'null'::jsonb)
      or (j->'score'<>'null'::jsonb and (not(j->'score' ?& array['input','components','weighted','validity','explanation']) or j#>>'{score,validity}'<>'finite'
        or j#>>'{score,input,customer_source_id}' is distinct from j->>'customerId'
        or jsonb_typeof(j->'score'->'weighted') is distinct from 'number'
        or not(j->'score'->'components' ?& array['exposureScore','urgencyScore','relativeDeteriorationScore','paymentRecencyScore'])
        or exists(select 1 from jsonb_each(j->'score'->'components') component where jsonb_typeof(component.value)<>'number')
        or not(j->'score'->'explanation' ?& array['exposureSharePercent','exposureRelativeToLargestPercent','urgencyBaseScore','invoiceCountBonus','rawScore'])
        or not(j->'score'->'input' ?& array['customer_source_id','customer_name','customer_email','customer_overdue_to_chase_base','has_actionable_overdue_balance','invoice_overdue_to_chase_base','total_outstanding_base','overdue_invoices_count','open_invoices_count','weighted_avg_overdue_days','last_payment_date','last_payment_days_ago','has_recent_partial_payment','relative_lateness_days','organisation_base_currency_code']))))
   or (select count(distinct j->>'customerId') from jsonb_array_elements(p_calculation->'rows') j)<>actual_count
   then return null;end if;
 select count(*) filter(where (j#>>'{membership,scoring}')::boolean) into scored from jsonb_array_elements(p_calculation->'rows') j;
 if scored is distinct from (p_calculation#>>'{population,scoring}')::integer
   or (select count(*) filter(where (j#>>'{membership,invoiceScope}')::boolean) from jsonb_array_elements(p_calculation->'rows') j)<>(p_calculation#>>'{population,invoiceScope}')::integer
   or (select count(*) filter(where (j#>>'{membership,ageing}')::boolean) from jsonb_array_elements(p_calculation->'rows') j)<>(p_calculation#>>'{population,ageing}')::integer
   or (select count(*) filter(where (j#>>'{membership,analysed}')::boolean) from jsonb_array_elements(p_calculation->'rows') j)<>(p_calculation#>>'{population,analysed}')::integer then return null;end if;
 select id into found_id from public.collection_portfolio_calculations where user_id=p_user_id and tenant_id=p_tenant_id and source_system='xero'
   and generation_id=g and financial_epoch=(p_identity->>'financialEpoch')::bigint and evaluation_date=(p_identity->>'evaluationDate')::date
   and scoring_scope=p_identity->>'scoringScope' and overdue_only=(p_identity->>'overdueOnly')::boolean and evidence_identity=p_identity->>'evidenceIdentity'
   and basis_version=p_identity->>'basisVersion' and feature_version=p_identity->>'featureVersion'
   and calculation_version=p_identity->>'calculationVersion' and scoring_model_version=p_identity->>'scoringModelVersion';
 if collection_portfolio_private.valid(found_id) then return found_id;end if;
 if found_id is not null then delete from public.collection_portfolio_calculations where id=found_id;end if;
 insert into public.collection_portfolio_calculations(user_id,tenant_id,source_system,generation_id,financial_epoch,evaluation_date,
   basis_version,feature_version,scoring_model_version,scoring_scope,overdue_only,calculation_version,evidence_identity,complete,
   feature_basis_count,customer_count,scored_customer_count,payload,population_digest,manifest_digest)
 values(p_user_id,p_tenant_id,'xero',g,(p_identity->>'financialEpoch')::bigint,(p_identity->>'evaluationDate')::date,
   p_identity->>'basisVersion',p_identity->>'featureVersion',p_identity->>'scoringModelVersion',p_identity->>'scoringScope',
   (p_identity->>'overdueOnly')::boolean,p_identity->>'calculationVersion',p_identity->>'evidenceIdentity',true,basis_count,actual_count,scored,
   p_calculation-'rows','pending',encode(sha256(convert_to((p_calculation-'rows')::text,'UTF8')),'hex')) returning id into new_id;
 insert into public.collection_portfolio_base_scores(calculation_id,customer_source_id,population_order,customer_financial_revision,payload)
 select new_id,j->>'customerId',(j->>'order')::integer,(revision_population->>(j->>'customerId'))::bigint,j from jsonb_array_elements(p_calculation->'rows') j;
 update public.collection_portfolio_calculations set population_digest=(select encode(sha256(convert_to(coalesce(string_agg(payload_digest,'' order by customer_source_id),''),'UTF8')),'hex')
   from public.collection_portfolio_base_scores where calculation_id=new_id) where id=new_id;
 return new_id;
end $$;

-- Explicit bounded maintenance. Keep two latest calculations per financial
-- scope/mode/model and the current matching identity. No source/feature deletion.
create function public.prune_collection_portfolio_calculations(p_user_id uuid,p_tenant_id text,p_limit integer default 10) returns integer
language plpgsql security definer set search_path=pg_catalog as $$
declare n integer;
begin
 perform collection_dependency_private.lock_financial_scope(p_user_id,p_tenant_id,'xero');
 with ranked as(select id,row_number() over(partition by scoring_scope,overdue_only,scoring_model_version,calculation_version order by evaluation_date desc,published_at desc,id desc) position
   from public.collection_portfolio_calculations where user_id=p_user_id and tenant_id=p_tenant_id and source_system='xero'),
 doomed as(select id from ranked where position>2 and id not in(
     select distinct on(c.scoring_scope,c.overdue_only,c.scoring_model_version,c.calculation_version) c.id
     from public.collection_portfolio_calculations c cross join lateral(select collection_materialization_private.context(p_user_id,p_tenant_id) j) ctx
     where c.user_id=p_user_id and c.tenant_id=p_tenant_id and c.generation_id=(ctx.j->>'generationId')::uuid
       and c.financial_epoch=(ctx.j->>'financialEpoch')::bigint and c.evidence_identity=ctx.j->>'evidenceIdentity'
     order by c.scoring_scope,c.overdue_only,c.scoring_model_version,c.calculation_version,c.evaluation_date desc,c.published_at desc) order by id limit greatest(0,least(p_limit,100)))
 delete from public.collection_portfolio_calculations where id in(select id from doomed);get diagnostics n=row_count;return n;
end $$;
revoke all on all functions in schema collection_portfolio_private from public,anon,authenticated,service_role;
revoke all on function public.read_collection_portfolio_calculation(uuid,text,date,boolean,text,text[],text,integer) from public,anon,authenticated;
grant execute on function public.read_collection_portfolio_calculation(uuid,text,date,boolean,text,text[],text,integer) to service_role;
revoke all on function public.publish_collection_portfolio_calculation(uuid,text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.publish_collection_portfolio_calculation(uuid,text,jsonb,jsonb) to service_role;
revoke all on function public.prune_collection_portfolio_calculations(uuid,text,integer) from public,anon,authenticated;
grant execute on function public.prune_collection_portfolio_calculations(uuid,text,integer) to service_role;
