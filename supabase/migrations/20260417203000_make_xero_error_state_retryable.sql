-- Legacy cleanup: transient refresh/provider failures previously set auth_state='error',
-- which blocked future sync attempts. Move those rows back to retryable active state.
update public.xero_connections_public
set auth_state = 'active',
    reauth_required_at = null
where auth_state = 'error';
