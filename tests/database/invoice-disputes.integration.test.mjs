import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const enabled = process.env.RUN_SUPABASE_INTEGRATION === '1'
const migration = readFileSync(
  new URL('../../supabase/migrations/20260924192418_create_invoice_disputes.sql', import.meta.url),
  'utf8'
)

test('local migration enforces provider identity, ownership grants and user deletion', { skip: !enabled }, () => {
  const sql = `
    begin;
    ${migration}
    insert into auth.users (id, aud, role, email, created_at, updated_at)
    values ('00000000-0000-4000-8000-00000000d001', 'authenticated',
      'authenticated', 'invoice-dispute-test@example.test', now(), now());
    insert into public.invoice_disputes (
      user_id, tenant_id, source_system, invoice_source_id, dispute_mode,
      recorded_disputed_amount_native, amount_due_at_last_review_native
    ) values (
      '00000000-0000-4000-8000-00000000d001', 'tenant-a', 'xero', 'invoice-a',
      'partial', 4000, 10000
    );
    do $$
    declare rejected boolean := false;
    begin
      begin
        insert into public.invoice_disputes (
          user_id, tenant_id, source_system, invoice_source_id, dispute_mode,
          recorded_disputed_amount_native, amount_due_at_last_review_native
        ) values (
          '00000000-0000-4000-8000-00000000d001', 'tenant-a', 'xero', 'invoice-a',
          'full', 10000, 10000
        );
      exception when unique_violation then rejected := true;
      end;
      if not rejected then raise exception 'provider identity was not unique'; end if;
      rejected := false;
      begin
        insert into public.invoice_disputes (
          user_id, tenant_id, source_system, invoice_source_id, dispute_mode,
          recorded_disputed_amount_native, amount_due_at_last_review_native
        ) values (
          '00000000-0000-4000-8000-00000000d001', 'tenant-a', 'xero', 'invoice-b',
          'partial', 0, 10000
        );
      exception when check_violation then rejected := true;
      end;
      if not rejected then raise exception 'zero partial dispute was accepted'; end if;
      rejected := false;
      begin
        update public.invoice_disputes set is_active = false
        where invoice_source_id = 'invoice-a';
      exception when check_violation then rejected := true;
      end;
      if not rejected then raise exception 'resolution timestamp invariant failed'; end if;
      if not (select relrowsecurity from pg_class where oid = 'public.invoice_disputes'::regclass) then
        raise exception 'RLS was not enabled';
      end if;
      if has_table_privilege('anon', 'public.invoice_disputes', 'SELECT') or
         has_table_privilege('authenticated', 'public.invoice_disputes', 'SELECT') or
         has_table_privilege('authenticated', 'public.invoice_disputes', 'INSERT') or
         has_table_privilege('authenticated', 'public.invoice_disputes', 'UPDATE') then
        raise exception 'browser role could access dispute rows';
      end if;
      if not has_table_privilege('service_role', 'public.invoice_disputes', 'SELECT') or
         not has_table_privilege('service_role', 'public.invoice_disputes', 'INSERT') or
         not has_table_privilege('service_role', 'public.invoice_disputes', 'UPDATE') then
        raise exception 'server role cannot maintain dispute rows';
      end if;
      if exists (
        select 1 from pg_constraint
        where conrelid = 'public.invoice_disputes'::regclass
          and confrelid = 'public.canonical_invoices'::regclass
      ) then raise exception 'dispute was attached to a generation row'; end if;
    end $$;
    delete from auth.users where id = '00000000-0000-4000-8000-00000000d001';
    do $$ begin
      if exists (select 1 from public.invoice_disputes where tenant_id = 'tenant-a') then
        raise exception 'user deletion did not remove disputes';
      end if;
    end $$;
    select 'invoice_disputes_contract_ok';
    rollback;
  `
  const output = execFileSync('docker', [
    'exec', '-i', 'supabase_db_template-app', 'psql', '-X', '-q', '-v', 'ON_ERROR_STOP=1',
    '-U', 'postgres', '-d', 'postgres', '-At',
  ], { input: sql, encoding: 'utf8' })
  assert.match(output, /invoice_disputes_contract_ok/)
})
