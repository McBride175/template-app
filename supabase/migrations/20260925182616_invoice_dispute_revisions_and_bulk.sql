-- Dispute revisions are business-state concurrency tokens. The existing
-- updated_at trigger remains responsible only for the human-readable time.
alter table public.invoice_disputes
  add column revision bigint not null default 1
  constraint invoice_disputes_revision_positive check (revision > 0);

create function public.increment_invoice_dispute_revision()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  new.revision = old.revision + 1;
  return new;
end;
$$;

create trigger increment_invoice_disputes_revision
before update on public.invoice_disputes
for each row execute function public.increment_invoice_dispute_revision();

revoke all on function public.increment_invoice_dispute_revision() from public, anon, authenticated;

-- Called only by the authenticated, tenant-scoped collections server path.
-- A function call is one database transaction: any conflict rolls back all
-- updates and inserts, including rows processed earlier in the loop.
create function public.apply_invoice_disputes_bulk_full(
  p_user_id uuid,
  p_tenant_id text,
  p_source_system text,
  p_rows jsonb
)
returns setof public.invoice_disputes
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  v_item record;
  v_existing public.invoice_disputes%rowtype;
  v_result public.invoice_disputes%rowtype;
  v_previous_id text;
begin
  if p_user_id is null or nullif(btrim(p_tenant_id), '') is null or
     p_source_system is distinct from 'xero' or
     jsonb_typeof(p_rows) is distinct from 'array' or
     jsonb_array_length(p_rows) = 0 then
    raise exception 'invalid invoice dispute bulk input' using errcode = '22023';
  end if;

  -- Lock and validate the complete selected set before the first write.
  -- Sorting produces a consistent row-lock order for concurrent batches.
  for v_item in
    select invoice_source_id, amount_due_native, expected_revision
    from jsonb_to_recordset(p_rows) as input(
      invoice_source_id text, amount_due_native numeric, expected_revision bigint
    )
    order by invoice_source_id
  loop
    if nullif(btrim(v_item.invoice_source_id), '') is null or
       v_item.invoice_source_id = v_previous_id or
       v_item.amount_due_native is null or v_item.amount_due_native <= 0 or
       (v_item.expected_revision is not null and v_item.expected_revision <= 0) then
      raise exception 'invalid invoice dispute bulk input' using errcode = '22023';
    end if;
    v_previous_id := v_item.invoice_source_id;

    select * into v_existing
    from public.invoice_disputes
    where user_id = p_user_id and tenant_id = p_tenant_id
      and source_system = p_source_system
      and invoice_source_id = v_item.invoice_source_id
    for update;
    if found then
      if v_item.expected_revision is null or
         v_existing.revision <> v_item.expected_revision or
         not v_existing.is_active then
        raise exception 'invoice_disputes_revision_conflict' using errcode = 'P0001';
      end if;
    elsif v_item.expected_revision is not null then
      raise exception 'invoice_disputes_revision_conflict' using errcode = 'P0001';
    end if;
  end loop;

  for v_item in
    select invoice_source_id, amount_due_native, expected_revision
    from jsonb_to_recordset(p_rows) as input(
      invoice_source_id text, amount_due_native numeric, expected_revision bigint
    )
    order by invoice_source_id
  loop
    if v_item.expected_revision is null then
      insert into public.invoice_disputes (
        user_id, tenant_id, source_system, invoice_source_id, dispute_mode,
        recorded_disputed_amount_native, amount_due_at_last_review_native
      ) values (
        p_user_id, p_tenant_id, p_source_system, v_item.invoice_source_id, 'full',
        v_item.amount_due_native, v_item.amount_due_native
      ) on conflict on constraint invoice_disputes_provider_identity_key do nothing
      returning * into v_result;
    else
      update public.invoice_disputes
      set dispute_mode = 'full',
          recorded_disputed_amount_native = v_item.amount_due_native,
          amount_due_at_last_review_native = v_item.amount_due_native
      where user_id = p_user_id and tenant_id = p_tenant_id
        and source_system = p_source_system
        and invoice_source_id = v_item.invoice_source_id
        and revision = v_item.expected_revision and is_active
      returning * into v_result;
    end if;
    if not found then
      raise exception 'invoice_disputes_revision_conflict' using errcode = 'P0001';
    end if;
    return next v_result;
  end loop;
end;
$$;

revoke all on function public.apply_invoice_disputes_bulk_full(uuid, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.apply_invoice_disputes_bulk_full(uuid, text, text, jsonb)
  to service_role;
