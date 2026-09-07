-- Make free usage a per-authenticated-user allowance and serialize claims so
-- parallel requests cannot create extra trial days or cross the limit.

alter table public.billing_usage_days
  drop constraint if exists billing_usage_days_tenant_usage_date_key;

-- Historical tenant-scoped usage can contain more than one row for the same
-- user/date. Preserve every tenant record, but retain user attribution on only
-- the earliest row so the new partial unique index can be installed without
-- deleting audit evidence or reducing any user's distinct-day count.
with ranked_usage as (
  select
    id,
    row_number() over (
      partition by user_id, usage_date
      order by created_at asc, id asc
    ) as usage_rank
  from public.billing_usage_days
  where user_id is not null
)
update public.billing_usage_days as usage_day
set user_id = null
from ranked_usage
where usage_day.id = ranked_usage.id
  and ranked_usage.usage_rank > 1;

create unique index billing_usage_days_user_usage_date_key
  on public.billing_usage_days (user_id, usage_date)
  where user_id is not null;

create index if not exists idx_billing_usage_days_tenant_usage_date
  on public.billing_usage_days (tenant_id, usage_date);

create function public.claim_billing_usage_day(
  p_user_id uuid,
  p_tenant_id text,
  p_usage_date date,
  p_free_usage_days_limit integer
)
returns table (
  allowed boolean,
  usage_days_consumed integer,
  usage_date_already_recorded boolean
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  current_user_usage_days integer;
  current_tenant_usage_days integer;
  current_user_date_recorded boolean;
  current_tenant_date_recorded boolean;
  effective_usage_days integer;
begin
  if p_user_id is null then
    raise exception 'p_user_id is required';
  end if;
  if p_tenant_id is null or btrim(p_tenant_id) = '' then
    raise exception 'p_tenant_id is required';
  end if;
  if p_usage_date is null then
    raise exception 'p_usage_date is required';
  end if;
  if p_free_usage_days_limit is null
     or p_free_usage_days_limit < 1
     or p_free_usage_days_limit > 365 then
    raise exception 'p_free_usage_days_limit must be between 1 and 365';
  end if;

  -- Transaction-scoped user and tenant locks make count/check/insert one atomic
  -- claim across account and Xero-organisation reset attempts.
  perform pg_advisory_xact_lock(hashtextextended('billing-user:' || p_user_id::text, 0));
  perform pg_advisory_xact_lock(hashtextextended('billing-tenant:' || btrim(p_tenant_id), 0));

  select
    count(distinct usage_date)::integer,
    coalesce(bool_or(usage_date = p_usage_date), false)
  into current_user_usage_days, current_user_date_recorded
  from public.billing_usage_days
  where user_id = p_user_id;

  select
    count(distinct usage_date)::integer,
    coalesce(bool_or(usage_date = p_usage_date), false)
  into current_tenant_usage_days, current_tenant_date_recorded
  from public.billing_usage_days
  where tenant_id = btrim(p_tenant_id);

  effective_usage_days := greatest(current_user_usage_days, current_tenant_usage_days);

  -- Each scope must independently permit the date. A date used by a different
  -- user on this tenant cannot reopen an exhausted user's allowance, and a date
  -- used by this user elsewhere cannot reopen an exhausted tenant allowance.
  if (not current_user_date_recorded
      and current_user_usage_days >= p_free_usage_days_limit)
     or (not current_tenant_date_recorded
         and current_tenant_usage_days >= p_free_usage_days_limit) then
    return query select false, effective_usage_days, false;
    return;
  end if;

  if current_user_date_recorded then
    return query select true, effective_usage_days, true;
    return;
  end if;

  if current_tenant_date_recorded then
    insert into public.billing_usage_days (user_id, tenant_id, usage_date)
    values (p_user_id, btrim(p_tenant_id), p_usage_date);

    return query
      select true, greatest(current_user_usage_days + 1, current_tenant_usage_days), true;
    return;
  end if;

  insert into public.billing_usage_days (user_id, tenant_id, usage_date)
  values (p_user_id, btrim(p_tenant_id), p_usage_date);

  return query
    select true, greatest(current_user_usage_days + 1, current_tenant_usage_days + 1), true;
end;
$$;

revoke all on function public.claim_billing_usage_day(uuid, text, date, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.claim_billing_usage_day(uuid, text, date, integer)
  to service_role;

-- Stripe cache ordering. Stripe event delivery is duplicated and unordered, and
-- one customer can have an older and a newer subscription at the same time.
alter table public.subscriptions
  add column if not exists stripe_subscription_created_at timestamptz;

update public.subscriptions
set stripe_subscription_created_at = coalesce(created_at, now())
where stripe_subscription_created_at is null;

alter table public.subscriptions
  alter column stripe_subscription_created_at set not null;

create function public.apply_stripe_subscription_cache(
  p_user_id uuid,
  p_stripe_customer_id text,
  p_stripe_subscription_id text,
  p_stripe_price_id text,
  p_status text,
  p_current_period_end timestamptz,
  p_stripe_subscription_created_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  cache_applied boolean := false;
begin
  if p_user_id is null
     or nullif(btrim(p_stripe_customer_id), '') is null
     or nullif(btrim(p_stripe_subscription_id), '') is null
     or nullif(btrim(p_status), '') is null
     or p_stripe_subscription_created_at is null then
    raise exception 'Stripe subscription cache input is incomplete';
  end if;

  insert into public.subscriptions (
    user_id,
    stripe_customer_id,
    stripe_subscription_id,
    stripe_price_id,
    status,
    current_period_end,
    stripe_subscription_created_at
  )
  values (
    p_user_id,
    btrim(p_stripe_customer_id),
    btrim(p_stripe_subscription_id),
    nullif(btrim(p_stripe_price_id), ''),
    btrim(p_status),
    p_current_period_end,
    p_stripe_subscription_created_at
  )
  on conflict (user_id) do update
  set stripe_customer_id = excluded.stripe_customer_id,
      stripe_subscription_id = excluded.stripe_subscription_id,
      stripe_price_id = excluded.stripe_price_id,
      status = excluded.status,
      current_period_end = excluded.current_period_end,
      stripe_subscription_created_at = excluded.stripe_subscription_created_at
  where public.subscriptions.stripe_subscription_id = excluded.stripe_subscription_id
     or excluded.stripe_subscription_created_at >
        public.subscriptions.stripe_subscription_created_at
  returning true into cache_applied;

  return coalesce(cache_applied, false);
end;
$$;

revoke all on function public.apply_stripe_subscription_cache(
  uuid, text, text, text, text, timestamptz, timestamptz
) from public, anon, authenticated, service_role;
grant execute on function public.apply_stripe_subscription_cache(
  uuid, text, text, text, text, timestamptz, timestamptz
) to service_role;

-- Billable data must not remain directly callable with a browser session token.
-- Authenticated application requests go through server routes that enforce the
-- allowance, then use the service role with explicit user/tenant filters.
revoke all on table
  public.xero_raw,
  public.canonical_customers,
  public.canonical_invoices,
  public.canonical_payments,
  public.customer_overrides,
  public.collection_actions
from anon, authenticated;

drop policy if exists "Users can read own xero raw"
  on public.xero_raw;
drop policy if exists "Users can read own canonical customers"
  on public.canonical_customers;
drop policy if exists "Users can read own canonical invoices"
  on public.canonical_invoices;
drop policy if exists "Users can read own canonical payments"
  on public.canonical_payments;
drop policy if exists "Users can read own customer overrides"
  on public.customer_overrides;
drop policy if exists "Users can insert own customer overrides"
  on public.customer_overrides;
drop policy if exists "Users can update own customer overrides"
  on public.customer_overrides;
drop policy if exists "Users can delete own customer overrides"
  on public.customer_overrides;
drop policy if exists "Users can read own collection actions"
  on public.collection_actions;
drop policy if exists "Users can insert own collection actions"
  on public.collection_actions;
drop policy if exists "Users can delete own collection actions"
  on public.collection_actions;
