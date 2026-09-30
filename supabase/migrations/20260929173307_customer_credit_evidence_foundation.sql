-- Customer-credit evidence foundation. This migration does not certify or deduct credit.
create table public.canonical_credit_note_evidence (
  sync_run_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  tenant_id text not null check (btrim(tenant_id) <> ''),
  source_system text not null default 'xero' check (source_system = 'xero'),
  source_id text not null check (btrim(source_id) <> ''),
  customer_source_id text not null check (btrim(customer_source_id) <> ''),
  provider_type text not null check (provider_type = 'ACCRECCREDIT'),
  status text not null check (btrim(status) <> '' and length(status) <= 32),
  residual_state text not null check (residual_state in ('qualifying','zero','excluded','invalid')),
  remaining_credit_native numeric check (remaining_credit_native >= 0 and remaining_credit_native < 'Infinity'::numeric),
  currency_code text not null check (currency_code ~ '^[A-Z]{3}$'),
  organisation_base_currency_code text not null check (organisation_base_currency_code ~ '^[A-Z]{3}$'),
  xero_currency_rate numeric check (xero_currency_rate > 0 and xero_currency_rate < 'Infinity'::numeric),
  source_updated_at timestamptz check (source_updated_at is null or isfinite(source_updated_at)),
  primary key (sync_run_id,user_id,tenant_id,source_system,source_id),
  foreign key (sync_run_id,user_id,tenant_id) references public.xero_sync_runs(id,user_id,tenant_id) on delete cascade,
  check (residual_state <> 'qualifying' or (status = 'AUTHORISED' and remaining_credit_native > 0)),
  check (residual_state <> 'zero' or (status in ('AUTHORISED','PAID') and remaining_credit_native = 0)),
  check (residual_state <> 'excluded' or status in ('DRAFT','SUBMITTED','VOIDED','DELETED')),
  check (not (status = 'PAID' and remaining_credit_native > 0) or residual_state = 'invalid')
);
create index canonical_credit_note_evidence_customer on public.canonical_credit_note_evidence(user_id,tenant_id,sync_run_id,customer_source_id);

-- The only Phase 1 writer fixes readiness to unavailable. Later consistency code
-- may add a fenced certification writer without changing Promise evidence.
create table public.xero_customer_credit_validations (
  sync_run_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  tenant_id text not null check (btrim(tenant_id) <> ''),
  source_system text not null default 'xero' check (source_system = 'xero'),
  contract_version text not null default 'customer_credit_v1' check (contract_version = 'customer_credit_v1'),
  invoice_money_contract_version text not null default 'invoice_exact_v1' check (invoice_money_contract_version = 'invoice_exact_v1'),
  readiness_state text not null default 'unavailable' check (readiness_state in ('unavailable','ready')),
  reason_code text not null check (btrim(reason_code) <> ''),
  credit_notes_started_at timestamptz not null check (isfinite(credit_notes_started_at)),
  credit_notes_completed_at timestamptz,
  credit_notes_page_requests bigint not null check (credit_notes_page_requests >= 0),
  credit_notes_populated_pages bigint not null check (credit_notes_populated_pages >= 0),
  credit_notes_source_count bigint not null check (credit_notes_source_count >= 0),
  credit_notes_mapped_count bigint not null check (credit_notes_mapped_count >= 0),
  credit_notes_invalid_count bigint not null check (credit_notes_invalid_count >= 0),
  credit_notes_complete boolean not null,
  consistency_result text,
  resource_observations jsonb not null default '{}'::jsonb check (jsonb_typeof(resource_observations) = 'object'),
  created_at timestamptz not null default now(),
  primary key (sync_run_id,user_id,tenant_id,source_system),
  foreign key (sync_run_id,user_id,tenant_id) references public.xero_sync_runs(id,user_id,tenant_id) on delete cascade,
  check (credit_notes_completed_at is null or (isfinite(credit_notes_completed_at) and credit_notes_completed_at >= credit_notes_started_at)),
  check (not credit_notes_complete or (credit_notes_completed_at is not null and credit_notes_page_requests > credit_notes_populated_pages
    and credit_notes_source_count = credit_notes_mapped_count))
);

alter table public.canonical_credit_note_evidence enable row level security;
alter table public.xero_customer_credit_validations enable row level security;
revoke all on public.canonical_credit_note_evidence, public.xero_customer_credit_validations from public,anon,authenticated,service_role;
grant select on public.canonical_credit_note_evidence, public.xero_customer_credit_validations to service_role;

create view public.canonical_customer_credit_evidence_exact with (security_invoker = true) as
  select sync_run_id,user_id,tenant_id,source_system,source_kind,source_id,customer_source_id,provider_type,status,
    case when status = 'AUTHORISED' and remaining_credit_native::numeric > 0 then 'qualifying'
      when status in ('AUTHORISED','PAID') and remaining_credit_native::numeric = 0 then 'zero'
      when status in ('VOIDED','DELETED') then 'excluded' else 'invalid' end as residual_state,
    remaining_credit_native,currency_code,organisation_base_currency_code,xero_currency_rate,source_updated_at
    from public.canonical_unapplied_cash_evidence_exact
  union all
  select sync_run_id,user_id,tenant_id,source_system,'credit_note'::text as source_kind,source_id,customer_source_id,provider_type,status,
    residual_state,remaining_credit_native::text,currency_code,organisation_base_currency_code,xero_currency_rate::text,source_updated_at
    from public.canonical_credit_note_evidence;
revoke all on public.canonical_customer_credit_evidence_exact from public,anon,authenticated,service_role;
grant select on public.canonical_customer_credit_evidence_exact to service_role;

create function public.persist_xero_credit_note_evidence(
  p_sync_run_id uuid,p_user_id uuid,p_tenant_id text,p_lease_owner uuid,p_fencing_token bigint,
  p_observation jsonb,p_rows jsonb
) returns void language plpgsql security definer set search_path = pg_catalog as $$
declare
  v_count bigint;
  v_invalid_count bigint;
  v_complete boolean := (p_observation->>'complete')::boolean;
begin
  perform public.assert_xero_generation_write_authority(p_sync_run_id,p_user_id,p_tenant_id,p_lease_owner,p_fencing_token);
  if p_observation->>'resource' is distinct from 'creditnotes' or jsonb_typeof(p_rows) is distinct from 'array'
    or jsonb_array_length(p_rows) > 500 or v_complete is null then
    raise exception 'Invalid credit-note evidence batch';
  end if;
  if exists (
    select 1 from jsonb_populate_recordset(null::public.canonical_credit_note_evidence,p_rows) c
    where not exists (select 1 from public.canonical_customers customer
      where customer.sync_run_id = p_sync_run_id and customer.user_id = p_user_id and customer.tenant_id = p_tenant_id
        and customer.source_system = 'xero' and customer.source_id = c.customer_source_id)
      or not exists (select 1 from public.canonical_organisations org
        where org.sync_run_id = p_sync_run_id and org.user_id = p_user_id and org.tenant_id = p_tenant_id
          and org.source_system = 'xero' and org.base_currency_code = c.organisation_base_currency_code)
  ) then raise exception 'Credit-note evidence relationship invalid'; end if;
  insert into public.canonical_credit_note_evidence(sync_run_id,user_id,tenant_id,source_system,source_id,customer_source_id,
    provider_type,status,residual_state,remaining_credit_native,currency_code,organisation_base_currency_code,xero_currency_rate,source_updated_at)
    select p_sync_run_id,p_user_id,p_tenant_id,'xero',c.source_id,c.customer_source_id,c.provider_type,c.status,c.residual_state,
      c.remaining_credit_native,c.currency_code,c.organisation_base_currency_code,c.xero_currency_rate,c.source_updated_at
      from jsonb_populate_recordset(null::public.canonical_credit_note_evidence,p_rows) c
    on conflict (sync_run_id,user_id,tenant_id,source_system,source_id) do nothing;
  if exists (
    select 1 from jsonb_populate_recordset(null::public.canonical_credit_note_evidence,p_rows) incoming
    join public.canonical_credit_note_evidence stored on stored.sync_run_id = p_sync_run_id and stored.user_id = p_user_id
      and stored.tenant_id = p_tenant_id and stored.source_system = 'xero' and stored.source_id = incoming.source_id
    where (stored.customer_source_id,stored.provider_type,stored.status,stored.residual_state,stored.remaining_credit_native,
      stored.currency_code,stored.organisation_base_currency_code,stored.xero_currency_rate,stored.source_updated_at)
      is distinct from (incoming.customer_source_id,incoming.provider_type,incoming.status,incoming.residual_state,
        incoming.remaining_credit_native,incoming.currency_code,incoming.organisation_base_currency_code,
        incoming.xero_currency_rate,incoming.source_updated_at)
  ) then raise exception 'Conflicting credit-note evidence replay'; end if;
  select count(*),count(*) filter (where residual_state = 'invalid') into v_count,v_invalid_count
    from public.canonical_credit_note_evidence
    where sync_run_id = p_sync_run_id and user_id = p_user_id and tenant_id = p_tenant_id and source_system = 'xero';
  if exists (select 1 from public.xero_customer_credit_validations prior
    where prior.sync_run_id = p_sync_run_id and prior.user_id = p_user_id and prior.tenant_id = p_tenant_id
      and prior.source_system = 'xero' and prior.credit_notes_complete
      and (prior.credit_notes_source_count is distinct from (p_observation->>'source_count')::bigint
        or prior.credit_notes_mapped_count is distinct from v_count)) then
    raise exception 'Conflicting completed credit-note traversal replay';
  end if;
  insert into public.xero_customer_credit_validations(sync_run_id,user_id,tenant_id,readiness_state,reason_code,
    credit_notes_started_at,credit_notes_completed_at,credit_notes_page_requests,credit_notes_populated_pages,
    credit_notes_source_count,credit_notes_mapped_count,credit_notes_invalid_count,credit_notes_complete)
    values (p_sync_run_id,p_user_id,p_tenant_id,'unavailable','consistency_not_validated',
      (p_observation->>'started_at')::timestamptz,(p_observation->>'completed_at')::timestamptz,
      (p_observation->>'page_requests')::bigint,(p_observation->>'populated_pages')::bigint,
      (p_observation->>'source_count')::bigint,v_count,v_invalid_count,v_complete)
    on conflict (sync_run_id,user_id,tenant_id,source_system) do update set
      readiness_state = 'unavailable',reason_code = 'consistency_not_validated',
      credit_notes_started_at = least(public.xero_customer_credit_validations.credit_notes_started_at,excluded.credit_notes_started_at),
      credit_notes_completed_at = excluded.credit_notes_completed_at,
      credit_notes_page_requests = excluded.credit_notes_page_requests,
      credit_notes_populated_pages = excluded.credit_notes_populated_pages,
      credit_notes_source_count = excluded.credit_notes_source_count,
      credit_notes_mapped_count = excluded.credit_notes_mapped_count,
      credit_notes_invalid_count = excluded.credit_notes_invalid_count,
      credit_notes_complete = public.xero_customer_credit_validations.credit_notes_complete or excluded.credit_notes_complete;
end $$;
revoke all on function public.persist_xero_credit_note_evidence(uuid,uuid,text,uuid,bigint,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.persist_xero_credit_note_evidence(uuid,uuid,text,uuid,bigint,jsonb,jsonb) to service_role;
