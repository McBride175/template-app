-- User-authored collection state is keyed by the provider's durable invoice ID,
-- never by a generation-scoped canonical_invoices row ID.
create table public.invoice_disputes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  tenant_id text not null check (btrim(tenant_id) <> ''),
  source_system text not null check (btrim(source_system) <> ''),
  invoice_source_id text not null check (btrim(invoice_source_id) <> ''),
  dispute_mode text not null check (dispute_mode in ('full', 'partial')),
  recorded_disputed_amount_native numeric not null
    check (recorded_disputed_amount_native >= 0),
  amount_due_at_last_review_native numeric not null
    check (amount_due_at_last_review_native > 0),
  note text,
  is_active boolean not null default true,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint invoice_disputes_provider_identity_key
    unique (user_id, tenant_id, source_system, invoice_source_id),
  constraint invoice_disputes_partial_amount_check
    check (dispute_mode <> 'partial' or recorded_disputed_amount_native > 0),
  constraint invoice_disputes_resolution_check
    check (is_active = (resolved_at is null))
);

create index idx_invoice_disputes_user_tenant_active_updated
  on public.invoice_disputes (user_id, tenant_id, is_active, updated_at desc);

create trigger update_invoice_disputes_updated_at
before update on public.invoice_disputes
for each row execute function public.set_updated_at();

alter table public.invoice_disputes enable row level security;

-- Collections data is accessed only by authenticated server code using an
-- explicitly user- and tenant-scoped service-role query.
revoke all on table public.invoice_disputes from anon, authenticated, service_role;
grant select, insert, update on table public.invoice_disputes to service_role;
