-- Phase 1 multi-currency foundation. This migration stores Xero organisation
-- currency metadata and invoice-native/base values without changing any
-- collections or prioritisation consumers.

create table public.canonical_organisations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  tenant_id text not null,
  source_system text not null default 'xero',
  source_organisation_id text not null,
  organisation_name text,
  base_currency_code text,
  country_code text,
  source_timezone text,
  xero_version text,
  use_multicurrency boolean,
  source_retrieved_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint canonical_organisations_base_currency_code_check
    check (base_currency_code is null or base_currency_code ~ '^[A-Z]{3}$'),
  constraint canonical_organisations_country_code_check
    check (country_code is null or country_code ~ '^[A-Z]{2}$'),
  unique (user_id, tenant_id, source_system, source_organisation_id)
);

create index idx_canonical_organisations_user_tenant
  on public.canonical_organisations (user_id, tenant_id);

create trigger update_canonical_organisations_updated_at
before update on public.canonical_organisations
for each row execute function public.set_updated_at();

alter table public.canonical_invoices
  add column transaction_currency_code text,
  add column organisation_base_currency_code text,
  add column xero_currency_rate numeric,
  add column total_native numeric,
  add column amount_due_native numeric,
  add column amount_paid_native numeric,
  add column amount_credited_native numeric,
  add column total_base numeric,
  add column amount_due_base numeric,
  add column amount_paid_base numeric,
  add column amount_credited_base numeric,
  add column currency_conversion_status text,
  add column currency_conversion_failure_reason text;

-- Existing rows have recoverable native values but no canonical organisation
-- base currency yet. Mark them explicitly incomplete until a post-migration Xero
-- sync rebuilds them from raw invoice and Organisation records.
update public.canonical_invoices
set
  transaction_currency_code = case
    when upper(btrim(currency_code)) ~ '^[A-Z]{3}$' then upper(btrim(currency_code))
    else null
  end,
  total_native = total,
  amount_due_native = amount_due,
  amount_paid_native = amount_paid,
  amount_credited_native = amount_credited,
  currency_conversion_status = 'incomplete',
  currency_conversion_failure_reason = case
    when currency_code is null or btrim(currency_code) = '' then 'missing_transaction_currency'
    when upper(btrim(currency_code)) !~ '^[A-Z]{3}$' then 'invalid_transaction_currency'
    else 'missing_base_currency'
  end;

alter table public.canonical_invoices
  alter column currency_conversion_status set not null,
  add constraint canonical_invoices_transaction_currency_code_check
    check (transaction_currency_code is null or transaction_currency_code ~ '^[A-Z]{3}$'),
  add constraint canonical_invoices_base_currency_code_check
    check (
      organisation_base_currency_code is null
      or organisation_base_currency_code ~ '^[A-Z]{3}$'
    ),
  add constraint canonical_invoices_xero_currency_rate_check
    check (xero_currency_rate is null or xero_currency_rate > 0),
  add constraint canonical_invoices_currency_conversion_status_check
    check (
      currency_conversion_status in ('identity', 'converted', 'incomplete')
    ),
  add constraint canonical_invoices_currency_conversion_failure_reason_check
    check (
      currency_conversion_failure_reason is null
      or currency_conversion_failure_reason in (
        'missing_transaction_currency',
        'invalid_transaction_currency',
        'missing_base_currency',
        'invalid_base_currency',
        'missing_rate',
        'invalid_rate'
      )
    ),
  add constraint canonical_invoices_currency_conversion_state_check
    check (
      (
        currency_conversion_status in ('identity', 'converted')
        and currency_conversion_failure_reason is null
      )
      or (
        currency_conversion_status = 'incomplete'
        and currency_conversion_failure_reason is not null
      )
    ),
  add constraint canonical_invoices_converted_rate_check
    check (currency_conversion_status <> 'converted' or xero_currency_rate is not null),
  add constraint canonical_invoices_valid_conversion_currency_pair_check
    check (
      currency_conversion_status not in ('identity', 'converted')
      or (
        transaction_currency_code is not null
        and organisation_base_currency_code is not null
        and (
          (
            currency_conversion_status = 'identity'
            and transaction_currency_code = organisation_base_currency_code
          )
          or (
            currency_conversion_status = 'converted'
            and transaction_currency_code <> organisation_base_currency_code
          )
        )
      )
    ),
  add constraint canonical_invoices_incomplete_base_amounts_check
    check (
      currency_conversion_status <> 'incomplete'
      or (
        total_base is null
        and amount_due_base is null
        and amount_paid_base is null
        and amount_credited_base is null
      )
    );

alter table public.canonical_organisations enable row level security;

revoke all on table public.canonical_organisations
from anon, authenticated, service_role;

grant select, insert, update, delete on table public.canonical_organisations
to service_role;
