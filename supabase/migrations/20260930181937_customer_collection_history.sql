-- One bounded, service-only customer history read. Promise/Dispute records stay
-- in their authoritative tables; this function only projects presentation facts.
create function public.read_customer_collection_history(
  p_user uuid, p_tenant text, p_source text, p_customer text, p_sync_run uuid,
  p_before_timestamp timestamptz, p_before_event_id text, p_limit integer
)
returns table (event_id text, event_kind text, occurred_at timestamptz, payload jsonb)
language sql stable security invoker set search_path = '' as $$
  with events as (
    select 'action:' || a.id::text as event_id, 'action'::text as event_kind,
      a.action_timestamp as occurred_at,
      jsonb_build_object('outcome', a.outcome, 'note', a.note,
        'nextActionDate', a.next_action_date) as payload
    from public.collection_actions a
    where a.user_id = p_user and a.tenant_id = p_tenant
      and a.source_system = p_source and a.customer_source_id = p_customer
      and a.action_type = 'outcome'

    union all
    select 'legacy:' || a.id::text, 'legacy'::text, a.action_timestamp,
      jsonb_build_object('actionType', a.action_type, 'outcome', a.outcome,
        'nextActionDate', a.next_action_date)
    from public.collection_actions a
    where a.user_id = p_user and a.tenant_id = p_tenant
      and a.source_system = p_source and a.customer_source_id = p_customer
      and a.action_type in ('called', 'emailed', 'postponed')

    union all
    select 'promise:' || e.id::text, 'promise'::text, e.occurred_at,
      jsonb_build_object('eventType', e.event_type, 'beforeTerms', e.before_terms,
        'afterTerms', e.after_terms, 'invoiceSourceId', p.invoice_source_id,
        'currencyCode', p.currency_code)
    from public.invoice_promises p
    join public.invoice_promise_events e on e.promise_id = p.id
      and e.user_id = p.user_id and e.tenant_id = p.tenant_id
    where p.user_id = p_user and p.tenant_id = p_tenant
      and p.source_system = p_source and p.customer_source_id = p_customer

    union all
    select 'dispute-created:' || d.id::text, 'dispute_created'::text, d.created_at,
      jsonb_build_object('invoiceSourceId', d.invoice_source_id)
    from public.invoice_disputes d
    where d.user_id = p_user and d.tenant_id = p_tenant and d.source_system = p_source
      and exists (select 1 from public.canonical_invoices i
        where i.user_id = d.user_id and i.tenant_id = d.tenant_id
          and i.source_system = d.source_system and i.source_id = d.invoice_source_id
          and i.customer_source_id = p_customer
          and i.sync_run_id is not distinct from p_sync_run)
      and not exists (select 1 from public.canonical_invoices conflicting
        where conflicting.user_id = d.user_id and conflicting.tenant_id = d.tenant_id
          and conflicting.source_system = d.source_system
          and conflicting.source_id = d.invoice_source_id
          and conflicting.customer_source_id is distinct from p_customer)

    union all
    select 'dispute-resolved:' || d.id::text, 'dispute_resolved'::text, d.resolved_at,
      jsonb_build_object('invoiceSourceId', d.invoice_source_id)
    from public.invoice_disputes d
    where d.user_id = p_user and d.tenant_id = p_tenant and d.source_system = p_source
      and d.resolved_at is not null and not d.is_active
      and exists (select 1 from public.canonical_invoices i
        where i.user_id = d.user_id and i.tenant_id = d.tenant_id
          and i.source_system = d.source_system and i.source_id = d.invoice_source_id
          and i.customer_source_id = p_customer
          and i.sync_run_id is not distinct from p_sync_run)
      and not exists (select 1 from public.canonical_invoices conflicting
        where conflicting.user_id = d.user_id and conflicting.tenant_id = d.tenant_id
          and conflicting.source_system = d.source_system
          and conflicting.source_id = d.invoice_source_id
          and conflicting.customer_source_id is distinct from p_customer)
  )
  select events.event_id, events.event_kind, events.occurred_at, events.payload
  from events
  where p_before_timestamp is null or
    (events.occurred_at, events.event_id) < (p_before_timestamp, p_before_event_id)
  order by events.occurred_at desc, events.event_id desc
  limit least(greatest(p_limit, 1), 51);
$$;

revoke all on function public.read_customer_collection_history(uuid,text,text,text,uuid,timestamptz,text,integer)
  from public, anon, authenticated, service_role;
grant execute on function public.read_customer_collection_history(uuid,text,text,text,uuid,timestamptz,text,integer)
  to service_role;
