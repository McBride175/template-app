-- Phase 3A evidence supply only. Collections readiness/promotion remain unchanged.
alter table public.canonical_organisations add column timezone_iana text;

create table public.canonical_payment_evidence (
  sync_run_id uuid not null, user_id uuid not null references auth.users(id) on delete cascade,
  tenant_id text not null check (btrim(tenant_id) <> ''), source_system text not null default 'xero' check (source_system = 'xero'),
  source_id text not null check (btrim(source_id) <> ''), invoice_source_id text, customer_source_id text,
  amount_native numeric not null check (amount_native >= 0 and amount_native < 'Infinity'::numeric),
  currency_code text check (currency_code ~ '^[A-Z]{3}$'), payment_date date not null check (isfinite(payment_date)),
  payment_type text not null check (btrim(payment_type) <> ''), payment_status text not null check (payment_status in ('AUTHORISED','DELETED')),
  source_updated_at timestamptz check(source_updated_at is null or isfinite(source_updated_at)),
  primary key(sync_run_id,user_id,tenant_id,source_system,source_id),
  foreign key(sync_run_id,user_id,tenant_id) references public.xero_sync_runs(id,user_id,tenant_id) on delete cascade,
  check (payment_type <> 'ACCRECPAYMENT' or (nullif(btrim(invoice_source_id),'') is not null and nullif(btrim(customer_source_id),'') is not null and currency_code is not null))
);
create index canonical_payment_evidence_invoice on public.canonical_payment_evidence(user_id,tenant_id,sync_run_id,invoice_source_id);

create table public.canonical_unapplied_cash_evidence (
  sync_run_id uuid not null, user_id uuid not null references auth.users(id) on delete cascade,
  tenant_id text not null check (btrim(tenant_id) <> ''), source_system text not null default 'xero' check(source_system = 'xero'),
  source_kind text not null check(source_kind in ('overpayment','prepayment')), source_id text not null check(btrim(source_id) <> ''),
  customer_source_id text not null check(btrim(customer_source_id) <> ''), provider_type text not null,
  remaining_credit_native numeric not null check(remaining_credit_native >= 0 and remaining_credit_native < 'Infinity'::numeric),
  currency_code text not null check(currency_code ~ '^[A-Z]{3}$'), accounting_date date not null check(isfinite(accounting_date)),
  status text not null check(status in ('AUTHORISED','PAID','VOIDED','DELETED')), source_updated_at timestamptz check(source_updated_at is null or isfinite(source_updated_at)),
  organisation_base_currency_code text check(organisation_base_currency_code ~ '^[A-Z]{3}$'),
  xero_currency_rate numeric check(xero_currency_rate > 0 and xero_currency_rate < 'Infinity'::numeric),
  remaining_credit_base numeric check(remaining_credit_base >= 0 and remaining_credit_base < 'Infinity'::numeric),
  currency_conversion_status text not null check(currency_conversion_status in ('identity','converted','incomplete')),
  currency_conversion_failure_reason text,
  primary key(sync_run_id,user_id,tenant_id,source_system,source_kind,source_id),
  foreign key(sync_run_id,user_id,tenant_id) references public.xero_sync_runs(id,user_id,tenant_id) on delete cascade,
  check(provider_type = 'RECEIVE-' || upper(source_kind)),
  check(((currency_conversion_status = 'incomplete' and remaining_credit_base is null and currency_conversion_failure_reason is not null)
    or (currency_conversion_status = 'identity' and currency_code = organisation_base_currency_code and remaining_credit_base = remaining_credit_native and currency_conversion_failure_reason is null)
    or (currency_conversion_status = 'converted' and currency_code <> organisation_base_currency_code and xero_currency_rate is not null
      and remaining_credit_base = round(remaining_credit_native / xero_currency_rate,8) and currency_conversion_failure_reason is null)) is true)
);
create index canonical_unapplied_cash_evidence_customer on public.canonical_unapplied_cash_evidence(user_id,tenant_id,sync_run_id,customer_source_id);

create table public.xero_accounting_evidence_observations (
  sync_run_id uuid not null, user_id uuid not null references auth.users(id) on delete cascade,
  tenant_id text not null, source_system text not null default 'xero' check(source_system = 'xero'),
  resource text not null check(resource in ('payments','overpayments','prepayments')),
  contract_version text not null default 'promise_accounting_evidence_v1' check(contract_version = 'promise_accounting_evidence_v1'),
  started_at timestamptz not null check(isfinite(started_at)), completed_at timestamptz,
  page_requests bigint not null check(page_requests >= 0), populated_pages bigint not null check(populated_pages >= 0),
  source_count bigint not null check(source_count >= 0), mapped_count bigint not null check(mapped_count >= 0),
  complete boolean not null,
  primary key(sync_run_id,user_id,tenant_id,source_system,resource),
  foreign key(sync_run_id,user_id,tenant_id) references public.xero_sync_runs(id,user_id,tenant_id) on delete cascade,
  check(completed_at is null or (isfinite(completed_at) and completed_at >= started_at)),
  check(not complete or (completed_at is not null and page_requests >= 1 and page_requests > populated_pages and source_count = mapped_count))
);

alter table public.canonical_payment_evidence enable row level security;
alter table public.canonical_unapplied_cash_evidence enable row level security;
alter table public.xero_accounting_evidence_observations enable row level security;
revoke all on public.canonical_payment_evidence, public.canonical_unapplied_cash_evidence, public.xero_accounting_evidence_observations from public,anon,authenticated,service_role;
grant select on public.canonical_payment_evidence, public.canonical_unapplied_cash_evidence, public.xero_accounting_evidence_observations to service_role;

create function public.persist_xero_accounting_evidence(
  p_sync_run_id uuid,p_user_id uuid,p_tenant_id text,p_lease_owner uuid,p_fencing_token bigint,
  p_observation jsonb,p_rows jsonb,p_timezone_iana text
) returns void language plpgsql security definer set search_path = pg_catalog as $$
declare v_resource text := p_observation->>'resource'; v_count bigint; v_complete boolean := (p_observation->>'complete')::boolean;
begin
  perform public.assert_xero_generation_write_authority(p_sync_run_id,p_user_id,p_tenant_id,p_lease_owner,p_fencing_token);
  if v_resource is null or v_resource not in ('payments','overpayments','prepayments') or jsonb_typeof(p_rows) is distinct from 'array'
    or jsonb_array_length(p_rows) > 500 or v_complete is null then raise exception 'Invalid accounting evidence batch'; end if;
  if p_timezone_iana is not null and not exists(select 1 from pg_catalog.pg_timezone_names where name = p_timezone_iana) then
    raise exception 'Invalid organisation timezone';
  end if;
  update public.canonical_organisations set timezone_iana = p_timezone_iana
    where sync_run_id = p_sync_run_id and user_id = p_user_id and tenant_id = p_tenant_id and source_system = 'xero';
  if v_resource = 'payments' then
    if exists(select 1 from jsonb_populate_recordset(null::public.canonical_payment_evidence,p_rows) p
      where p.payment_type = 'ACCRECPAYMENT' and not exists(select 1 from public.canonical_invoices i
        where i.sync_run_id = p_sync_run_id and i.user_id = p_user_id and i.tenant_id = p_tenant_id and i.source_system = 'xero'
          and i.source_id = p.invoice_source_id and i.customer_source_id = p.customer_source_id and i.type = 'ACCREC'
          and i.transaction_currency_code = p.currency_code)) then raise exception 'Payment evidence invoice relationship invalid'; end if;
    insert into public.canonical_payment_evidence(sync_run_id,user_id,tenant_id,source_system,source_id,invoice_source_id,customer_source_id,
      amount_native,currency_code,payment_date,payment_type,payment_status,source_updated_at)
    select p_sync_run_id,p_user_id,p_tenant_id,'xero',p.source_id,p.invoice_source_id,p.customer_source_id,p.amount_native,p.currency_code,
      p.payment_date,p.payment_type,p.payment_status,p.source_updated_at
      from jsonb_populate_recordset(null::public.canonical_payment_evidence,p_rows) p
    on conflict(sync_run_id,user_id,tenant_id,source_system,source_id) do update set
      invoice_source_id = excluded.invoice_source_id, customer_source_id = excluded.customer_source_id, amount_native = excluded.amount_native,
      currency_code = excluded.currency_code,payment_date = excluded.payment_date,payment_type = excluded.payment_type,
      payment_status = excluded.payment_status,source_updated_at = excluded.source_updated_at;
    select count(*) into v_count from public.canonical_payment_evidence where sync_run_id = p_sync_run_id and user_id = p_user_id and tenant_id = p_tenant_id;
  else
    if exists(select 1 from jsonb_populate_recordset(null::public.canonical_unapplied_cash_evidence,p_rows) c
      where c.source_kind <> case when v_resource = 'overpayments' then 'overpayment' else 'prepayment' end
        or not exists(select 1 from public.canonical_customers customer where customer.sync_run_id = p_sync_run_id
          and customer.user_id = p_user_id and customer.tenant_id = p_tenant_id and customer.source_system = 'xero' and customer.source_id = c.customer_source_id)
        or not exists(select 1 from public.canonical_organisations org where org.sync_run_id = p_sync_run_id and org.user_id = p_user_id
          and org.tenant_id = p_tenant_id and org.source_system = 'xero' and org.base_currency_code = c.organisation_base_currency_code)) then
      raise exception 'Cash evidence relationship invalid'; end if;
    insert into public.canonical_unapplied_cash_evidence(sync_run_id,user_id,tenant_id,source_system,source_kind,source_id,customer_source_id,provider_type,
      remaining_credit_native,currency_code,accounting_date,status,source_updated_at,organisation_base_currency_code,xero_currency_rate,
      remaining_credit_base,currency_conversion_status,currency_conversion_failure_reason)
    select p_sync_run_id,p_user_id,p_tenant_id,'xero',c.source_kind,c.source_id,c.customer_source_id,c.provider_type,c.remaining_credit_native,
      c.currency_code,c.accounting_date,c.status,c.source_updated_at,c.organisation_base_currency_code,c.xero_currency_rate,
      c.remaining_credit_base,c.currency_conversion_status,c.currency_conversion_failure_reason
      from jsonb_populate_recordset(null::public.canonical_unapplied_cash_evidence,p_rows) c
    on conflict(sync_run_id,user_id,tenant_id,source_system,source_kind,source_id) do update set
      customer_source_id = excluded.customer_source_id,provider_type = excluded.provider_type,remaining_credit_native = excluded.remaining_credit_native,
      currency_code = excluded.currency_code,accounting_date = excluded.accounting_date,status = excluded.status,source_updated_at = excluded.source_updated_at,
      organisation_base_currency_code = excluded.organisation_base_currency_code,xero_currency_rate = excluded.xero_currency_rate,
      remaining_credit_base = excluded.remaining_credit_base,currency_conversion_status = excluded.currency_conversion_status,
      currency_conversion_failure_reason = excluded.currency_conversion_failure_reason;
    select count(*) into v_count from public.canonical_unapplied_cash_evidence where sync_run_id = p_sync_run_id and user_id = p_user_id and tenant_id = p_tenant_id
      and source_kind = case when v_resource = 'overpayments' then 'overpayment' else 'prepayment' end;
  end if;
  insert into public.xero_accounting_evidence_observations(sync_run_id,user_id,tenant_id,resource,started_at,completed_at,page_requests,populated_pages,source_count,mapped_count,complete)
    values(p_sync_run_id,p_user_id,p_tenant_id,v_resource,(p_observation->>'started_at')::timestamptz,(p_observation->>'completed_at')::timestamptz,
      (p_observation->>'page_requests')::bigint,(p_observation->>'populated_pages')::bigint,(p_observation->>'source_count')::bigint,v_count,v_complete)
    on conflict(sync_run_id,user_id,tenant_id,source_system,resource) do update set
      started_at = least(public.xero_accounting_evidence_observations.started_at,excluded.started_at), completed_at = excluded.completed_at,
      page_requests = excluded.page_requests,populated_pages = excluded.populated_pages,source_count = excluded.source_count,mapped_count = excluded.mapped_count,complete = excluded.complete;
end $$;

create function public.inspect_xero_accounting_evidence(p_sync_run_id uuid,p_user_id uuid,p_tenant_id text)
returns jsonb language sql stable security definer set search_path = pg_catalog as $$
  select jsonb_build_object('contract_version','promise_accounting_evidence_v1',
    'ready',coalesce((select count(*) = 3 and bool_and(o.complete and o.source_count = o.mapped_count)
      from public.xero_accounting_evidence_observations o where o.sync_run_id = p_sync_run_id and o.user_id = p_user_id and o.tenant_id = p_tenant_id),false)
      and exists(select 1 from public.xero_sync_runs r join public.xero_sync_tenant_state t on t.active_sync_run_id = r.id and t.user_id = r.user_id and t.tenant_id = r.tenant_id
        join public.canonical_organisations org on org.sync_run_id = r.id and org.user_id = r.user_id and org.tenant_id = r.tenant_id
        where r.id = p_sync_run_id and r.user_id = p_user_id and r.tenant_id = p_tenant_id and r.status = 'succeeded' and org.timezone_iana is not null),
    'resources',coalesce((select jsonb_agg(to_jsonb(o) - 'user_id' - 'tenant_id' - 'sync_run_id' order by o.resource)
      from public.xero_accounting_evidence_observations o where o.sync_run_id = p_sync_run_id and o.user_id = p_user_id and o.tenant_id = p_tenant_id),'[]'::jsonb),
    'timezone_iana',(select org.timezone_iana from public.canonical_organisations org where org.sync_run_id = p_sync_run_id and org.user_id = p_user_id and org.tenant_id = p_tenant_id));
$$;

-- Numeric columns are projected as decimal text at the JSON/Data API read boundary.
create view public.canonical_payment_evidence_exact with (security_invoker = true) as
  select sync_run_id,user_id,tenant_id,source_system,source_id,invoice_source_id,customer_source_id,amount_native::text as amount_native,
    currency_code,payment_date,payment_type,payment_status,source_updated_at from public.canonical_payment_evidence;
create view public.canonical_unapplied_cash_evidence_exact with (security_invoker = true) as
  select sync_run_id,user_id,tenant_id,source_system,source_kind,source_id,customer_source_id,provider_type,remaining_credit_native::text as remaining_credit_native,
    currency_code,accounting_date,status,source_updated_at,organisation_base_currency_code,xero_currency_rate::text as xero_currency_rate,
    remaining_credit_base::text as remaining_credit_base,currency_conversion_status,currency_conversion_failure_reason from public.canonical_unapplied_cash_evidence;
revoke all on public.canonical_payment_evidence_exact, public.canonical_unapplied_cash_evidence_exact from public,anon,authenticated,service_role;
grant select on public.canonical_payment_evidence_exact, public.canonical_unapplied_cash_evidence_exact to service_role;
revoke all on function public.persist_xero_accounting_evidence(uuid,uuid,text,uuid,bigint,jsonb,jsonb,text),
  public.inspect_xero_accounting_evidence(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.persist_xero_accounting_evidence(uuid,uuid,text,uuid,bigint,jsonb,jsonb,text),
  public.inspect_xero_accounting_evidence(uuid,uuid,text) to service_role;
