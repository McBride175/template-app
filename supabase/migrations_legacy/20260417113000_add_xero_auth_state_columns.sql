alter table if exists public.xero_connections_public
  add column if not exists last_refresh_error text,
  add column if not exists reauth_required_at timestamptz;

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conname = 'xero_connections_public_auth_state_check'
  ) then
    alter table public.xero_connections_public
      drop constraint xero_connections_public_auth_state_check;
  end if;
end
$$;

alter table if exists public.xero_connections_public
  add constraint xero_connections_public_auth_state_check
  check (auth_state in ('active', 'reauth_required', 'disconnected', 'error'));

alter table if exists public.xero_connection_secrets
  alter column access_token_encrypted drop not null;
