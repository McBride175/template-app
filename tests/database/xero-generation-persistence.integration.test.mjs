import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import test from 'node:test'

const enabled = process.env.RUN_SUPABASE_INTEGRATION === '1'
const databaseContainer = 'supabase_db_yuohme'
const userId = '00000000-0000-4000-8000-00000000c301'
const grantId = '00000000-0000-4000-8000-00000000c302'
const tenantId = 'xero-generation-persistence-tenant'
const ownerA = '00000000-0000-4000-8000-00000000c3a1'
const ownerB = '00000000-0000-4000-8000-00000000c3b2'

function psql(sql) {
  return execFileSync(
    'docker',
    [
      'exec',
      '-i',
      databaseContainer,
      'psql',
      '-X',
      '-q',
      '-v',
      'ON_ERROR_STOP=1',
      '-U',
      'postgres',
      '-d',
      'postgres',
      '-At',
      '-F',
      '|',
    ],
    { encoding: 'utf8', input: sql }
  ).trim()
}

function asServiceRole(sql) {
  return `
    begin;
    set local role service_role;
    ${sql}
    commit;
  `
}

function json(value) {
  return `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`
}

function resetFixtures() {
  psql(`
    delete from auth.users where id = '${userId}'::uuid;
    insert into auth.users (id, aud, role, email, created_at, updated_at)
    values (
      '${userId}'::uuid,
      'authenticated',
      'authenticated',
      'xero-generation-persistence@example.test',
      now(),
      now()
    );
    insert into public.xero_oauth_grants (
      id, user_id, xero_user_id, scopes, refresh_token_encrypted
    ) values (
      '${grantId}'::uuid,
      '${userId}'::uuid,
      'xero-generation-persistence-user',
      array['accounting.transactions.read']::text[],
      'integration-test-ciphertext'
    );
    insert into public.xero_connections_public (
      user_id, tenant_id, tenant_name, auth_state, grant_id
    ) values (
      '${userId}'::uuid,
      '${tenantId}',
      'Generation Persistence Tenant',
      'active',
      '${grantId}'::uuid
    );
  `)
}

function acquire(owner) {
  const [acquired, runId, fence] = psql(asServiceRole(`
    select acquired::text, coalesce(sync_run_id::text, ''), coalesce(fencing_token::text, '')
    from public.acquire_xero_sync_run(
      '${userId}'::uuid,
      '${tenantId}',
      '${owner}'::uuid,
      'collections_v1',
      300
    );
  `)).split('|')
  return { acquired: acquired === 'true', runId, fence: Number(fence) }
}

function abandon(run, owner) {
  return psql(asServiceRole(`
    select abandoned::text || '|' || result_code
    from public.abandon_xero_sync_run(
      '${run.runId}'::uuid,
      '${owner}'::uuid,
      ${run.fence}::bigint,
      'test_complete'
    );
  `))
}

function writeLegacyRaw(resourceType, fetchedAt, rows) {
  return Number(psql(asServiceRole(`
    select public.upsert_xero_legacy_raw_batch(
      '${userId}'::uuid,
      '${tenantId}',
      '${resourceType}',
      '${fetchedAt}'::timestamptz,
      ${json(rows)}
    );
  `)))
}

function writeGenerationRaw(run, owner, resourceType, fetchedAt, rows, tenant = tenantId) {
  return Number(psql(asServiceRole(`
    select public.upsert_xero_generation_raw_batch(
      '${run.runId}'::uuid,
      '${userId}'::uuid,
      '${tenant}',
      '${owner}'::uuid,
      ${run.fence}::bigint,
      '${resourceType}',
      '${fetchedAt}'::timestamptz,
      ${json(rows)}
    );
  `)))
}

function writeLegacyCanonical(resourceType, rows) {
  return Number(psql(asServiceRole(`
    select public.upsert_xero_legacy_canonical_batch(
      '${userId}'::uuid,
      '${tenantId}',
      '${resourceType}',
      ${json(rows)}
    );
  `)))
}

function writeGenerationCanonical(run, owner, resourceType, rows) {
  return Number(psql(asServiceRole(`
    select public.upsert_xero_generation_canonical_batch(
      '${run.runId}'::uuid,
      '${userId}'::uuid,
      '${tenantId}',
      '${owner}'::uuid,
      ${run.fence}::bigint,
      '${resourceType}',
      ${json(rows)}
    );
  `)))
}

function canonicalInvoice(reference, total) {
  return {
    source_id: 'invoice-x',
    customer_source_id: 'contact-x',
    type: 'ACCREC',
    invoice_number: 'INV-X',
    reference,
    status: 'AUTHORISED',
    issue_date: '2026-09-01',
    due_date: '2026-09-30',
    currency_code: 'GBP',
    total,
    amount_due: total,
    amount_paid: 0,
    amount_credited: 0,
    transaction_currency_code: 'GBP',
    organisation_base_currency_code: 'GBP',
    total_native: total,
    amount_due_native: total,
    amount_paid_native: 0,
    amount_credited_native: 0,
    total_base: total,
    amount_due_base: total,
    amount_paid_base: 0,
    amount_credited_base: 0,
    currency_conversion_status: 'identity',
    currency_conversion_failure_reason: null,
  }
}

test(
  'migration installs complementary uniqueness and service-only persistence RPCs',
  { skip: !enabled },
  () => {
    const indexPredicates = psql(`
      select indexname || ':' || coalesce(pg_get_expr(indexprs, indrelid), '') || ':' ||
        coalesce(pg_get_expr(indpred, indrelid), '')
      from pg_indexes
      join pg_class on pg_class.relname = indexname
      join pg_index on pg_index.indexrelid = pg_class.oid
      where schemaname = 'public'
        and indexname in (
          'idx_xero_raw_legacy_source',
          'idx_xero_raw_generation_source',
          'idx_canonical_customers_legacy_source',
          'idx_canonical_customers_generation_source',
          'idx_canonical_invoices_legacy_source',
          'idx_canonical_invoices_generation_source',
          'idx_canonical_payments_legacy_source',
          'idx_canonical_payments_generation_source'
        )
      order by indexname;
    `)
    assert.match(indexPredicates, /idx_xero_raw_legacy_source::\(sync_run_id IS NULL\)/)
    assert.match(indexPredicates, /idx_xero_raw_generation_source::\(sync_run_id IS NOT NULL\)/)
    assert.equal(
      psql(`
        select count(*) from pg_constraint
        where conname in (
          'xero_raw_user_id_tenant_id_resource_type_source_id_key',
          'canonical_customers_user_id_tenant_id_source_system_source__key',
          'canonical_invoices_user_id_tenant_id_source_system_source_i_key',
          'canonical_payments_user_id_tenant_id_source_system_source_i_key'
        );
      `),
      '0'
    )

    const privileges = psql(`
      select array_to_string(array[
        has_function_privilege(
          'anon',
          'public.upsert_xero_generation_raw_batch(uuid,uuid,text,uuid,bigint,text,timestamptz,jsonb)',
          'execute'
        )::text,
        has_function_privilege(
          'authenticated',
          'public.upsert_xero_generation_canonical_batch(uuid,uuid,text,uuid,bigint,text,jsonb)',
          'execute'
        )::text,
        has_function_privilege(
          'service_role',
          'public.upsert_xero_legacy_raw_batch(uuid,text,text,timestamptz,jsonb)',
          'execute'
        )::text,
        has_function_privilege(
          'service_role',
          'public.upsert_xero_generation_canonical_batch(uuid,uuid,text,uuid,bigint,text,jsonb)',
          'execute'
        )::text
      ], '|');
    `)
    assert.equal(privileges, 'false|false|true|true')
  }
)

test(
  'legacy and two generations coexist and retry only their own source identities',
  { skip: !enabled },
  () => {
    resetFixtures()

    assert.equal(writeLegacyRaw('invoices', '2026-09-15T06:00:00Z', [
      { source_id: 'invoice-x', raw_json: { InvoiceID: 'invoice-x', marker: 'legacy-1' } },
    ]), 1)
    assert.equal(writeLegacyRaw('invoices', '2026-09-15T06:01:00Z', [
      { source_id: 'invoice-x', raw_json: { InvoiceID: 'invoice-x', marker: 'legacy-2' } },
    ]), 1)

    writeLegacyCanonical('customers', [
      { source_id: 'contact-x', name: 'Legacy Contact' },
    ])
    writeLegacyCanonical('organisations', [
      {
        source_organisation_id: 'organisation-x',
        organisation_name: 'Legacy Organisation',
        base_currency_code: 'GBP',
        source_retrieved_at: '2026-09-15T06:01:00Z',
      },
    ])
    writeLegacyCanonical('invoices', [canonicalInvoice('legacy', 100)])
    writeLegacyCanonical('payments', [
      {
        source_id: 'payment-x',
        invoice_source_id: 'invoice-x',
        customer_source_id: 'contact-x',
        amount: 100,
        payment_date: '2026-09-10',
      },
    ])

    const runA = acquire(ownerA)
    assert.equal(runA.acquired, true)
    writeGenerationRaw(runA, ownerA, 'contacts', '2026-09-15T06:10:00Z', [
      { source_id: 'contact-x', raw_json: { ContactID: 'contact-x', marker: 'a-1' } },
    ])
    writeGenerationRaw(runA, ownerA, 'invoices', '2026-09-15T06:10:00Z', [
      { source_id: 'invoice-x', raw_json: { InvoiceID: 'invoice-x', marker: 'a-1' } },
    ])
    writeGenerationRaw(runA, ownerA, 'payments', '2026-09-15T06:10:00Z', [
      { source_id: 'payment-x', raw_json: { PaymentID: 'payment-x', marker: 'a-1' } },
    ])
    writeGenerationCanonical(runA, ownerA, 'customers', [
      { source_id: 'contact-x', name: 'Generation A Contact' },
    ])
    writeGenerationCanonical(runA, ownerA, 'organisations', [
      {
        source_organisation_id: 'organisation-x',
        organisation_name: 'Generation A Organisation',
        base_currency_code: 'GBP',
        source_retrieved_at: '2026-09-15T06:10:00Z',
      },
    ])
    writeGenerationCanonical(runA, ownerA, 'invoices', [canonicalInvoice('generation-a-1', 200)])
    writeGenerationCanonical(runA, ownerA, 'payments', [
      {
        source_id: 'payment-x',
        invoice_source_id: 'invoice-x',
        customer_source_id: 'contact-x',
        amount: 200,
        payment_date: '2026-09-11',
      },
    ])

    writeGenerationRaw(runA, ownerA, 'invoices', '2026-09-15T06:11:00Z', [
      { source_id: 'invoice-x', raw_json: { InvoiceID: 'invoice-x', marker: 'a-2' } },
    ])
    writeGenerationCanonical(runA, ownerA, 'customers', [
      { source_id: 'contact-x', name: 'Generation A Contact Updated' },
    ])
    writeGenerationCanonical(runA, ownerA, 'invoices', [canonicalInvoice('generation-a-2', 201)])

    assert.equal(abandon(runA, ownerA), 'true|abandoned')
    const runB = acquire(ownerB)
    assert.equal(runB.acquired, true)
    assert.equal(runB.fence, runA.fence + 1)

    writeGenerationRaw(runB, ownerB, 'contacts', '2026-09-15T06:20:00Z', [
      { source_id: 'contact-x', raw_json: { ContactID: 'contact-x', marker: 'b' } },
    ])
    writeGenerationRaw(runB, ownerB, 'invoices', '2026-09-15T06:20:00Z', [
      { source_id: 'invoice-x', raw_json: { InvoiceID: 'invoice-x', marker: 'b' } },
    ])
    writeGenerationRaw(runB, ownerB, 'payments', '2026-09-15T06:20:00Z', [
      { source_id: 'payment-x', raw_json: { PaymentID: 'payment-x', marker: 'b' } },
    ])
    writeGenerationCanonical(runB, ownerB, 'customers', [
      { source_id: 'contact-x', name: 'Generation B Contact' },
    ])
    writeGenerationCanonical(runB, ownerB, 'organisations', [
      {
        source_organisation_id: 'organisation-x',
        organisation_name: 'Generation B Organisation',
        base_currency_code: 'GBP',
        source_retrieved_at: '2026-09-15T06:20:00Z',
      },
    ])
    writeGenerationCanonical(runB, ownerB, 'invoices', [canonicalInvoice('generation-b', 300)])
    writeGenerationCanonical(runB, ownerB, 'payments', [
      {
        source_id: 'payment-x',
        invoice_source_id: 'invoice-x',
        customer_source_id: 'contact-x',
        amount: 300,
        payment_date: '2026-09-12',
      },
    ])

    assert.equal(
      psql(`
        select string_agg(
          coalesce(raw.sync_run_id::text, 'legacy') || ':' || (raw.raw_json ->> 'marker'),
          ',' order by coalesce(sync_run.fencing_token, 0)
        )
        from public.xero_raw as raw
        left join public.xero_sync_runs as sync_run on sync_run.id = raw.sync_run_id
        where raw.user_id = '${userId}'::uuid
          and raw.tenant_id = '${tenantId}'
          and raw.resource_type = 'invoices'
          and raw.source_id = 'invoice-x';
      `),
      `legacy:legacy-2,${runA.runId}:a-2,${runB.runId}:b`
    )
    assert.equal(
      psql(`
        select count(*)::text || '|' ||
          count(*) filter (where sync_run_id is null)::text || '|' ||
          count(distinct sync_run_id)::text
        from public.canonical_customers
        where user_id = '${userId}'::uuid and source_id = 'contact-x';
      `),
      '3|1|2'
    )
    assert.equal(
      psql(`
        select string_agg(
          coalesce(sync_run_id::text, 'legacy') || ':' || name,
          ',' order by coalesce(sync_run.fencing_token, 0)
        )
        from public.canonical_customers as customer
        left join public.xero_sync_runs as sync_run on sync_run.id = customer.sync_run_id
        where customer.user_id = '${userId}'::uuid and customer.source_id = 'contact-x';
      `),
      `legacy:Legacy Contact,${runA.runId}:Generation A Contact Updated,${runB.runId}:Generation B Contact`
    )
    for (const table of ['canonical_invoices', 'canonical_payments']) {
      assert.equal(
        psql(`
          select count(*) from public.${table}
          where user_id = '${userId}'::uuid
            and source_id = '${table === 'canonical_invoices' ? 'invoice-x' : 'payment-x'}';
        `),
        '3'
      )
    }
    assert.equal(
      psql(`
        select count(*) from public.canonical_organisations
        where user_id = '${userId}'::uuid
          and source_organisation_id = 'organisation-x';
      `),
      '3'
    )
    assert.equal(
      psql(`
        select reference || '|' || total::text
        from public.canonical_invoices
        where sync_run_id = '${runA.runId}'::uuid and source_id = 'invoice-x';
      `),
      'generation-a-2|201'
    )
    assert.equal(
      psql(`
        select reference || '|' || total::text
        from public.canonical_invoices
        where sync_run_id = '${runB.runId}'::uuid and source_id = 'invoice-x';
      `),
      'generation-b|300'
    )
    assert.equal(
      psql(`
        select count(*) from public.canonical_customers
        where user_id = '${userId}'::uuid
          and tenant_id = '${tenantId}'
          and sync_run_id is null;
      `),
      '1'
    )
    assert.equal(
      psql(`
        select (active_sync_run_id is null)::text || '|' ||
          (last_successful_sync_at is null)::text
        from public.xero_sync_tenant_state
        where user_id = '${userId}'::uuid and tenant_id = '${tenantId}';
      `),
      'true|true'
    )
  }
)

test(
  'wrong ownership and invalid batches fail without changing readiness',
  { skip: !enabled },
  () => {
    resetFixtures()
    const run = acquire(ownerA)

    assert.throws(
      () => writeGenerationRaw(
        run,
        ownerA,
        'contacts',
        '2026-09-15T06:30:00Z',
        [{ source_id: 'contact-wrong', raw_json: { ContactID: 'contact-wrong' } }],
        'wrong-tenant'
      ),
      /Xero generation write authority rejected/
    )
    assert.equal(
      psql(`select count(*) from public.xero_raw where source_id = 'contact-wrong';`),
      '0'
    )

    assert.throws(
      () => writeGenerationCanonical(run, ownerA, 'customers', [
        { source_id: 'batch-good', name: 'Would be valid' },
        { source_id: ' ', name: 'Invalid source identity' },
      ]),
      /canonical batch contains an invalid row/
    )
    assert.equal(
      psql(`
        select count(*) from public.canonical_customers
        where source_id = 'batch-good';
      `),
      '0'
    )
    assert.equal(
      psql(`
        select (active_sync_run_id is null)::text || '|' ||
          (last_successful_sync_at is null)::text
        from public.xero_sync_tenant_state
        where user_id = '${userId}'::uuid and tenant_id = '${tenantId}';
      `),
      'true|true'
    )
  }
)

test.after(() => {
  if (enabled) psql(`delete from auth.users where id = '${userId}'::uuid;`)
})
