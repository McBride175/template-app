alter table if exists public.xero_connections_public
  drop constraint if exists xero_connections_public_pkey;

alter table if exists public.xero_connections_public
  add constraint xero_connections_public_pkey primary key (user_id, tenant_id);

drop index if exists public.idx_xero_connections_public_user_tenant;

create index if not exists idx_xero_connections_public_user
  on public.xero_connections_public (user_id);
