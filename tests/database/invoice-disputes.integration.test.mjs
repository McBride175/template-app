import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const enabled = process.env.RUN_SUPABASE_INTEGRATION === '1'
const migration = readFileSync(
  new URL('../../supabase/migrations/20260924192418_create_invoice_disputes.sql', import.meta.url),
  'utf8'
)
const revisionMigration = readFileSync(
  new URL('../../supabase/migrations/20260925182616_invoice_dispute_revisions_and_bulk.sql', import.meta.url),
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

test('revision and service-role bulk function commit all rows or roll back every row', { skip: !enabled }, () => {
  const sql = `
    begin;
    ${migration}
    insert into auth.users (id, aud, role, email, created_at, updated_at)
    values ('00000000-0000-4000-8000-00000000d011', 'authenticated',
      'authenticated', 'invoice-dispute-revision@example.test', now(), now());
    insert into public.invoice_disputes (
      user_id, tenant_id, source_system, invoice_source_id, dispute_mode,
      recorded_disputed_amount_native, amount_due_at_last_review_native, note
    ) values (
      '00000000-0000-4000-8000-00000000d011', 'tenant-a', 'xero', 'invoice-a',
      'partial', 2000, 8000, 'Old'
    ), (
      '00000000-0000-4000-8000-00000000d011', 'tenant-a', 'xero', 'invoice-c',
      'partial', 1000, 6000, 'Keep me'
    );
    ${revisionMigration}
    do $$ begin
      if (select revision from public.invoice_disputes where invoice_source_id = 'invoice-a') <> 1 then
        raise exception 'existing dispute did not backfill to revision 1';
      end if;
      if has_function_privilege('anon',
          'public.apply_invoice_disputes_bulk_full(uuid,text,text,jsonb)', 'EXECUTE') or
         has_function_privilege('authenticated',
          'public.apply_invoice_disputes_bulk_full(uuid,text,text,jsonb)', 'EXECUTE') or
         exists (select 1 from pg_proc p, lateral aclexplode(p.proacl) acl
           where p.oid = 'public.apply_invoice_disputes_bulk_full(uuid,text,text,jsonb)'::regprocedure
             and acl.grantee = 0 and acl.privilege_type = 'EXECUTE') or
         not has_function_privilege('service_role',
          'public.apply_invoice_disputes_bulk_full(uuid,text,text,jsonb)', 'EXECUTE') then
        raise exception 'bulk function execute grants are unsafe';
      end if;
    end $$;
    update public.invoice_disputes set note = 'New'
      where invoice_source_id = 'invoice-a';
    create function pg_temp.reject_invoice_b()
    returns trigger language plpgsql as $$
    begin
      if new.invoice_source_id = 'invoice-b' then
        raise exception 'disposable fixture failure' using errcode = 'P0002';
      end if;
      return new;
    end $$;
    create trigger reject_invoice_b_fixture
    after insert on public.invoice_disputes
    for each row execute function pg_temp.reject_invoice_b();
    do $$
    declare rejected boolean := false; rolled_back boolean := false;
    begin
      if (select revision from public.invoice_disputes where invoice_source_id = 'invoice-a') <> 2 then
        raise exception 'note update did not increment revision';
      end if;
      begin
        perform public.apply_invoice_disputes_bulk_full(
          '00000000-0000-4000-8000-00000000d011', 'tenant-a', 'xero',
          '[{"invoice_source_id":"invoice-a","amount_due_native":8000,"expected_revision":1},
            {"invoice_source_id":"invoice-b","amount_due_native":5000,"expected_revision":null},
            {"invoice_source_id":"invoice-c","amount_due_native":6000,"expected_revision":1}]'::jsonb
        );
      exception when sqlstate 'P0001' then rejected := true;
      end;
      if not rejected then raise exception 'stale bulk row was accepted'; end if;
      if exists (select 1 from public.invoice_disputes where invoice_source_id = 'invoice-b') or
         exists (select 1 from public.invoice_disputes where invoice_source_id = 'invoice-a'
           and (revision <> 2 or note <> 'New' or dispute_mode <> 'partial')) or
         exists (select 1 from public.invoice_disputes where invoice_source_id = 'invoice-c'
           and (revision <> 1 or note <> 'Keep me' or dispute_mode <> 'partial'
             or recorded_disputed_amount_native <> 1000)) then
        raise exception 'stale bulk call partially wrote rows';
      end if;
      begin
        perform public.apply_invoice_disputes_bulk_full(
          '00000000-0000-4000-8000-00000000d011', 'tenant-a', 'xero',
          '[{"invoice_source_id":"invoice-a","amount_due_native":8000,"expected_revision":2},
            {"invoice_source_id":"invoice-b","amount_due_native":5000,"expected_revision":null},
            {"invoice_source_id":"invoice-c","amount_due_native":6000,"expected_revision":1}]'::jsonb
        );
      exception when sqlstate 'P0002' then rolled_back := true;
      end;
      if not rolled_back then raise exception 'fixture did not reject second bulk write'; end if;
      if exists (select 1 from public.invoice_disputes where invoice_source_id = 'invoice-b') or
         exists (select 1 from public.invoice_disputes where invoice_source_id = 'invoice-a'
           and revision <> 2) or
         exists (select 1 from public.invoice_disputes where invoice_source_id = 'invoice-c'
           and (revision <> 1 or note <> 'Keep me' or dispute_mode <> 'partial')) then
        raise exception 'late bulk failure did not roll back earlier update';
      end if;
    end $$;
    drop trigger reject_invoice_b_fixture on public.invoice_disputes;
    set local role service_role;
    select count(*) from public.apply_invoice_disputes_bulk_full(
      '00000000-0000-4000-8000-00000000d011', 'tenant-a', 'xero',
      '[{"invoice_source_id":"invoice-a","amount_due_native":8000,"expected_revision":2},
        {"invoice_source_id":"invoice-b","amount_due_native":5000,"expected_revision":null},
        {"invoice_source_id":"invoice-c","amount_due_native":6000,"expected_revision":1}]'::jsonb
    );
    reset role;
    do $$
    declare rejected boolean := false;
    begin
      if exists (select 1 from public.invoice_disputes where invoice_source_id = 'invoice-a'
        and (revision <> 3 or note <> 'New' or dispute_mode <> 'full')) or
         not exists (select 1 from public.invoice_disputes where invoice_source_id = 'invoice-b'
        and revision = 1 and dispute_mode = 'full') or
         not exists (select 1 from public.invoice_disputes where invoice_source_id = 'invoice-c'
        and revision = 2 and dispute_mode = 'full' and note = 'Keep me'
        and recorded_disputed_amount_native = 6000) then
        raise exception 'valid bulk call did not atomically update and insert';
      end if;
      update public.invoice_disputes set is_active = false, resolved_at = now()
        where invoice_source_id = 'invoice-a';
      begin
        perform public.apply_invoice_disputes_bulk_full(
          '00000000-0000-4000-8000-00000000d011', 'tenant-a', 'xero',
          '[{"invoice_source_id":"invoice-a","amount_due_native":8000,"expected_revision":4},
            {"invoice_source_id":"invoice-b","amount_due_native":5000,"expected_revision":1}]'::jsonb
        );
      exception when sqlstate 'P0001' then rejected := true;
      end;
      if not rejected then raise exception 'resolved row was silently reactivated'; end if;
      if exists (select 1 from public.invoice_disputes where invoice_source_id = 'invoice-b'
        and revision <> 1) then
        raise exception 'resolved-row conflict partially updated another row';
      end if;
    end $$;
    select 'invoice_disputes_revision_bulk_ok';
    rollback;
  `
  const output = execFileSync('docker', [
    'exec', '-i', 'supabase_db_template-app', 'psql', '-X', '-q', '-v', 'ON_ERROR_STOP=1',
    '-U', 'postgres', '-d', 'postgres', '-At',
  ], { input: sql, encoding: 'utf8' })
  assert.match(output, /invoice_disputes_revision_bulk_ok/)
})
