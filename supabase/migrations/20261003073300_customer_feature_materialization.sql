-- Disposable customer derivatives; no accounting pointer or live-route activation.
create schema collection_materialization_private authorization postgres;
revoke all on schema collection_materialization_private from public,anon,authenticated,service_role;

create table public.collection_customer_bases (
  user_id uuid not null references auth.users(id) on delete cascade,
  tenant_id text not null check (btrim(tenant_id) <> ''),
  source_system text not null check (source_system = 'xero'),
  generation_id uuid not null,
  customer_source_id text not null, -- Empty identity is the unassigned-source bucket, never a customer.
  basis_version text not null check (basis_version = 'customer_basis_v1'),
  complete boolean not null check (complete),
  customer_count integer not null check (customer_count >= 0),
  invoice_count integer not null check (invoice_count >= 0),
  payment_count integer not null check (payment_count >= 0),
  credit_count integer not null check (credit_count >= 0),
  projection_order bigint not null,
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  built_at timestamptz not null default clock_timestamp(),
  primary key(user_id,tenant_id,source_system,generation_id,customer_source_id,basis_version),
  foreign key(generation_id,user_id,tenant_id) references public.xero_sync_runs(id,user_id,tenant_id) on delete cascade,
  check (jsonb_array_length(payload->'customers') = customer_count
    and jsonb_array_length(payload->'invoices') = invoice_count
    and jsonb_array_length(payload->'payments') = payment_count
    and jsonb_array_length(payload->'creditRows') = credit_count)
);
create table public.collection_basis_manifests (
  user_id uuid not null references auth.users(id) on delete cascade,
  tenant_id text not null, source_system text not null check(source_system='xero'),
  generation_id uuid not null, basis_version text not null check(basis_version='customer_basis_v1'),
  basis_count integer not null check(basis_count>=0),
  customer_count bigint not null, invoice_count bigint not null, payment_count bigint not null, credit_count bigint not null,
  complete boolean not null check(complete), built_at timestamptz not null default clock_timestamp(),
  primary key(user_id,tenant_id,source_system,generation_id,basis_version),
  foreign key(generation_id,user_id,tenant_id) references public.xero_sync_runs(id,user_id,tenant_id) on delete cascade
);
create table public.collection_customer_features (
  user_id uuid not null references auth.users(id) on delete cascade,
  tenant_id text not null, source_system text not null check(source_system='xero'),
  generation_id uuid not null, customer_source_id text not null,
  basis_version text not null check(basis_version='customer_basis_v1'),
  feature_version text not null check(feature_version='customer_features_v1'),
  customer_financial_revision bigint not null check(customer_financial_revision>=0),
  evaluation_date date not null check(isfinite(evaluation_date)),
  evidence_identity text not null,
  complete boolean not null check(complete),
  result jsonb not null check(jsonb_typeof(result)='object'),
  -- Queryable exact amounts are generated from the certified payload, not competing inputs.
  gross_outstanding_base numeric generated always as ((result#>>'{result,rows,0,gross_outstanding_base_decimal}')::numeric) stored,
  gross_overdue_base numeric generated always as ((result#>>'{result,rows,0,gross_overdue_base_decimal}')::numeric) stored,
  disputed_overdue_base numeric generated always as ((result#>>'{result,rows,0,effective_disputed_overdue_base_decimal}')::numeric) stored,
  promised_overdue_base numeric generated always as ((result#>>'{result,rows,0,active_promised_overdue_base_decimal}')::numeric) stored,
  invoice_to_chase_overdue_base numeric generated always as ((result#>>'{result,rows,0,invoice_to_chase_overdue_base_decimal}')::numeric) stored,
  available_customer_credit_base numeric generated always as ((result#>>'{result,rows,0,available_customer_credit_base_decimal}')::numeric) stored,
  applied_customer_credit_base numeric generated always as ((result#>>'{result,rows,0,customer_credit_applied_base_decimal}')::numeric) stored,
  to_chase_overdue_base numeric generated always as ((result#>>'{result,rows,0,customer_to_chase_overdue_base_decimal}')::numeric) stored,
  weighted_overdue_age double precision generated always as ((result#>>'{result,rows,0,weighted_avg_overdue_days}')::double precision) stored,
  historical_normal_days_late double precision generated always as ((result#>>'{result,rows,0,historical_normal_days_late}')::double precision) stored,
  relative_lateness_days double precision generated always as ((result#>>'{result,rows,0,relative_lateness_days}')::double precision) stored,
  last_payment_date date generated always as (CASE WHEN result#>>'{result,rows,0,last_payment_date}' IS NULL THEN NULL ELSE make_date((substring(result#>>'{result,rows,0,last_payment_date}' from 1 for 4))::integer,(substring(result#>>'{result,rows,0,last_payment_date}' from 6 for 2))::integer,(substring(result#>>'{result,rows,0,last_payment_date}' from 9 for 2))::integer) END) stored,
  customer_credit_state text generated always as (result#>>'{result,rows,0,customer_credit_state}') stored,
  currency_health text generated always as (result#>>'{result,currencyHealth,status}') stored,
  verified_at timestamptz not null default clock_timestamp(),
  check(customer_credit_state in ('ready','unavailable','unsupported_currency')),
  check(currency_health in ('healthy','degraded','unavailable')),
  primary key(user_id,tenant_id,source_system,generation_id,customer_source_id,basis_version,feature_version),
  foreign key(user_id,tenant_id,source_system,generation_id,customer_source_id,basis_version)
    references public.collection_customer_bases on delete cascade
);
-- One feature slot per basis/version replaces superseded dates/revisions.
-- Prefixes of the primary keys support scope/G inventory and customer lookup.
alter table public.collection_customer_bases enable row level security;
alter table public.collection_basis_manifests enable row level security;
alter table public.collection_customer_features enable row level security;
revoke all on public.collection_customer_bases,public.collection_basis_manifests,public.collection_customer_features from public,anon,authenticated,service_role;
grant select on public.collection_customer_bases,public.collection_basis_manifests,public.collection_customer_features to service_role;

-- ECMAScript trim, including non-ASCII whitespace; identity matches the pure calculator.
create function collection_materialization_private.identity(p_value text) returns text
language sql immutable set search_path=pg_catalog as $$
  select btrim(coalesce(p_value,''),E' \t\n\r\f' || chr(11) || chr(160) || chr(5760) ||
    chr(8192)||chr(8193)||chr(8194)||chr(8195)||chr(8196)||chr(8197)||chr(8198)||chr(8199)||chr(8200)||chr(8201)||chr(8202)||
    chr(8232)||chr(8233)||chr(8239)||chr(8287)||chr(12288)||chr(65279))
$$;
-- Normalized customer aliases share a feature basis. Sum their monotonic source
-- revisions; clean provider IDs retain exactly rCustomer. Deletions are forbidden
-- to the service role in the underlying dependency table.
create index collection_customer_revision_normalized on public.collection_customer_financial_revisions
  (user_id,tenant_id,source_system,collection_materialization_private.identity(customer_source_id));
create function collection_materialization_private.certificate(p_user uuid,p_tenant text,p_g uuid) returns jsonb
language sql stable set search_path=pg_catalog as $$
  select jsonb_build_object('sync_run_id',v.sync_run_id,'user_id',v.user_id,'tenant_id',v.tenant_id,'source_system',v.source_system,
    'contract_version',v.contract_version,'invoice_money_contract_version',v.invoice_money_contract_version,
    'readiness_state',v.readiness_state,'reason_code',v.reason_code,'consistency_result',v.consistency_result,
    'resource_observations',jsonb_build_object('initial',v.resource_observations->'initial'))
  from public.xero_customer_credit_validations v where v.user_id=p_user and v.tenant_id=p_tenant and v.source_system='xero' and v.sync_run_id=p_g
$$;
create function collection_materialization_private.context(p_user uuid,p_tenant text) returns jsonb
language sql stable set search_path=pg_catalog as $$
  select public.read_collection_dependencies(p_user,p_tenant,'xero',null) || jsonb_build_object(
    'generationReady',coalesce((select s.active_sync_run_id is not null and s.last_successful_sync_at is not null from public.xero_sync_tenant_state s where s.user_id=p_user and s.tenant_id=p_tenant),false),
    'basisVersion','customer_basis_v1','featureVersion','customer_features_v1','certificate',c.value,'evidenceIdentity',encode(sha256(convert_to(coalesce(c.value::text,'absent'),'UTF8')),'hex'))
  from (select collection_materialization_private.certificate(p_user,p_tenant,
    (public.read_collection_dependencies(p_user,p_tenant,'xero',null)->>'generationId')::uuid) value) c
$$;

-- Set-based canonical extraction. All rows are bound to the requested succeeded G;
-- no REST pagination, per-customer requests, mutable operational state or raw provider JSON.
create function public.build_collection_customer_bases(p_user_id uuid,p_tenant_id text,p_generation_id uuid,
  p_customer_ids text[] default null) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare v_counts record; v_actual record; v_inserted integer;
begin
  if p_user_id is null or btrim(p_tenant_id)='' or p_generation_id is null
     or (p_customer_ids is not null and (cardinality(p_customer_ids)>100 or cardinality(p_customer_ids)=0)) then
    raise exception 'collection_basis_invalid_scope' using errcode='22023'; end if;
  if not exists(select 1 from public.xero_sync_runs where id=p_generation_id and user_id=p_user_id and tenant_id=p_tenant_id and status='succeeded') then
    raise exception 'collection_basis_generation_unavailable' using errcode='23503'; end if;
  -- Scoped canonical generations are immutable. Historical G is allowed, never relabelled.
  with
  c as materialized (select collection_materialization_private.identity(source_id) k,
    row_number() over(order by source_id) ord,
    jsonb_build_object('source_id',source_id,'name',name,'email',email,'is_customer',is_customer,'is_supplier',is_supplier,'status',status) j
    from public.canonical_customers where user_id=p_user_id and tenant_id=p_tenant_id and source_system='xero' and sync_run_id=p_generation_id),
  i as materialized (select collection_materialization_private.identity(customer_source_id) k,
    collection_materialization_private.identity(source_id) iid,type,status,row_number() over(order by source_id) ord,
    jsonb_build_object('user_id',user_id,'tenant_id',tenant_id,'source_system',source_system,'source_id',source_id,'customer_source_id',customer_source_id,'type',type,'status',status,'issue_date',issue_date,'due_date',due_date,'fully_paid_date',fully_paid_date,'transaction_currency_code',transaction_currency_code,'organisation_base_currency_code',organisation_base_currency_code,'xero_currency_rate',xero_currency_rate::text,'total_native',total_native::text,'amount_paid_native',amount_paid_native::text,'amount_due_native',amount_due_native::text,'amount_credited_native',amount_credited_native::text,'amount_due_base',amount_due_base::text,'currency_conversion_status',currency_conversion_status,'currency_conversion_failure_reason',currency_conversion_failure_reason) j
    from public.canonical_invoices where user_id=p_user_id and tenant_id=p_tenant_id and source_system='xero' and sync_run_id=p_generation_id),
  imap as (select distinct on(iid) iid,k from i where upper(collection_materialization_private.identity(type))='ACCREC' order by iid,ord desc),
  p as materialized (select coalesce(nullif(collection_materialization_private.identity(p.customer_source_id),''),
      imap.k,'') k,
    row_number() over(order by p.source_id) ord,
    jsonb_build_object('invoice_source_id',p.invoice_source_id,'customer_source_id',p.customer_source_id,'payment_date',p.payment_date) j
    from public.canonical_payments p left join imap on imap.iid=collection_materialization_private.identity(p.invoice_source_id) where p.user_id=p_user_id and p.tenant_id=p_tenant_id and p.source_system='xero' and p.sync_run_id=p_generation_id),
  cr as materialized (select collection_materialization_private.identity(customer_source_id) k,source_kind,source_id,
    jsonb_build_object('sync_run_id',sync_run_id,'user_id',user_id,'tenant_id',tenant_id,'source_system',source_system,'source_kind',source_kind,'source_id',source_id,'customer_source_id',customer_source_id,'provider_type',provider_type,'status',status,'residual_state',residual_state,'remaining_credit_native',remaining_credit_native::text,'currency_code',currency_code,'organisation_base_currency_code',organisation_base_currency_code,'xero_currency_rate',xero_currency_rate::text) j
    from public.canonical_customer_credit_evidence_exact where user_id=p_user_id and tenant_id=p_tenant_id and source_system='xero' and sync_run_id=p_generation_id),
  org as (select coalesce(jsonb_agg(jsonb_build_object('base_currency_code',base_currency_code,'source_timezone',source_timezone,'country_code',country_code)
      order by source_retrieved_at desc),'[]'::jsonb) j from public.canonical_organisations
      where user_id=p_user_id and tenant_id=p_tenant_id and source_system='xero' and sync_run_id=p_generation_id),
  cg as (select k,jsonb_agg(j order by ord) j,count(*) n,min(ord) ord from c group by k),
  ig as (select k,jsonb_agg(j order by ord) j,jsonb_agg(ord order by ord) ordinals,count(*) n,min(ord) filter(where upper(collection_materialization_private.identity(type))='ACCREC' and upper(collection_materialization_private.identity(status))='AUTHORISED') ord from i group by k),
  pg as (select k,jsonb_agg(j order by ord) j,count(*) n from p group by k),
  crg as (select k,jsonb_agg(j order by source_kind,source_id) j,count(*) n from cr group by k),
  counts as (select jsonb_build_object('overpayment',count(*) filter(where source_kind='overpayment'),
    'prepayment',count(*) filter(where source_kind='prepayment'),'credit_note',count(*) filter(where source_kind='credit_note')) j from cr),
  keys as (select k from c union select k from i union select k from p union select k from cr union select ''::text)
  insert into public.collection_customer_bases(user_id,tenant_id,source_system,generation_id,customer_source_id,basis_version,complete,
    customer_count,invoice_count,payment_count,credit_count,projection_order,payload)
  select p_user_id,p_tenant_id,'xero',p_generation_id,k.k,'customer_basis_v1',true,coalesce(cg.n,0),coalesce(ig.n,0),coalesce(pg.n,0),coalesce(crg.n,0),
    coalesce(ig.ord,1000000000000+cg.ord,2000000000000),
    jsonb_build_object('organisations',org.j,'customers',coalesce(cg.j,'[]'::jsonb),'invoices',coalesce(ig.j,'[]'::jsonb),
      'payments',coalesce(pg.j,'[]'::jsonb),'creditRows',coalesce(crg.j,'[]'::jsonb),'creditCounts',counts.j,'invoiceOrdinals',coalesce(ig.ordinals,'[]'::jsonb))
  from keys k cross join org cross join counts left join cg using(k) left join ig using(k) left join pg using(k) left join crg using(k)
  where p_customer_ids is null or k.k=any(p_customer_ids)
  on conflict do nothing;
  get diagnostics v_inserted=row_count;
  if p_customer_ids is null then
    select (select count(*) from public.canonical_customers where user_id=p_user_id and tenant_id=p_tenant_id and source_system='xero' and sync_run_id=p_generation_id) customers,
      (select count(*) from public.canonical_invoices where user_id=p_user_id and tenant_id=p_tenant_id and source_system='xero' and sync_run_id=p_generation_id) invoices,
      (select count(*) from public.canonical_payments where user_id=p_user_id and tenant_id=p_tenant_id and source_system='xero' and sync_run_id=p_generation_id) payments,
      (select count(*) from public.canonical_customer_credit_evidence_exact where user_id=p_user_id and tenant_id=p_tenant_id and source_system='xero' and sync_run_id=p_generation_id) credits into v_counts;
    select count(*) bases,coalesce(sum(customer_count),0) customers,coalesce(sum(invoice_count),0) invoices,
      coalesce(sum(payment_count),0) payments,coalesce(sum(credit_count),0) credits into v_actual from public.collection_customer_bases
      where user_id=p_user_id and tenant_id=p_tenant_id and source_system='xero' and generation_id=p_generation_id and basis_version='customer_basis_v1';
    if v_counts.customers<>v_actual.customers or v_counts.invoices<>v_actual.invoices or v_counts.payments<>v_actual.payments or v_counts.credits<>v_actual.credits then
      raise exception 'collection_basis_population_incomplete' using errcode='23514'; end if;
    insert into public.collection_basis_manifests values(p_user_id,p_tenant_id,'xero',p_generation_id,'customer_basis_v1',
      v_actual.bases,v_actual.customers,v_actual.invoices,v_actual.payments,v_actual.credits,true,clock_timestamp()) on conflict do nothing;
  end if;
  return jsonb_build_object('inserted',v_inserted,'generationId',p_generation_id,'basisVersion','customer_basis_v1');
end $$;

-- Warm probe touches dependency/certification and derivative tables only.
create function public.read_collection_customer_materialization(p_user_id uuid,p_tenant_id text,p_evaluation_date date,
  p_customer_ids text[] default null,p_after text default null,p_limit integer default 500) returns jsonb
language sql stable security definer set search_path=pg_catalog as $$
  with ctx as materialized (select collection_materialization_private.context(p_user_id,p_tenant_id) j),
  keys as (select unnest(p_customer_ids) k where p_customer_ids is not null
    union all select customer_source_id from public.collection_customer_bases b cross join ctx
      where p_customer_ids is null and b.user_id=p_user_id and b.tenant_id=p_tenant_id and b.source_system='xero'
        and b.generation_id=(ctx.j->>'generationId')::uuid and b.basis_version='customer_basis_v1'),
  page as materialized (select distinct k from keys where p_after is null or k>p_after order by k limit greatest(0,least(p_limit,500))),
  revisions as materialized (select collection_materialization_private.identity(customer_source_id) k,sum(financial_revision)::bigint financial_revision
    from public.collection_customer_financial_revisions where user_id=p_user_id and tenant_id=p_tenant_id and source_system='xero'
    group by collection_materialization_private.identity(customer_source_id))
  select jsonb_build_object('context',ctx.j,
    'integrityChecked',p_customer_ids is null and p_after is null and exists(select 1 from public.collection_basis_manifests m
      where m.user_id=p_user_id and m.tenant_id=p_tenant_id and m.source_system='xero' and m.generation_id=(ctx.j->>'generationId')::uuid),
    'invalidActivePromise',case when p_customer_ids is null and p_after is null and exists(select 1 from public.collection_basis_manifests m
      where m.user_id=p_user_id and m.tenant_id=p_tenant_id and m.source_system='xero' and m.generation_id=(ctx.j->>'generationId')::uuid) then
      exists(select 1 from public.invoice_promises p where p.user_id=p_user_id and p.tenant_id=p_tenant_id and p.source_system='xero' and p.status='active'
        and not exists(select 1 from public.collection_customer_bases b where b.user_id=p_user_id and b.tenant_id=p_tenant_id and b.source_system='xero'
          and b.generation_id=(ctx.j->>'generationId')::uuid and b.customer_source_id=collection_materialization_private.identity(p.customer_source_id)
          and b.basis_version='customer_basis_v1' and exists(select 1 from jsonb_array_elements(b.payload->'invoices') i where i->>'source_id'=p.invoice_source_id))) else false end,
    'manifest', (select to_jsonb(m) from public.collection_basis_manifests m
    where m.user_id=p_user_id and m.tenant_id=p_tenant_id and m.source_system='xero' and m.generation_id=(ctx.j->>'generationId')::uuid and m.basis_version='customer_basis_v1'),
    'items',coalesce((select jsonb_agg(jsonb_build_object('customerId',page.k,'revision',coalesce(r.financial_revision,0)::text,
      'basisComplete',coalesce(b.complete,false),'order',b.projection_order,'feature',case when f.complete
        and f.customer_financial_revision=coalesce(r.financial_revision,0) and f.evaluation_date=p_evaluation_date
        and f.evidence_identity=ctx.j->>'evidenceIdentity' then f.result else null end) order by page.k)
      from page
      -- Keep page keys as parameters of complete-PK probes. On freshly populated
      -- tables a generic plan otherwise estimates one tenant row and may form
      -- a 500 x customers x features loop before applying the page join.
      left join lateral (select complete,projection_order from public.collection_customer_bases
        where user_id=p_user_id and tenant_id=p_tenant_id and source_system='xero'
          and generation_id=(ctx.j->>'generationId')::uuid and customer_source_id=page.k and basis_version='customer_basis_v1'
        offset 0) b on true
      left join revisions r on r.k=page.k
      left join lateral (select complete,customer_financial_revision,evaluation_date,evidence_identity,result from public.collection_customer_features
        where user_id=p_user_id and tenant_id=p_tenant_id and source_system='xero'
          and generation_id=(ctx.j->>'generationId')::uuid and customer_source_id=page.k
          and basis_version='customer_basis_v1' and feature_version='customer_features_v1'
        offset 0) f on true),'[]'::jsonb)) from ctx
$$;

create function public.read_collection_customer_feature_inputs(p_user_id uuid,p_tenant_id text,p_generation_id uuid,p_customer_ids text[]) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog as $$
begin
  if cardinality(p_customer_ids)>100 or cardinality(p_customer_ids)=0 or p_customer_ids is null then raise exception 'collection_invalid_batch' using errcode='22023';end if;
  return (with b as materialized(select * from public.collection_customer_bases where user_id=p_user_id and tenant_id=p_tenant_id and source_system='xero'
      and generation_id=p_generation_id and customer_source_id=any(p_customer_ids) and basis_version='customer_basis_v1'),
    ids as (select j->>'source_id' id from b cross join lateral jsonb_array_elements(b.payload->'invoices') j),
    revisions as materialized(select collection_materialization_private.identity(customer_source_id) k,sum(financial_revision)::bigint financial_revision
      from public.collection_customer_financial_revisions where user_id=p_user_id and tenant_id=p_tenant_id and source_system='xero'
        and collection_materialization_private.identity(customer_source_id)=any(p_customer_ids) group by collection_materialization_private.identity(customer_source_id))
    select jsonb_build_object('context',collection_materialization_private.context(p_user_id,p_tenant_id),
      'bases',coalesce((select jsonb_agg(jsonb_build_object('customerId',b.customer_source_id,'order',b.projection_order,'payload',b.payload,
        'revision',coalesce(r.financial_revision,0)::text) order by b.customer_source_id) from b left join revisions r on r.k=b.customer_source_id),'[]'::jsonb),
      'disputes',coalesce((select jsonb_agg(to_jsonb(d) || jsonb_build_object('recorded_disputed_amount_native',d.recorded_disputed_amount_native::text,
        'amount_due_at_last_review_native',d.amount_due_at_last_review_native::text) order by d.invoice_source_id) from public.invoice_disputes d
        where d.user_id=p_user_id and d.tenant_id=p_tenant_id and d.source_system='xero' and d.invoice_source_id in(select id from ids)),'[]'::jsonb),
      'promises',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'user_id',p.user_id,'tenant_id',p.tenant_id,'source_system',p.source_system,
        'invoice_source_id',p.invoice_source_id,'customer_source_id',p.customer_source_id,'currency_code',p.currency_code,'status',p.status,
        'promised_amount_native',p.promised_amount_native::text,'qualifying_paid_amount_native',p.qualifying_paid_amount_native::text) order by p.invoice_source_id)
        from public.invoice_promises p where p.user_id=p_user_id and p.tenant_id=p_tenant_id and p.source_system='xero' and p.status='active'
        and (collection_materialization_private.identity(p.customer_source_id)=any(p_customer_ids) or p.invoice_source_id in(select id from ids))),'[]'::jsonb)));
end $$;

-- Build in JS, then publish only after the same state/advisory lock order used by
-- financial commands and promotion. No source-history reads or calculation inside this fence.
create function public.publish_collection_customer_features(p_user_id uuid,p_tenant_id text,p_generation_id uuid,
  p_evaluation_date date,p_evidence_identity text,p_results jsonb) returns boolean
language plpgsql security definer set search_path=pg_catalog as $$
declare v record; v_rev bigint; revisions jsonb;
begin
  if jsonb_typeof(p_results)<>'array' or jsonb_array_length(p_results)>100 or jsonb_array_length(p_results)=0
     or p_evaluation_date is null or not isfinite(p_evaluation_date) then raise exception 'collection_invalid_publication' using errcode='22023';end if;
  perform collection_dependency_private.lock_financial_scope(p_user_id,p_tenant_id,'xero');
  perform 1 from public.xero_customer_credit_validations where user_id=p_user_id and tenant_id=p_tenant_id and sync_run_id=p_generation_id for share;
  if (collection_materialization_private.context(p_user_id,p_tenant_id)->>'generationReady')::boolean is distinct from true
    or (collection_materialization_private.context(p_user_id,p_tenant_id)->>'generationStatus') is distinct from 'succeeded'
    or (collection_materialization_private.context(p_user_id,p_tenant_id)->>'generationId') is distinct from p_generation_id::text
    or (collection_materialization_private.context(p_user_id,p_tenant_id)->>'evidenceIdentity') is distinct from p_evidence_identity then return false;end if;
  select jsonb_object_agg(k,revision) into revisions from (select collection_materialization_private.identity(customer_source_id) k,sum(financial_revision)::bigint revision
    from public.collection_customer_financial_revisions where user_id=p_user_id and tenant_id=p_tenant_id and source_system='xero'
      and collection_materialization_private.identity(customer_source_id) in(select x->>'customerId' from jsonb_array_elements(p_results) x)
    group by collection_materialization_private.identity(customer_source_id)) grouped;
  for v in select * from jsonb_to_recordset(p_results) as x("customerId" text,revision text,result jsonb) order by "customerId" loop
    v_rev := coalesce((revisions->>v."customerId")::bigint,0);
    if v_rev is distinct from v.revision::bigint or v.result is null or jsonb_typeof(v.result->'result'->'rows') is distinct from 'array'
      or jsonb_array_length(v.result->'result'->'rows')>1
      or jsonb_typeof(v.result->'result'->'reviewRequiredCustomers') is distinct from 'array'
      or jsonb_typeof(v.result->'result'->'currencyHealth') is distinct from 'object'
      or jsonb_typeof(v.result->'issueOrdinals') is distinct from 'array'
      or not ((v.result->'result') ?& array['rows','reviewRequiredCustomers','organisationBaseCurrency','organisationTimezone','currencyHealth','currencyEvaluation','currencyContext','sourceCounts'])
      or jsonb_array_length(v.result->'issueOrdinals') is distinct from jsonb_array_length(v.result->'result'->'currencyEvaluation'->'currencyIssues')
      or exists(select 1 from jsonb_array_elements(v.result->'result'->'rows') j where j->>'customer_source_id' is distinct from v."customerId" or not (j ?& array['customer_source_id','customer_name','customer_email','is_customer','is_supplier','status','total_invoices_count','open_invoices_count','overdue_invoices_count','total_outstanding_base_decimal','overdue_outstanding_base_decimal','total_outstanding_base','overdue_outstanding_base','gross_outstanding_base_decimal','gross_overdue_base_decimal','effective_disputed_outstanding_base_decimal','effective_disputed_overdue_base_decimal','collectible_outstanding_base_decimal','collectible_overdue_base_decimal','collectible_outstanding_base','collectible_overdue_base','actionable_open_invoices_count','actionable_overdue_invoices_count','has_active_dispute','has_active_promise','active_promised_outstanding_base_decimal','active_promised_overdue_base_decimal','to_chase_outstanding_base_decimal','to_chase_overdue_base_decimal','to_chase_outstanding_base','to_chase_overdue_base','invoice_to_chase_overdue_base_decimal','invoice_to_chase_overdue_base','customer_credit_state','available_customer_credit_base_decimal','available_customer_credit_base','customer_credit_applied_base_decimal','customer_credit_applied_base','customer_to_chase_overdue_base_decimal','customer_to_chase_overdue_base','excess_available_customer_credit_base_decimal','excess_available_customer_credit_base','total_outstanding','overdue_outstanding','oldest_overdue_invoice_date','oldest_overdue_days','weighted_avg_overdue_days','historical_paid_invoice_count','historical_mean_days_late','historical_normal_days_late','relative_lateness_days','latest_invoice_date','latest_due_date','last_payment_date','last_payment_days_ago','has_recent_partial_payment','organisation_base_currency_code','currency_code','native_currency_breakdown','collectible_native_currency_breakdown']))
      or exists(select 1 from public.collection_customer_bases b where b.user_id=p_user_id and b.tenant_id=p_tenant_id and b.source_system='xero'
        and b.generation_id=p_generation_id and b.customer_source_id=v."customerId" and (
          (v.result->'result'->'sourceCounts'->>'customers')::integer is distinct from b.customer_count or
          (v.result->'result'->'sourceCounts'->>'invoices')::integer is distinct from b.invoice_count or
          (v.result->'result'->'sourceCounts'->>'payments')::integer is distinct from b.payment_count))
      or exists(select 1 from public.collection_customer_features where user_id=p_user_id and tenant_id=p_tenant_id and source_system='xero'
        and generation_id=p_generation_id and customer_source_id=v."customerId" and evaluation_date>p_evaluation_date) then return false;end if;
    if not exists(select 1 from public.collection_customer_bases where user_id=p_user_id and tenant_id=p_tenant_id and source_system='xero'
      and generation_id=p_generation_id and customer_source_id=v."customerId" and complete) then return false;end if;
  end loop;
  insert into public.collection_customer_features(user_id,tenant_id,source_system,generation_id,customer_source_id,basis_version,feature_version,
    customer_financial_revision,evaluation_date,evidence_identity,complete,result)
    select p_user_id,p_tenant_id,'xero',p_generation_id,x."customerId",'customer_basis_v1','customer_features_v1',x.revision::bigint,
      p_evaluation_date,p_evidence_identity,true,x.result from jsonb_to_recordset(p_results) as x("customerId" text,revision text,result jsonb)
  on conflict(user_id,tenant_id,source_system,generation_id,customer_source_id,basis_version,feature_version) do update
    set customer_financial_revision=excluded.customer_financial_revision,evaluation_date=excluded.evaluation_date,
      evidence_identity=excluded.evidence_identity,result=excluded.result,verified_at=clock_timestamp();
  return true;
end $$;

-- Explicit bounded maintenance only. Never delete active G, or authoritative rows.
-- Previous successful G retained for diagnostics; FK removes its disposable features.
create function public.prune_collection_customer_materialization(p_user_id uuid,p_tenant_id text,p_limit integer default 500) returns integer
language plpgsql security definer set search_path=pg_catalog as $$
declare n integer; removed uuid[];
begin
  perform collection_dependency_private.lock_financial_scope(p_user_id,p_tenant_id,'xero');
  with keep as(select id from public.xero_sync_runs where user_id=p_user_id and tenant_id=p_tenant_id and status='succeeded' order by completed_at desc,id desc limit 2),
    doomed as(select b.ctid from public.collection_customer_bases b where b.user_id=p_user_id and b.tenant_id=p_tenant_id and b.source_system='xero'
      and b.generation_id not in(select id from keep) and b.generation_id is distinct from
        (select active_sync_run_id from public.xero_sync_tenant_state where user_id=p_user_id and tenant_id=p_tenant_id)
      order by b.generation_id,b.customer_source_id limit greatest(0,least(p_limit,500))),
    deleted as (delete from public.collection_customer_bases where ctid in(select ctid from doomed) returning generation_id)
    select count(*),array_agg(distinct generation_id) into n,removed from deleted;
  delete from public.collection_basis_manifests m where m.user_id=p_user_id and m.tenant_id=p_tenant_id and (m.generation_id=any(removed) or not exists(select 1 from public.collection_customer_bases b
    where b.user_id=m.user_id and b.tenant_id=m.tenant_id and b.source_system=m.source_system and b.generation_id=m.generation_id));
  return n;
end $$;

revoke all on all functions in schema collection_materialization_private from public,anon,authenticated,service_role;

revoke all on function public.build_collection_customer_bases(uuid,text,uuid,text[]) from public,anon,authenticated;
grant execute on function public.build_collection_customer_bases(uuid,text,uuid,text[]) to service_role;

revoke all on function public.read_collection_customer_materialization(uuid,text,date,text[],text,integer) from public,anon,authenticated;
grant execute on function public.read_collection_customer_materialization(uuid,text,date,text[],text,integer) to service_role;

revoke all on function public.read_collection_customer_feature_inputs(uuid,text,uuid,text[]) from public,anon,authenticated;
grant execute on function public.read_collection_customer_feature_inputs(uuid,text,uuid,text[]) to service_role;

revoke all on function public.publish_collection_customer_features(uuid,text,uuid,date,text,jsonb) from public,anon,authenticated;
grant execute on function public.publish_collection_customer_features(uuid,text,uuid,date,text,jsonb) to service_role;

revoke all on function public.prune_collection_customer_materialization(uuid,text,integer) from public,anon,authenticated;
grant execute on function public.prune_collection_customer_materialization(uuid,text,integer) to service_role;
