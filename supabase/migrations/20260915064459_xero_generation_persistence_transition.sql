-- Phase 3 Xero generation persistence transition.
--
-- Deployment order is intentionally code first, then this migration. The Phase 3
-- application uses these RPCs when present and falls back to the existing
-- PostgREST upsert only while the RPCs are absent. After this migration removes
-- the global uniqueness constraints, an older application build cannot perform
-- its column-only PostgREST upserts against the partial legacy indexes.

-- Legacy rows need their own uniqueness contract once generated rows can carry
-- the same provider identity. These indexes are created while the stricter global
-- constraints still prove the input unique.
create unique index idx_xero_raw_legacy_source
  on public.xero_raw (user_id, tenant_id, resource_type, source_id)
  where sync_run_id is null;
create unique index idx_canonical_organisations_legacy_source
  on public.canonical_organisations (
    user_id,
    tenant_id,
    source_system,
    source_organisation_id
  )
  where sync_run_id is null;
create unique index idx_canonical_customers_legacy_source
  on public.canonical_customers (user_id, tenant_id, source_system, source_id)
  where sync_run_id is null;
create unique index idx_canonical_invoices_legacy_source
  on public.canonical_invoices (user_id, tenant_id, source_system, source_id)
  where sync_run_id is null;
create unique index idx_canonical_payments_legacy_source
  on public.canonical_payments (user_id, tenant_id, source_system, source_id)
  where sync_run_id is null;

-- The Phase 2 generation indexes already enforce the complementary predicates:
-- the same provider ID is unique inside one run, while distinct runs coexist.

create function public.assert_xero_generation_write_authority(
  p_sync_run_id uuid,
  p_user_id uuid,
  p_tenant_id text,
  p_lease_owner uuid,
  p_fencing_token bigint
)
returns void
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_now timestamptz := now();
  v_authorized boolean;
begin
  if p_sync_run_id is null
     or p_user_id is null
     or nullif(btrim(p_tenant_id), '') is null
     or p_lease_owner is null
     or p_fencing_token is null then
    raise exception 'Xero generation write identity is incomplete';
  end if;

  select true
  into v_authorized
  from public.xero_sync_tenant_state as tenant_state
  join public.xero_sync_runs as sync_run
    on sync_run.id = p_sync_run_id
   and sync_run.user_id = tenant_state.user_id
   and sync_run.tenant_id = tenant_state.tenant_id
  where tenant_state.user_id = p_user_id
    and tenant_state.tenant_id = btrim(p_tenant_id)
    and tenant_state.latest_sync_run_id = p_sync_run_id
    and tenant_state.current_fencing_token = p_fencing_token
    and sync_run.fencing_token = p_fencing_token
    and sync_run.status = 'running'
    and sync_run.lease_owner = p_lease_owner
    and sync_run.lease_expires_at > v_now
  for update of tenant_state, sync_run;

  if not coalesce(v_authorized, false) then
    raise exception 'Xero generation write authority rejected';
  end if;
end;
$$;

create function public.upsert_xero_legacy_raw_batch(
  p_user_id uuid,
  p_tenant_id text,
  p_resource_type text,
  p_fetched_at timestamptz,
  p_rows jsonb
)
returns bigint
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_written bigint := 0;
begin
  if p_user_id is null
     or nullif(btrim(p_tenant_id), '') is null
     or p_resource_type not in (
       'accounts',
       'contacts',
       'invoices',
       'organisations',
       'organisation_actions'
     )
     or p_fetched_at is null
     or p_rows is null
     or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'Legacy Xero raw batch input is invalid';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_rows) as item
    where jsonb_typeof(item) <> 'object'
      or nullif(btrim(item ->> 'source_id'), '') is null
      or jsonb_typeof(item -> 'raw_json') <> 'object'
  ) then
    raise exception 'Legacy Xero raw batch contains an invalid row';
  end if;

  insert into public.xero_raw (
    user_id,
    tenant_id,
    resource_type,
    source_id,
    raw_json,
    fetched_at,
    sync_run_id
  )
  select
    p_user_id,
    btrim(p_tenant_id),
    p_resource_type,
    btrim(item ->> 'source_id'),
    item -> 'raw_json',
    p_fetched_at,
    null
  from jsonb_array_elements(p_rows) as item
  on conflict (user_id, tenant_id, resource_type, source_id)
    where sync_run_id is null
  do update set
    raw_json = excluded.raw_json,
    fetched_at = excluded.fetched_at;

  get diagnostics v_written = row_count;
  return v_written;
end;
$$;

create function public.upsert_xero_generation_raw_batch(
  p_sync_run_id uuid,
  p_user_id uuid,
  p_tenant_id text,
  p_lease_owner uuid,
  p_fencing_token bigint,
  p_resource_type text,
  p_fetched_at timestamptz,
  p_rows jsonb
)
returns bigint
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_written bigint := 0;
begin
  if p_resource_type not in (
       'contacts',
       'invoices',
       'organisations',
       'organisation_actions',
       'payments'
     )
     or p_fetched_at is null
     or p_rows is null
     or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'Xero generation raw batch input is invalid';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_rows) as item
    where jsonb_typeof(item) <> 'object'
      or nullif(btrim(item ->> 'source_id'), '') is null
      or jsonb_typeof(item -> 'raw_json') <> 'object'
  ) then
    raise exception 'Xero generation raw batch contains an invalid row';
  end if;

  perform public.assert_xero_generation_write_authority(
    p_sync_run_id,
    p_user_id,
    p_tenant_id,
    p_lease_owner,
    p_fencing_token
  );

  insert into public.xero_raw (
    sync_run_id,
    user_id,
    tenant_id,
    resource_type,
    source_id,
    raw_json,
    fetched_at
  )
  select
    p_sync_run_id,
    p_user_id,
    btrim(p_tenant_id),
    p_resource_type,
    btrim(item ->> 'source_id'),
    item -> 'raw_json',
    p_fetched_at
  from jsonb_array_elements(p_rows) as item
  on conflict (sync_run_id, user_id, tenant_id, resource_type, source_id)
    where sync_run_id is not null
  do update set
    raw_json = excluded.raw_json,
    fetched_at = excluded.fetched_at
  where excluded.fetched_at >= public.xero_raw.fetched_at;

  get diagnostics v_written = row_count;
  return v_written;
end;
$$;

create function public.upsert_xero_legacy_canonical_batch(
  p_user_id uuid,
  p_tenant_id text,
  p_resource_type text,
  p_rows jsonb
)
returns bigint
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_written bigint := 0;
begin
  if p_user_id is null
     or nullif(btrim(p_tenant_id), '') is null
     or p_resource_type not in ('organisations', 'customers', 'invoices', 'payments')
     or p_rows is null
     or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'Legacy Xero canonical batch input is invalid';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_rows) as item
    where jsonb_typeof(item) <> 'object'
      or (
        p_resource_type = 'organisations'
        and nullif(btrim(item ->> 'source_organisation_id'), '') is null
      )
      or (
        p_resource_type <> 'organisations'
        and nullif(btrim(item ->> 'source_id'), '') is null
      )
  ) then
    raise exception 'Legacy Xero canonical batch contains an invalid row';
  end if;

  if p_resource_type = 'organisations' then
    insert into public.canonical_organisations (
      user_id,
      tenant_id,
      source_system,
      source_organisation_id,
      organisation_name,
      base_currency_code,
      country_code,
      source_timezone,
      xero_version,
      use_multicurrency,
      source_retrieved_at,
      sync_run_id
    )
    select
      p_user_id,
      btrim(p_tenant_id),
      'xero',
      input.source_organisation_id,
      input.organisation_name,
      input.base_currency_code,
      input.country_code,
      input.source_timezone,
      input.xero_version,
      input.use_multicurrency,
      input.source_retrieved_at,
      null
    from jsonb_populate_recordset(
      null::public.canonical_organisations,
      p_rows
    ) as input
    on conflict (user_id, tenant_id, source_system, source_organisation_id)
      where sync_run_id is null
    do update set
      organisation_name = excluded.organisation_name,
      base_currency_code = excluded.base_currency_code,
      country_code = excluded.country_code,
      source_timezone = excluded.source_timezone,
      xero_version = excluded.xero_version,
      use_multicurrency = excluded.use_multicurrency,
      source_retrieved_at = excluded.source_retrieved_at;
  elsif p_resource_type = 'customers' then
    insert into public.canonical_customers (
      user_id,
      tenant_id,
      source_system,
      source_id,
      name,
      email,
      is_customer,
      is_supplier,
      status,
      raw_updated_at,
      sync_run_id
    )
    select
      p_user_id,
      btrim(p_tenant_id),
      'xero',
      input.source_id,
      input.name,
      input.email,
      input.is_customer,
      input.is_supplier,
      input.status,
      input.raw_updated_at,
      null
    from jsonb_populate_recordset(null::public.canonical_customers, p_rows) as input
    on conflict (user_id, tenant_id, source_system, source_id)
      where sync_run_id is null
    do update set
      name = excluded.name,
      email = excluded.email,
      is_customer = excluded.is_customer,
      is_supplier = excluded.is_supplier,
      status = excluded.status,
      raw_updated_at = excluded.raw_updated_at;
  elsif p_resource_type = 'invoices' then
    insert into public.canonical_invoices (
      user_id,
      tenant_id,
      source_system,
      source_id,
      customer_source_id,
      type,
      invoice_number,
      reference,
      status,
      issue_date,
      due_date,
      fully_paid_date,
      currency_code,
      total,
      amount_due,
      amount_paid,
      amount_credited,
      transaction_currency_code,
      organisation_base_currency_code,
      xero_currency_rate,
      total_native,
      amount_due_native,
      amount_paid_native,
      amount_credited_native,
      total_base,
      amount_due_base,
      amount_paid_base,
      amount_credited_base,
      currency_conversion_status,
      currency_conversion_failure_reason,
      sent_to_contact,
      raw_updated_at,
      sync_run_id
    )
    select
      p_user_id,
      btrim(p_tenant_id),
      'xero',
      input.source_id,
      input.customer_source_id,
      input.type,
      input.invoice_number,
      input.reference,
      input.status,
      input.issue_date,
      input.due_date,
      input.fully_paid_date,
      input.currency_code,
      input.total,
      input.amount_due,
      input.amount_paid,
      input.amount_credited,
      input.transaction_currency_code,
      input.organisation_base_currency_code,
      input.xero_currency_rate,
      input.total_native,
      input.amount_due_native,
      input.amount_paid_native,
      input.amount_credited_native,
      input.total_base,
      input.amount_due_base,
      input.amount_paid_base,
      input.amount_credited_base,
      input.currency_conversion_status,
      input.currency_conversion_failure_reason,
      input.sent_to_contact,
      input.raw_updated_at,
      null
    from jsonb_populate_recordset(null::public.canonical_invoices, p_rows) as input
    on conflict (user_id, tenant_id, source_system, source_id)
      where sync_run_id is null
    do update set
      customer_source_id = excluded.customer_source_id,
      type = excluded.type,
      invoice_number = excluded.invoice_number,
      reference = excluded.reference,
      status = excluded.status,
      issue_date = excluded.issue_date,
      due_date = excluded.due_date,
      fully_paid_date = excluded.fully_paid_date,
      currency_code = excluded.currency_code,
      total = excluded.total,
      amount_due = excluded.amount_due,
      amount_paid = excluded.amount_paid,
      amount_credited = excluded.amount_credited,
      transaction_currency_code = excluded.transaction_currency_code,
      organisation_base_currency_code = excluded.organisation_base_currency_code,
      xero_currency_rate = excluded.xero_currency_rate,
      total_native = excluded.total_native,
      amount_due_native = excluded.amount_due_native,
      amount_paid_native = excluded.amount_paid_native,
      amount_credited_native = excluded.amount_credited_native,
      total_base = excluded.total_base,
      amount_due_base = excluded.amount_due_base,
      amount_paid_base = excluded.amount_paid_base,
      amount_credited_base = excluded.amount_credited_base,
      currency_conversion_status = excluded.currency_conversion_status,
      currency_conversion_failure_reason = excluded.currency_conversion_failure_reason,
      sent_to_contact = excluded.sent_to_contact,
      raw_updated_at = excluded.raw_updated_at;
  else
    insert into public.canonical_payments (
      user_id,
      tenant_id,
      source_system,
      source_id,
      invoice_source_id,
      customer_source_id,
      amount,
      payment_date,
      currency_rate,
      reference,
      raw_updated_at,
      sync_run_id
    )
    select
      p_user_id,
      btrim(p_tenant_id),
      'xero',
      input.source_id,
      input.invoice_source_id,
      input.customer_source_id,
      input.amount,
      input.payment_date,
      input.currency_rate,
      input.reference,
      input.raw_updated_at,
      null
    from jsonb_populate_recordset(null::public.canonical_payments, p_rows) as input
    on conflict (user_id, tenant_id, source_system, source_id)
      where sync_run_id is null
    do update set
      invoice_source_id = excluded.invoice_source_id,
      customer_source_id = excluded.customer_source_id,
      amount = excluded.amount,
      payment_date = excluded.payment_date,
      currency_rate = excluded.currency_rate,
      reference = excluded.reference,
      raw_updated_at = excluded.raw_updated_at;
  end if;

  get diagnostics v_written = row_count;
  return v_written;
end;
$$;

create function public.upsert_xero_generation_canonical_batch(
  p_sync_run_id uuid,
  p_user_id uuid,
  p_tenant_id text,
  p_lease_owner uuid,
  p_fencing_token bigint,
  p_resource_type text,
  p_rows jsonb
)
returns bigint
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_written bigint := 0;
begin
  if p_resource_type not in ('organisations', 'customers', 'invoices', 'payments')
     or p_rows is null
     or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'Xero generation canonical batch input is invalid';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_rows) as item
    where jsonb_typeof(item) <> 'object'
      or (
        p_resource_type = 'organisations'
        and nullif(btrim(item ->> 'source_organisation_id'), '') is null
      )
      or (
        p_resource_type <> 'organisations'
        and nullif(btrim(item ->> 'source_id'), '') is null
      )
  ) then
    raise exception 'Xero generation canonical batch contains an invalid row';
  end if;

  perform public.assert_xero_generation_write_authority(
    p_sync_run_id,
    p_user_id,
    p_tenant_id,
    p_lease_owner,
    p_fencing_token
  );

  if p_resource_type = 'organisations' then
    insert into public.canonical_organisations (
      sync_run_id,
      user_id,
      tenant_id,
      source_system,
      source_organisation_id,
      organisation_name,
      base_currency_code,
      country_code,
      source_timezone,
      xero_version,
      use_multicurrency,
      source_retrieved_at
    )
    select
      p_sync_run_id,
      p_user_id,
      btrim(p_tenant_id),
      'xero',
      input.source_organisation_id,
      input.organisation_name,
      input.base_currency_code,
      input.country_code,
      input.source_timezone,
      input.xero_version,
      input.use_multicurrency,
      input.source_retrieved_at
    from jsonb_populate_recordset(
      null::public.canonical_organisations,
      p_rows
    ) as input
    on conflict (
      sync_run_id,
      user_id,
      tenant_id,
      source_system,
      source_organisation_id
    ) where sync_run_id is not null
    do update set
      organisation_name = excluded.organisation_name,
      base_currency_code = excluded.base_currency_code,
      country_code = excluded.country_code,
      source_timezone = excluded.source_timezone,
      xero_version = excluded.xero_version,
      use_multicurrency = excluded.use_multicurrency,
      source_retrieved_at = excluded.source_retrieved_at;
  elsif p_resource_type = 'customers' then
    insert into public.canonical_customers (
      sync_run_id,
      user_id,
      tenant_id,
      source_system,
      source_id,
      name,
      email,
      is_customer,
      is_supplier,
      status,
      raw_updated_at
    )
    select
      p_sync_run_id,
      p_user_id,
      btrim(p_tenant_id),
      'xero',
      input.source_id,
      input.name,
      input.email,
      input.is_customer,
      input.is_supplier,
      input.status,
      input.raw_updated_at
    from jsonb_populate_recordset(null::public.canonical_customers, p_rows) as input
    on conflict (sync_run_id, user_id, tenant_id, source_system, source_id)
      where sync_run_id is not null
    do update set
      name = excluded.name,
      email = excluded.email,
      is_customer = excluded.is_customer,
      is_supplier = excluded.is_supplier,
      status = excluded.status,
      raw_updated_at = excluded.raw_updated_at;
  elsif p_resource_type = 'invoices' then
    insert into public.canonical_invoices (
      sync_run_id,
      user_id,
      tenant_id,
      source_system,
      source_id,
      customer_source_id,
      type,
      invoice_number,
      reference,
      status,
      issue_date,
      due_date,
      fully_paid_date,
      currency_code,
      total,
      amount_due,
      amount_paid,
      amount_credited,
      transaction_currency_code,
      organisation_base_currency_code,
      xero_currency_rate,
      total_native,
      amount_due_native,
      amount_paid_native,
      amount_credited_native,
      total_base,
      amount_due_base,
      amount_paid_base,
      amount_credited_base,
      currency_conversion_status,
      currency_conversion_failure_reason,
      sent_to_contact,
      raw_updated_at
    )
    select
      p_sync_run_id,
      p_user_id,
      btrim(p_tenant_id),
      'xero',
      input.source_id,
      input.customer_source_id,
      input.type,
      input.invoice_number,
      input.reference,
      input.status,
      input.issue_date,
      input.due_date,
      input.fully_paid_date,
      input.currency_code,
      input.total,
      input.amount_due,
      input.amount_paid,
      input.amount_credited,
      input.transaction_currency_code,
      input.organisation_base_currency_code,
      input.xero_currency_rate,
      input.total_native,
      input.amount_due_native,
      input.amount_paid_native,
      input.amount_credited_native,
      input.total_base,
      input.amount_due_base,
      input.amount_paid_base,
      input.amount_credited_base,
      input.currency_conversion_status,
      input.currency_conversion_failure_reason,
      input.sent_to_contact,
      input.raw_updated_at
    from jsonb_populate_recordset(null::public.canonical_invoices, p_rows) as input
    on conflict (sync_run_id, user_id, tenant_id, source_system, source_id)
      where sync_run_id is not null
    do update set
      customer_source_id = excluded.customer_source_id,
      type = excluded.type,
      invoice_number = excluded.invoice_number,
      reference = excluded.reference,
      status = excluded.status,
      issue_date = excluded.issue_date,
      due_date = excluded.due_date,
      fully_paid_date = excluded.fully_paid_date,
      currency_code = excluded.currency_code,
      total = excluded.total,
      amount_due = excluded.amount_due,
      amount_paid = excluded.amount_paid,
      amount_credited = excluded.amount_credited,
      transaction_currency_code = excluded.transaction_currency_code,
      organisation_base_currency_code = excluded.organisation_base_currency_code,
      xero_currency_rate = excluded.xero_currency_rate,
      total_native = excluded.total_native,
      amount_due_native = excluded.amount_due_native,
      amount_paid_native = excluded.amount_paid_native,
      amount_credited_native = excluded.amount_credited_native,
      total_base = excluded.total_base,
      amount_due_base = excluded.amount_due_base,
      amount_paid_base = excluded.amount_paid_base,
      amount_credited_base = excluded.amount_credited_base,
      currency_conversion_status = excluded.currency_conversion_status,
      currency_conversion_failure_reason = excluded.currency_conversion_failure_reason,
      sent_to_contact = excluded.sent_to_contact,
      raw_updated_at = excluded.raw_updated_at;
  else
    insert into public.canonical_payments (
      sync_run_id,
      user_id,
      tenant_id,
      source_system,
      source_id,
      invoice_source_id,
      customer_source_id,
      amount,
      payment_date,
      currency_rate,
      reference,
      raw_updated_at
    )
    select
      p_sync_run_id,
      p_user_id,
      btrim(p_tenant_id),
      'xero',
      input.source_id,
      input.invoice_source_id,
      input.customer_source_id,
      input.amount,
      input.payment_date,
      input.currency_rate,
      input.reference,
      input.raw_updated_at
    from jsonb_populate_recordset(null::public.canonical_payments, p_rows) as input
    on conflict (sync_run_id, user_id, tenant_id, source_system, source_id)
      where sync_run_id is not null
    do update set
      invoice_source_id = excluded.invoice_source_id,
      customer_source_id = excluded.customer_source_id,
      amount = excluded.amount,
      payment_date = excluded.payment_date,
      currency_rate = excluded.currency_rate,
      reference = excluded.reference,
      raw_updated_at = excluded.raw_updated_at;
  end if;

  get diagnostics v_written = row_count;
  return v_written;
end;
$$;

-- Remove only the global uniqueness constraints that block side-by-side
-- generations. The primary keys, legacy partial indexes, and Phase 2 generation
-- partial indexes remain authoritative for their respective row classes.
alter table public.xero_raw
  drop constraint xero_raw_user_id_tenant_id_resource_type_source_id_key;
alter table public.canonical_organisations
  drop constraint canonical_organisations_user_id_tenant_id_source_system_sou_key;
alter table public.canonical_customers
  drop constraint canonical_customers_user_id_tenant_id_source_system_source__key;
alter table public.canonical_invoices
  drop constraint canonical_invoices_user_id_tenant_id_source_system_source_i_key;
alter table public.canonical_payments
  drop constraint canonical_payments_user_id_tenant_id_source_system_source_i_key;

revoke all on function public.assert_xero_generation_write_authority(
  uuid,
  uuid,
  text,
  uuid,
  bigint
) from public, anon, authenticated, service_role;

revoke all on function public.upsert_xero_legacy_raw_batch(
  uuid,
  text,
  text,
  timestamptz,
  jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.upsert_xero_legacy_raw_batch(
  uuid,
  text,
  text,
  timestamptz,
  jsonb
) to service_role;

revoke all on function public.upsert_xero_generation_raw_batch(
  uuid,
  uuid,
  text,
  uuid,
  bigint,
  text,
  timestamptz,
  jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.upsert_xero_generation_raw_batch(
  uuid,
  uuid,
  text,
  uuid,
  bigint,
  text,
  timestamptz,
  jsonb
) to service_role;

revoke all on function public.upsert_xero_legacy_canonical_batch(
  uuid,
  text,
  text,
  jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.upsert_xero_legacy_canonical_batch(
  uuid,
  text,
  text,
  jsonb
) to service_role;

revoke all on function public.upsert_xero_generation_canonical_batch(
  uuid,
  uuid,
  text,
  uuid,
  bigint,
  text,
  jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.upsert_xero_generation_canonical_batch(
  uuid,
  uuid,
  text,
  uuid,
  bigint,
  text,
  jsonb
) to service_role;

notify pgrst, 'reload schema';
