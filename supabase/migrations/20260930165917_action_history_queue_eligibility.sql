-- Batch latest-action lookups for the queue. Each customer uses the same
-- timestamp/ID ordering as the Phase 2 customer-scoped latest read.
create index idx_collection_actions_legacy_customer_latest
  on public.collection_actions
    (user_id, tenant_id, source_system, customer_source_id, action_timestamp desc, id desc)
  where action_type in ('called', 'emailed', 'postponed');

create function public.latest_collection_queue_actions(
  p_user_id uuid,
  p_tenant_id text,
  p_source_system text,
  p_customer_source_ids text[]
)
returns table (
  customer_source_id text,
  action_format text,
  id uuid,
  action_type text,
  outcome text,
  note text,
  next_action_date date,
  action_timestamp timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select customer.customer_source_id, action.action_format, action.id,
    action.action_type, action.outcome, action.note, action.next_action_date,
    action.action_timestamp
  from (select distinct value as customer_source_id
        from unnest(p_customer_source_ids) as input(value)
        where value is not null and value <> '') customer
  cross join lateral (
    select 'v1'::text as action_format, v1.id, v1.action_type,
      v1.outcome, left(v1.note, 160) as note, v1.next_action_date, v1.action_timestamp
    from public.collection_actions v1
    where v1.user_id = p_user_id and v1.tenant_id = p_tenant_id
      and v1.source_system = p_source_system
      and v1.customer_source_id = customer.customer_source_id
      and v1.action_type = 'outcome'
    order by v1.action_timestamp desc, v1.id desc
    limit 1
  ) action
  union all
  select customer.customer_source_id, action.action_format, action.id,
    action.action_type, action.outcome, action.note, action.next_action_date,
    action.action_timestamp
  from (select distinct value as customer_source_id
        from unnest(p_customer_source_ids) as input(value)
        where value is not null and value <> '') customer
  cross join lateral (
    select 'legacy'::text as action_format, legacy.id, legacy.action_type,
      legacy.outcome, null::text as note, legacy.next_action_date, legacy.action_timestamp
    from public.collection_actions legacy
    where legacy.user_id = p_user_id and legacy.tenant_id = p_tenant_id
      and legacy.source_system = p_source_system
      and legacy.customer_source_id = customer.customer_source_id
      and legacy.action_type in ('called', 'emailed', 'postponed')
    order by legacy.action_timestamp desc, legacy.id desc
    limit 1
  ) action;
$$;

revoke all on function public.latest_collection_queue_actions(uuid, text, text, text[])
  from public, anon, authenticated;
grant execute on function public.latest_collection_queue_actions(uuid, text, text, text[])
  to service_role;
