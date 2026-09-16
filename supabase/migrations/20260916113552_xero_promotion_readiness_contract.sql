-- Phase 5B checkpoint 6: versioned promotion-readiness evidence plus a
-- narrowly scoped same-run lease reacquisition contract.
--
-- Historical xero_sync_run_steps.validation rows remain immutable evidence of
-- the validation contract that existed when they were written. They do not
-- satisfy collections_readiness_v2 and are never rewritten by this migration.

create table public.xero_sync_run_validations (
  id uuid primary key default gen_random_uuid(),
  sync_run_id uuid not null,
  user_id uuid not null,
  tenant_id text not null,
  contract_version text not null,
  fencing_token bigint not null,
  lease_owner uuid not null,
  validated_at timestamptz not null default now(),
  base_currency_code text not null,
  raw_organisation_count bigint not null,
  raw_contact_count bigint not null,
  raw_authorised_invoice_count bigint not null,
  raw_paid_invoice_count bigint not null,
  raw_payment_count bigint not null,
  canonical_organisation_count bigint not null,
  canonical_customer_count bigint not null,
  canonical_invoice_count bigint not null,
  canonical_payment_count bigint not null,
  incomplete_fx_invoice_count bigint not null,
  source_violation_count bigint not null,
  reconciliation_violation_count bigint not null,
  relationship_violation_count bigint not null,
  fx_violation_count bigint not null,
  constraint xero_sync_run_validations_run_fkey
    foreign key (sync_run_id, user_id, tenant_id)
    references public.xero_sync_runs (id, user_id, tenant_id)
    on delete cascade,
  constraint xero_sync_run_validations_contract_check
    check (contract_version = 'collections_readiness_v2'),
  constraint xero_sync_run_validations_fence_check
    check (fencing_token > 0),
  constraint xero_sync_run_validations_currency_check
    check (base_currency_code ~ '^[A-Z]{3}$'),
  constraint xero_sync_run_validations_counts_check
    check (
      raw_organisation_count = 1
      and raw_contact_count >= 0
      and raw_authorised_invoice_count >= 0
      and raw_paid_invoice_count >= 0
      and raw_payment_count >= 0
      and canonical_organisation_count = 1
      and canonical_customer_count >= 0
      and canonical_invoice_count >= 0
      and canonical_payment_count >= 0
      and incomplete_fx_invoice_count = 0
      and source_violation_count = 0
      and reconciliation_violation_count = 0
      and relationship_violation_count = 0
      and fx_violation_count = 0
    ),
  constraint xero_sync_run_validations_run_contract_fence_key
    unique (sync_run_id, contract_version, fencing_token)
);

create index idx_xero_sync_run_validations_tenant_validated
  on public.xero_sync_run_validations (user_id, tenant_id, validated_at desc);

alter table public.xero_sync_run_validations enable row level security;

revoke all on table public.xero_sync_run_validations
from public, anon, authenticated, service_role;

grant select on table public.xero_sync_run_validations to service_role;

-- This internal evaluator is the single promotion-readiness definition used by
-- fresh imports, dry-run inspection, same-run reacquisition, revalidation, and
-- promotion. It is deliberately not executable by application roles directly.
create function public.evaluate_xero_sync_run_readiness_v2(
  p_sync_run_id uuid,
  p_user_id uuid,
  p_tenant_id text
)
returns table (
  ready boolean,
  result_code text,
  base_currency_code text,
  raw_organisation_count bigint,
  raw_contact_count bigint,
  raw_authorised_invoice_count bigint,
  raw_paid_invoice_count bigint,
  raw_payment_count bigint,
  canonical_organisation_count bigint,
  canonical_customer_count bigint,
  canonical_invoice_count bigint,
  canonical_payment_count bigint,
  incomplete_fx_invoice_count bigint,
  source_violation_count bigint,
  reconciliation_violation_count bigint,
  relationship_violation_count bigint,
  fx_violation_count bigint
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_tenant_id text := nullif(btrim(p_tenant_id), '');
  v_preparation_complete boolean := false;
  v_step_organisation bigint;
  v_step_contacts bigint;
  v_step_authorised bigint;
  v_step_paid bigint;
  v_step_payments bigint;
  v_step_canonical bigint;
  v_base_currency text;
  v_raw_organisations bigint := 0;
  v_raw_contacts bigint := 0;
  v_raw_authorised bigint := 0;
  v_raw_paid bigint := 0;
  v_raw_payments bigint := 0;
  v_canonical_organisations bigint := 0;
  v_canonical_customers bigint := 0;
  v_canonical_invoices bigint := 0;
  v_canonical_payments bigint := 0;
  v_incomplete_fx bigint := 0;
  v_source_violations bigint := 0;
  v_reconciliation_violations bigint := 0;
  v_relationship_violations bigint := 0;
  v_fx_violations bigint := 0;
  v_result_code text := 'ready';
begin
  if p_sync_run_id is null or p_user_id is null or v_tenant_id is null then
    raise exception 'Xero readiness evaluation input is incomplete';
  end if;

  perform 1
  from public.xero_sync_runs as sync_run
  where sync_run.id = p_sync_run_id
    and sync_run.user_id = p_user_id
    and sync_run.tenant_id = v_tenant_id;

  if not found then
    return query select false, 'run_not_found'::text, null::text,
      0::bigint, 0::bigint, 0::bigint, 0::bigint, 0::bigint,
      0::bigint, 0::bigint, 0::bigint, 0::bigint,
      0::bigint, 0::bigint, 0::bigint, 0::bigint, 0::bigint;
    return;
  end if;

  select
    count(*) filter (
      where step.step_key in (
        'organisation',
        'contacts',
        'authorised_accrec_invoices',
        'paid_accrec_invoices',
        'authorised_accrec_payments',
        'canonical_mapping'
      )
      and step.status = 'succeeded'
      and step.record_count is not null
      and step.completed_at is not null
    ) = 6
    and count(distinct step.step_key) filter (
      where step.step_key in (
        'organisation',
        'contacts',
        'authorised_accrec_invoices',
        'paid_accrec_invoices',
        'authorised_accrec_payments',
        'canonical_mapping'
      )
    ) = 6,
    max(step.record_count) filter (where step.step_key = 'organisation'),
    max(step.record_count) filter (where step.step_key = 'contacts'),
    max(step.record_count) filter (where step.step_key = 'authorised_accrec_invoices'),
    max(step.record_count) filter (where step.step_key = 'paid_accrec_invoices'),
    max(step.record_count) filter (where step.step_key = 'authorised_accrec_payments'),
    max(step.record_count) filter (where step.step_key = 'canonical_mapping')
  into
    v_preparation_complete,
    v_step_organisation,
    v_step_contacts,
    v_step_authorised,
    v_step_paid,
    v_step_payments,
    v_step_canonical
  from public.xero_sync_run_steps as step
  where step.sync_run_id = p_sync_run_id;

  select
    count(*) filter (where raw.resource_type = 'organisations'),
    count(*) filter (where raw.resource_type = 'contacts'),
    count(*) filter (
      where raw.resource_type = 'invoices'
        and upper(raw.raw_json ->> 'Type') = 'ACCREC'
        and upper(raw.raw_json ->> 'Status') = 'AUTHORISED'
    ),
    count(*) filter (
      where raw.resource_type = 'invoices'
        and upper(raw.raw_json ->> 'Type') = 'ACCREC'
        and upper(raw.raw_json ->> 'Status') = 'PAID'
    ),
    count(*) filter (
      where raw.resource_type = 'payments'
        and upper(raw.raw_json ->> 'PaymentType') = 'ACCRECPAYMENT'
        and upper(raw.raw_json ->> 'Status') = 'AUTHORISED'
    )
  into
    v_raw_organisations,
    v_raw_contacts,
    v_raw_authorised,
    v_raw_paid,
    v_raw_payments
  from public.xero_raw as raw
  where raw.sync_run_id = p_sync_run_id
    and raw.user_id = p_user_id
    and raw.tenant_id = v_tenant_id;

  select count(*), min(organisation.base_currency_code)
  into v_canonical_organisations, v_base_currency
  from public.canonical_organisations as organisation
  where organisation.sync_run_id = p_sync_run_id
    and organisation.user_id = p_user_id
    and organisation.tenant_id = v_tenant_id;

  select count(*) into v_canonical_customers
  from public.canonical_customers as customer
  where customer.sync_run_id = p_sync_run_id
    and customer.user_id = p_user_id
    and customer.tenant_id = v_tenant_id;

  select count(*) into v_canonical_invoices
  from public.canonical_invoices as invoice
  where invoice.sync_run_id = p_sync_run_id
    and invoice.user_id = p_user_id
    and invoice.tenant_id = v_tenant_id;

  select count(*) into v_canonical_payments
  from public.canonical_payments as payment
  where payment.sync_run_id = p_sync_run_id
    and payment.user_id = p_user_id
    and payment.tenant_id = v_tenant_id;

  select count(*)
  into v_source_violations
  from public.xero_raw as raw
  where raw.sync_run_id = p_sync_run_id
    and raw.user_id = p_user_id
    and raw.tenant_id = v_tenant_id
    and (
      raw.resource_type not in ('organisations', 'contacts', 'invoices', 'payments')
      or jsonb_typeof(raw.raw_json) <> 'object'
      or case raw.resource_type
        when 'organisations' then
          nullif(btrim(raw.raw_json ->> 'OrganisationID'), '') is distinct from raw.source_id
          or upper(nullif(btrim(raw.raw_json ->> 'BaseCurrency'), '')) !~ '^[A-Z]{3}$'
        when 'contacts' then
          nullif(btrim(raw.raw_json ->> 'ContactID'), '') is distinct from raw.source_id
        when 'invoices' then
          nullif(btrim(raw.raw_json ->> 'InvoiceID'), '') is distinct from raw.source_id
          or upper(coalesce(raw.raw_json ->> 'Type', '')) <> 'ACCREC'
          or upper(coalesce(raw.raw_json ->> 'Status', '')) not in ('AUTHORISED', 'PAID')
          or nullif(btrim(raw.raw_json #>> '{Contact,ContactID}'), '') is null
        when 'payments' then
          nullif(btrim(raw.raw_json ->> 'PaymentID'), '') is distinct from raw.source_id
          or upper(coalesce(raw.raw_json ->> 'PaymentType', '')) <> 'ACCRECPAYMENT'
          or upper(coalesce(raw.raw_json ->> 'Status', '')) <> 'AUTHORISED'
          or nullif(btrim(raw.raw_json #>> '{Invoice,InvoiceID}'), '') is null
        else true
      end
    );

  select v_source_violations + coalesce(sum(duplicate_count - 1), 0)
  into v_source_violations
  from (
    select count(*)::bigint as duplicate_count
    from public.xero_raw as raw
    where raw.sync_run_id = p_sync_run_id
      and raw.user_id = p_user_id
      and raw.tenant_id = v_tenant_id
    group by raw.resource_type, raw.source_id
    having count(*) > 1
  ) as duplicates;

  select
    count(*) filter (
      where organisation.source_organisation_id <> v_tenant_id
        or organisation.base_currency_code !~ '^[A-Z]{3}$'
    )
  into v_reconciliation_violations
  from public.canonical_organisations as organisation
  where organisation.sync_run_id = p_sync_run_id
    and organisation.user_id = p_user_id
    and organisation.tenant_id = v_tenant_id;

  v_reconciliation_violations := v_reconciliation_violations
    + abs(v_raw_organisations - v_canonical_organisations)
    + abs(v_raw_contacts - v_canonical_customers)
    + abs((v_raw_authorised + v_raw_paid) - v_canonical_invoices)
    + abs(v_raw_payments - v_canonical_payments)
    + (
      select count(*)
      from public.xero_raw as raw
      where raw.sync_run_id = p_sync_run_id
        and raw.user_id = p_user_id
        and raw.tenant_id = v_tenant_id
        and raw.resource_type = 'contacts'
        and not exists (
          select 1 from public.canonical_customers as customer
          where customer.sync_run_id = p_sync_run_id
            and customer.user_id = p_user_id
            and customer.tenant_id = v_tenant_id
            and customer.source_id = raw.source_id
        )
    )
    + (
      select count(*)
      from public.canonical_customers as customer
      where customer.sync_run_id = p_sync_run_id
        and not exists (
          select 1 from public.xero_raw as raw
          where raw.sync_run_id = p_sync_run_id
            and raw.user_id = p_user_id
            and raw.tenant_id = v_tenant_id
            and raw.resource_type = 'contacts'
            and raw.source_id = customer.source_id
        )
    )
    + (
      select count(*)
      from public.xero_raw as raw
      where raw.sync_run_id = p_sync_run_id
        and raw.user_id = p_user_id
        and raw.tenant_id = v_tenant_id
        and raw.resource_type = 'invoices'
        and not exists (
          select 1 from public.canonical_invoices as invoice
          where invoice.sync_run_id = p_sync_run_id
            and invoice.user_id = p_user_id
            and invoice.tenant_id = v_tenant_id
            and invoice.source_id = raw.source_id
        )
    )
    + (
      select count(*)
      from public.canonical_invoices as invoice
      where invoice.sync_run_id = p_sync_run_id
        and not exists (
          select 1 from public.xero_raw as raw
          where raw.sync_run_id = p_sync_run_id
            and raw.user_id = p_user_id
            and raw.tenant_id = v_tenant_id
            and raw.resource_type = 'invoices'
            and raw.source_id = invoice.source_id
        )
    )
    + (
      select count(*)
      from public.xero_raw as raw
      where raw.sync_run_id = p_sync_run_id
        and raw.user_id = p_user_id
        and raw.tenant_id = v_tenant_id
        and raw.resource_type = 'payments'
        and not exists (
          select 1 from public.canonical_payments as payment
          where payment.sync_run_id = p_sync_run_id
            and payment.user_id = p_user_id
            and payment.tenant_id = v_tenant_id
            and payment.source_id = raw.source_id
        )
    )
    + (
      select count(*)
      from public.canonical_payments as payment
      where payment.sync_run_id = p_sync_run_id
        and not exists (
          select 1 from public.xero_raw as raw
          where raw.sync_run_id = p_sync_run_id
            and raw.user_id = p_user_id
            and raw.tenant_id = v_tenant_id
            and raw.resource_type = 'payments'
            and raw.source_id = payment.source_id
        )
    );

  select
    count(*) filter (where customer.source_id is null)
  into v_relationship_violations
  from public.canonical_invoices as invoice
  left join public.canonical_customers as customer
    on customer.sync_run_id = p_sync_run_id
   and customer.user_id = p_user_id
   and customer.tenant_id = v_tenant_id
   and customer.source_id = invoice.customer_source_id
  where invoice.sync_run_id = p_sync_run_id
    and invoice.user_id = p_user_id
    and invoice.tenant_id = v_tenant_id;

  v_relationship_violations := v_relationship_violations + (
    select count(*)
    from public.canonical_payments as payment
    left join public.canonical_invoices as invoice
      on invoice.sync_run_id = p_sync_run_id
     and invoice.user_id = p_user_id
     and invoice.tenant_id = v_tenant_id
     and invoice.source_id = payment.invoice_source_id
    left join public.canonical_customers as customer
      on customer.sync_run_id = p_sync_run_id
     and customer.user_id = p_user_id
     and customer.tenant_id = v_tenant_id
     and customer.source_id = payment.customer_source_id
    where payment.sync_run_id = p_sync_run_id
      and payment.user_id = p_user_id
      and payment.tenant_id = v_tenant_id
      and (invoice.source_id is null or customer.source_id is null)
  );

  with invoice_fx as (
    select
      invoice.*,
      nullif(btrim(raw.raw_json ->> 'CurrencyRate'), '') as raw_rate_text,
      case
        when nullif(btrim(raw.raw_json ->> 'CurrencyRate'), '')
          ~ '^[+-]?([0-9]+(\.[0-9]*)?|\.[0-9]+)([eE][+-]?[0-9]+)?$'
        then (btrim(raw.raw_json ->> 'CurrencyRate'))::numeric
        else null
      end as raw_rate
    from public.canonical_invoices as invoice
    left join public.xero_raw as raw
     on raw.sync_run_id = p_sync_run_id
     and raw.user_id = p_user_id
     and raw.tenant_id = v_tenant_id
     and raw.resource_type = 'invoices'
     and raw.source_id = invoice.source_id
    where invoice.sync_run_id = p_sync_run_id
      and invoice.user_id = p_user_id
      and invoice.tenant_id = v_tenant_id
  )
  select
    count(*) filter (where invoice_fx.currency_conversion_status = 'incomplete'),
    count(*) filter (
      where not coalesce(
        invoice_fx.currency_code = invoice_fx.transaction_currency_code
        and invoice_fx.organisation_base_currency_code = v_base_currency
        and invoice_fx.transaction_currency_code ~ '^[A-Z]{3}$'
        and (
          (
            invoice_fx.transaction_currency_code = v_base_currency
            and invoice_fx.currency_conversion_status = 'identity'
            and invoice_fx.currency_conversion_failure_reason is null
            and invoice_fx.total_native is not distinct from invoice_fx.total_base
            and invoice_fx.amount_due_native is not distinct from invoice_fx.amount_due_base
            and invoice_fx.amount_paid_native is not distinct from invoice_fx.amount_paid_base
            and invoice_fx.amount_credited_native is not distinct from invoice_fx.amount_credited_base
          )
          or
          (
            invoice_fx.transaction_currency_code <> v_base_currency
            and invoice_fx.currency_conversion_status = 'converted'
            and invoice_fx.currency_conversion_failure_reason is null
            and invoice_fx.xero_currency_rate > 0
            and invoice_fx.raw_rate > 0
            and invoice_fx.xero_currency_rate = invoice_fx.raw_rate
            and (
              (invoice_fx.total_native is null and invoice_fx.total_base is null)
              or invoice_fx.total_base = round(invoice_fx.total_native / invoice_fx.xero_currency_rate, 8)
            )
            and (
              (invoice_fx.amount_due_native is null and invoice_fx.amount_due_base is null)
              or invoice_fx.amount_due_base = round(invoice_fx.amount_due_native / invoice_fx.xero_currency_rate, 8)
            )
            and (
              (invoice_fx.amount_paid_native is null and invoice_fx.amount_paid_base is null)
              or invoice_fx.amount_paid_base = round(invoice_fx.amount_paid_native / invoice_fx.xero_currency_rate, 8)
            )
            and (
              (invoice_fx.amount_credited_native is null and invoice_fx.amount_credited_base is null)
              or invoice_fx.amount_credited_base = round(invoice_fx.amount_credited_native / invoice_fx.xero_currency_rate, 8)
            )
          )
        ),
        false
      )
    )
  into v_incomplete_fx, v_fx_violations
  from invoice_fx;

  if not coalesce(v_preparation_complete, false)
     or v_step_organisation is distinct from v_raw_organisations
     or v_step_contacts is distinct from v_raw_contacts
     or v_step_authorised is distinct from v_raw_authorised
     or v_step_paid is distinct from v_raw_paid
     or v_step_payments is distinct from v_raw_payments
     or v_step_canonical is distinct from (
       v_canonical_organisations
       + v_canonical_customers
       + v_canonical_invoices
       + v_canonical_payments
     ) then
    v_result_code := 'manifest_incomplete';
  elsif v_source_violations > 0 then
    v_result_code := 'source_invalid';
  elsif v_canonical_organisations <> 1
     or v_base_currency is null
     or v_base_currency !~ '^[A-Z]{3}$' then
    v_result_code := 'organisation_invalid';
  elsif v_reconciliation_violations > 0 then
    v_result_code := 'reconciliation_failed';
  elsif v_relationship_violations > 0 then
    v_result_code := 'relationship_invalid';
  elsif v_incomplete_fx > 0 or v_fx_violations > 0 then
    v_result_code := 'fx_incomplete';
  end if;

  return query select
    v_result_code = 'ready',
    v_result_code,
    v_base_currency,
    v_raw_organisations,
    v_raw_contacts,
    v_raw_authorised,
    v_raw_paid,
    v_raw_payments,
    v_canonical_organisations,
    v_canonical_customers,
    v_canonical_invoices,
    v_canonical_payments,
    v_incomplete_fx,
    v_source_violations,
    v_reconciliation_violations,
    v_relationship_violations,
    v_fx_violations;
end;
$$;

create function public.inspect_xero_sync_run_readiness(
  p_sync_run_id uuid,
  p_user_id uuid,
  p_tenant_id text,
  p_contract_version text default 'collections_readiness_v2'
)
returns table (
  ready boolean,
  result_code text,
  contract_version text,
  base_currency_code text,
  raw_organisation_count bigint,
  raw_contact_count bigint,
  raw_authorised_invoice_count bigint,
  raw_paid_invoice_count bigint,
  raw_payment_count bigint,
  canonical_organisation_count bigint,
  canonical_customer_count bigint,
  canonical_invoice_count bigint,
  canonical_payment_count bigint,
  incomplete_fx_invoice_count bigint,
  source_violation_count bigint,
  reconciliation_violation_count bigint,
  relationship_violation_count bigint,
  fx_violation_count bigint
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
begin
  if p_contract_version <> 'collections_readiness_v2' then
    return query select false, 'unsupported_contract'::text, p_contract_version,
      null::text, 0::bigint, 0::bigint, 0::bigint, 0::bigint, 0::bigint,
      0::bigint, 0::bigint, 0::bigint, 0::bigint,
      0::bigint, 0::bigint, 0::bigint, 0::bigint, 0::bigint;
    return;
  end if;

  return query
  select
    evaluation.ready,
    evaluation.result_code,
    p_contract_version,
    evaluation.base_currency_code,
    evaluation.raw_organisation_count,
    evaluation.raw_contact_count,
    evaluation.raw_authorised_invoice_count,
    evaluation.raw_paid_invoice_count,
    evaluation.raw_payment_count,
    evaluation.canonical_organisation_count,
    evaluation.canonical_customer_count,
    evaluation.canonical_invoice_count,
    evaluation.canonical_payment_count,
    evaluation.incomplete_fx_invoice_count,
    evaluation.source_violation_count,
    evaluation.reconciliation_violation_count,
    evaluation.relationship_violation_count,
    evaluation.fx_violation_count
  from public.evaluate_xero_sync_run_readiness_v2(
    p_sync_run_id,
    p_user_id,
    p_tenant_id
  ) as evaluation;
end;
$$;

-- Reacquisition is the sole allowed exception to run-fence/lease-owner
-- immutability. It is permitted only for an expired prepared run and always
-- advances the tenant-scoped fence.
create or replace function public.enforce_xero_sync_run_transition()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if new.id <> old.id
     or new.user_id <> old.user_id
     or new.tenant_id <> old.tenant_id
     or new.scope_version <> old.scope_version
     or new.required_steps <> old.required_steps
     or new.previous_active_sync_run_id is distinct from old.previous_active_sync_run_id
     or new.started_at <> old.started_at
     or new.created_at <> old.created_at then
    raise exception 'Xero sync run identity is immutable';
  end if;

  if old.status <> 'running' then
    raise exception 'Terminal Xero sync runs are immutable';
  end if;

  if new.status = 'running' then
    if new.fencing_token = old.fencing_token then
      if new.lease_owner <> old.lease_owner then
        raise exception 'Xero sync run lease owner is immutable';
      end if;
    elsif new.fencing_token > old.fencing_token then
      if old.lease_expires_at > now()
         or new.lease_owner is null
         or new.lease_owner is not distinct from old.lease_owner
         or new.heartbeat_at < now()
         or new.lease_expires_at <= now() then
        raise exception 'Xero sync run reacquisition is invalid';
      end if;
    else
      raise exception 'Xero sync run fencing token cannot move backwards';
    end if;
  elsif new.fencing_token <> old.fencing_token then
    raise exception 'A terminal transition cannot change the fencing token';
  end if;

  return new;
end;
$$;

create function public.reacquire_xero_sync_run_for_promotion(
  p_sync_run_id uuid,
  p_user_id uuid,
  p_tenant_id text,
  p_lease_owner uuid,
  p_contract_version text default 'collections_readiness_v2',
  p_ttl_seconds integer default 300
)
returns table (
  acquired boolean,
  result_code text,
  sync_run_id uuid,
  fencing_token bigint,
  lease_expires_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_tenant_id text := nullif(btrim(p_tenant_id), '');
  v_now timestamptz := now();
  v_ttl_seconds integer := least(greatest(coalesce(p_ttl_seconds, 300), 30), 900);
  v_connection public.xero_connections_public%rowtype;
  v_state public.xero_sync_tenant_state%rowtype;
  v_run public.xero_sync_runs%rowtype;
  v_evaluation record;
  v_manifest_complete boolean := false;
  v_new_fencing_token bigint;
  v_lease_expires_at timestamptz;
begin
  if p_sync_run_id is null
     or p_user_id is null
     or v_tenant_id is null
     or p_lease_owner is null
     or p_contract_version <> 'collections_readiness_v2' then
    raise exception 'Xero sync run reacquisition input is invalid';
  end if;

  select connection.*
  into v_connection
  from public.xero_connections_public as connection
  where connection.user_id = p_user_id
    and connection.tenant_id = v_tenant_id
  for update;

  if not found
     or v_connection.auth_state <> 'active'
     or v_connection.grant_id is null then
    return query select false, 'connection_not_available'::text,
      p_sync_run_id, null::bigint, null::timestamptz;
    return;
  end if;

  select tenant_state.*
  into v_state
  from public.xero_sync_tenant_state as tenant_state
  where tenant_state.user_id = p_user_id
    and tenant_state.tenant_id = v_tenant_id
  for update;

  if not found then
    return query select false, 'tenant_state_not_found'::text,
      p_sync_run_id, null::bigint, null::timestamptz;
    return;
  end if;

  select sync_run.*
  into v_run
  from public.xero_sync_runs as sync_run
  where sync_run.id = p_sync_run_id
    and sync_run.user_id = p_user_id
    and sync_run.tenant_id = v_tenant_id
  for update;

  if not found then
    return query select false, 'run_not_found'::text,
      p_sync_run_id, null::bigint, null::timestamptz;
    return;
  end if;
  if v_run.status = 'succeeded' then
    return query select false, 'already_promoted'::text,
      p_sync_run_id, null::bigint, null::timestamptz;
    return;
  end if;
  if v_run.status <> 'running' then
    return query select false, 'run_not_eligible'::text,
      p_sync_run_id, null::bigint, null::timestamptz;
    return;
  end if;
  if v_state.latest_sync_run_id is distinct from p_sync_run_id
     or v_state.current_fencing_token <> v_run.fencing_token then
    return query select false, 'superseded'::text,
      p_sync_run_id, null::bigint, null::timestamptz;
    return;
  end if;
  if v_state.active_sync_run_id is distinct from v_run.previous_active_sync_run_id then
    return query select false, 'active_generation_changed'::text,
      p_sync_run_id, null::bigint, null::timestamptz;
    return;
  end if;

  if v_run.lease_expires_at > v_now then
    if v_run.lease_owner = p_lease_owner then
      v_lease_expires_at := v_now + make_interval(secs => v_ttl_seconds);
      update public.xero_sync_runs as sync_run
      set heartbeat_at = v_now,
          lease_expires_at = v_lease_expires_at
      where sync_run.id = p_sync_run_id;

      return query select true, 'already_owned'::text, p_sync_run_id,
        v_run.fencing_token, v_lease_expires_at;
      return;
    end if;

    return query select false, 'lease_held'::text, p_sync_run_id,
      null::bigint, v_run.lease_expires_at;
    return;
  end if;

  select
    count(*) = cardinality(v_run.required_steps)
    and count(*) filter (
      where step.status = 'succeeded'
        and step.record_count is not null
        and step.completed_at is not null
    ) = cardinality(v_run.required_steps)
    and count(distinct step.step_key) = cardinality(v_run.required_steps)
  into v_manifest_complete
  from public.xero_sync_run_steps as step
  where step.sync_run_id = p_sync_run_id
    and step.step_key = any(v_run.required_steps);

  if not coalesce(v_manifest_complete, false) then
    return query select false, 'manifest_incomplete'::text,
      p_sync_run_id, null::bigint, null::timestamptz;
    return;
  end if;

  select evaluation.*
  into v_evaluation
  from public.evaluate_xero_sync_run_readiness_v2(
    p_sync_run_id,
    p_user_id,
    v_tenant_id
  ) as evaluation;

  if not coalesce(v_evaluation.ready, false) then
    return query select false, v_evaluation.result_code,
      p_sync_run_id, null::bigint, null::timestamptz;
    return;
  end if;

  if v_state.current_fencing_token = 9223372036854775807 then
    raise exception 'Xero sync fencing token exhausted';
  end if;

  v_new_fencing_token := v_state.current_fencing_token + 1;
  v_lease_expires_at := v_now + make_interval(secs => v_ttl_seconds);

  update public.xero_sync_runs as sync_run
  set fencing_token = v_new_fencing_token,
      lease_owner = p_lease_owner,
      heartbeat_at = v_now,
      lease_expires_at = v_lease_expires_at
  where sync_run.id = p_sync_run_id;

  update public.xero_sync_tenant_state as tenant_state
  set current_fencing_token = v_new_fencing_token,
      latest_sync_run_id = p_sync_run_id
  where tenant_state.user_id = p_user_id
    and tenant_state.tenant_id = v_tenant_id;

  return query select true, 'reacquired'::text, p_sync_run_id,
    v_new_fencing_token, v_lease_expires_at;
end;
$$;

create function public.record_xero_sync_run_readiness(
  p_sync_run_id uuid,
  p_user_id uuid,
  p_tenant_id text,
  p_lease_owner uuid,
  p_fencing_token bigint,
  p_contract_version text default 'collections_readiness_v2'
)
returns table (
  validated boolean,
  result_code text,
  validation_id uuid,
  validated_at timestamptz,
  contract_version text,
  fencing_token bigint,
  base_currency_code text,
  incomplete_fx_invoice_count bigint,
  fx_violation_count bigint
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_tenant_id text := nullif(btrim(p_tenant_id), '');
  v_now timestamptz := now();
  v_state public.xero_sync_tenant_state%rowtype;
  v_run public.xero_sync_runs%rowtype;
  v_evaluation record;
  v_validation_id uuid;
  v_validated_at timestamptz;
begin
  if p_sync_run_id is null
     or p_user_id is null
     or v_tenant_id is null
     or p_lease_owner is null
     or p_fencing_token is null
     or p_contract_version <> 'collections_readiness_v2' then
    raise exception 'Xero sync readiness recording input is invalid';
  end if;

  select tenant_state.*
  into v_state
  from public.xero_sync_tenant_state as tenant_state
  where tenant_state.user_id = p_user_id
    and tenant_state.tenant_id = v_tenant_id
  for update;

  select sync_run.*
  into v_run
  from public.xero_sync_runs as sync_run
  where sync_run.id = p_sync_run_id
    and sync_run.user_id = p_user_id
    and sync_run.tenant_id = v_tenant_id
  for update;

  if not found
     or v_state.latest_sync_run_id is distinct from p_sync_run_id
     or v_state.current_fencing_token <> p_fencing_token
     or v_run.fencing_token <> p_fencing_token then
    return query select false, 'superseded'::text, null::uuid,
      null::timestamptz, p_contract_version, p_fencing_token,
      null::text, null::bigint, null::bigint;
    return;
  end if;
  if v_run.status <> 'running' then
    return query select false, 'run_not_running'::text, null::uuid,
      null::timestamptz, p_contract_version, p_fencing_token,
      null::text, null::bigint, null::bigint;
    return;
  end if;
  if v_run.lease_owner <> p_lease_owner then
    return query select false, 'wrong_lease_owner'::text, null::uuid,
      null::timestamptz, p_contract_version, p_fencing_token,
      null::text, null::bigint, null::bigint;
    return;
  end if;
  if v_run.lease_expires_at <= v_now then
    return query select false, 'lease_expired'::text, null::uuid,
      null::timestamptz, p_contract_version, p_fencing_token,
      null::text, null::bigint, null::bigint;
    return;
  end if;

  select evaluation.*
  into v_evaluation
  from public.evaluate_xero_sync_run_readiness_v2(
    p_sync_run_id,
    p_user_id,
    v_tenant_id
  ) as evaluation;

  if not coalesce(v_evaluation.ready, false) then
    return query select false, v_evaluation.result_code, null::uuid,
      null::timestamptz, p_contract_version, p_fencing_token,
      v_evaluation.base_currency_code,
      v_evaluation.incomplete_fx_invoice_count,
      v_evaluation.fx_violation_count;
    return;
  end if;

  insert into public.xero_sync_run_validations (
    sync_run_id,
    user_id,
    tenant_id,
    contract_version,
    fencing_token,
    lease_owner,
    validated_at,
    base_currency_code,
    raw_organisation_count,
    raw_contact_count,
    raw_authorised_invoice_count,
    raw_paid_invoice_count,
    raw_payment_count,
    canonical_organisation_count,
    canonical_customer_count,
    canonical_invoice_count,
    canonical_payment_count,
    incomplete_fx_invoice_count,
    source_violation_count,
    reconciliation_violation_count,
    relationship_violation_count,
    fx_violation_count
  )
  values (
    p_sync_run_id,
    p_user_id,
    v_tenant_id,
    p_contract_version,
    p_fencing_token,
    p_lease_owner,
    v_now,
    v_evaluation.base_currency_code,
    v_evaluation.raw_organisation_count,
    v_evaluation.raw_contact_count,
    v_evaluation.raw_authorised_invoice_count,
    v_evaluation.raw_paid_invoice_count,
    v_evaluation.raw_payment_count,
    v_evaluation.canonical_organisation_count,
    v_evaluation.canonical_customer_count,
    v_evaluation.canonical_invoice_count,
    v_evaluation.canonical_payment_count,
    v_evaluation.incomplete_fx_invoice_count,
    v_evaluation.source_violation_count,
    v_evaluation.reconciliation_violation_count,
    v_evaluation.relationship_violation_count,
    v_evaluation.fx_violation_count
  )
  on conflict on constraint xero_sync_run_validations_run_contract_fence_key
  do nothing;

  select validation.id, validation.validated_at
  into v_validation_id, v_validated_at
  from public.xero_sync_run_validations as validation
  where validation.sync_run_id = p_sync_run_id
    and validation.contract_version = p_contract_version
    and validation.fencing_token = p_fencing_token;

  return query select true, 'validated'::text, v_validation_id,
    v_validated_at, p_contract_version, p_fencing_token,
    v_evaluation.base_currency_code,
    v_evaluation.incomplete_fx_invoice_count,
    v_evaluation.fx_violation_count;
end;
$$;

-- Promotion now requires current-contract evidence for the current fence and
-- re-evaluates the snapshot while holding the tenant/run locks. Historical
-- unversioned validation-step success can never satisfy this contract alone.
create or replace function public.promote_xero_sync_run(
  p_sync_run_id uuid,
  p_lease_owner uuid,
  p_fencing_token bigint,
  p_snapshot_as_of timestamptz default null
)
returns table (
  promoted boolean,
  result_code text,
  promoted_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_now timestamptz := now();
  v_user_id uuid;
  v_tenant_id text;
  v_state public.xero_sync_tenant_state%rowtype;
  v_run public.xero_sync_runs%rowtype;
  v_manifest_complete boolean;
  v_evaluation record;
  v_current_validation boolean;
begin
  if p_sync_run_id is null or p_lease_owner is null or p_fencing_token is null then
    raise exception 'Xero sync promotion input is incomplete';
  end if;

  select sync_run.user_id, sync_run.tenant_id
  into v_user_id, v_tenant_id
  from public.xero_sync_runs as sync_run
  where sync_run.id = p_sync_run_id;

  if not found then
    return query select false, 'run_not_found'::text, null::timestamptz;
    return;
  end if;

  select tenant_state.*
  into v_state
  from public.xero_sync_tenant_state as tenant_state
  where tenant_state.user_id = v_user_id
    and tenant_state.tenant_id = v_tenant_id
  for update;

  select sync_run.*
  into v_run
  from public.xero_sync_runs as sync_run
  where sync_run.id = p_sync_run_id
  for update;

  if v_state.latest_sync_run_id is distinct from p_sync_run_id
     or v_state.current_fencing_token <> p_fencing_token
     or v_run.fencing_token <> p_fencing_token then
    return query select false, 'superseded'::text, null::timestamptz;
    return;
  end if;
  if v_state.active_sync_run_id is distinct from v_run.previous_active_sync_run_id then
    return query select false, 'active_generation_changed'::text, null::timestamptz;
    return;
  end if;
  if v_run.status <> 'running' then
    return query select false, 'run_not_running'::text, null::timestamptz;
    return;
  end if;
  if v_run.lease_owner <> p_lease_owner then
    return query select false, 'wrong_lease_owner'::text, null::timestamptz;
    return;
  end if;
  if v_run.lease_expires_at <= v_now then
    return query select false, 'lease_expired'::text, null::timestamptz;
    return;
  end if;

  select
    count(*) = cardinality(v_run.required_steps)
    and count(*) filter (
      where step.status = 'succeeded'
        and step.record_count is not null
        and step.completed_at is not null
    ) = cardinality(v_run.required_steps)
    and count(distinct step.step_key) = cardinality(v_run.required_steps)
  into v_manifest_complete
  from public.xero_sync_run_steps as step
  where step.sync_run_id = p_sync_run_id
    and step.step_key = any(v_run.required_steps);

  if not coalesce(v_manifest_complete, false) then
    return query select false, 'manifest_incomplete'::text, null::timestamptz;
    return;
  end if;

  select evaluation.*
  into v_evaluation
  from public.evaluate_xero_sync_run_readiness_v2(
    p_sync_run_id,
    v_user_id,
    v_tenant_id
  ) as evaluation;

  if not coalesce(v_evaluation.ready, false) then
    return query select false, v_evaluation.result_code, null::timestamptz;
    return;
  end if;

  select exists (
    select 1
    from public.xero_sync_run_validations as validation
    where validation.sync_run_id = p_sync_run_id
      and validation.user_id = v_user_id
      and validation.tenant_id = v_tenant_id
      and validation.contract_version = 'collections_readiness_v2'
      and validation.fencing_token = p_fencing_token
      and validation.lease_owner = p_lease_owner
      and validation.base_currency_code = v_evaluation.base_currency_code
      and validation.raw_organisation_count = v_evaluation.raw_organisation_count
      and validation.raw_contact_count = v_evaluation.raw_contact_count
      and validation.raw_authorised_invoice_count = v_evaluation.raw_authorised_invoice_count
      and validation.raw_paid_invoice_count = v_evaluation.raw_paid_invoice_count
      and validation.raw_payment_count = v_evaluation.raw_payment_count
      and validation.canonical_organisation_count = v_evaluation.canonical_organisation_count
      and validation.canonical_customer_count = v_evaluation.canonical_customer_count
      and validation.canonical_invoice_count = v_evaluation.canonical_invoice_count
      and validation.canonical_payment_count = v_evaluation.canonical_payment_count
      and validation.incomplete_fx_invoice_count = 0
      and validation.source_violation_count = 0
      and validation.reconciliation_violation_count = 0
      and validation.relationship_violation_count = 0
      and validation.fx_violation_count = 0
  ) into v_current_validation;

  if not coalesce(v_current_validation, false) then
    return query select false, 'current_validation_required'::text, null::timestamptz;
    return;
  end if;

  update public.xero_sync_runs as sync_run
  set status = 'succeeded',
      completed_at = v_now,
      snapshot_as_of = coalesce(p_snapshot_as_of, v_now),
      lease_owner = null,
      lease_expires_at = null
  where sync_run.id = p_sync_run_id;

  update public.xero_sync_tenant_state as tenant_state
  set active_sync_run_id = p_sync_run_id,
      latest_sync_run_id = p_sync_run_id,
      last_successful_sync_at = v_now
  where tenant_state.user_id = v_user_id
    and tenant_state.tenant_id = v_tenant_id;

  return query select true, 'promoted'::text, v_now;
end;
$$;

revoke all on function public.evaluate_xero_sync_run_readiness_v2(uuid, uuid, text)
from public, anon, authenticated, service_role;

revoke all on function public.inspect_xero_sync_run_readiness(uuid, uuid, text, text)
from public, anon, authenticated, service_role;
grant execute on function public.inspect_xero_sync_run_readiness(uuid, uuid, text, text)
to service_role;

revoke all on function public.reacquire_xero_sync_run_for_promotion(
  uuid,
  uuid,
  text,
  uuid,
  text,
  integer
) from public, anon, authenticated, service_role;
grant execute on function public.reacquire_xero_sync_run_for_promotion(
  uuid,
  uuid,
  text,
  uuid,
  text,
  integer
) to service_role;

revoke all on function public.record_xero_sync_run_readiness(
  uuid,
  uuid,
  text,
  uuid,
  bigint,
  text
) from public, anon, authenticated, service_role;
grant execute on function public.record_xero_sync_run_readiness(
  uuid,
  uuid,
  text,
  uuid,
  bigint,
  text
) to service_role;

revoke all on function public.promote_xero_sync_run(uuid, uuid, bigint, timestamptz)
from public, anon, authenticated, service_role;
grant execute on function public.promote_xero_sync_run(uuid, uuid, bigint, timestamptz)
to service_role;

notify pgrst, 'reload schema';
