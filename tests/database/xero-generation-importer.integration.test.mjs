import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import test from 'node:test'

const enabled = process.env.RUN_SUPABASE_INTEGRATION === '1'
const databaseContainer = 'supabase_db_template-app'
const userId = '00000000-0000-4000-8000-00000000d401'
const grantId = '00000000-0000-4000-8000-00000000d402'
const tenantA = '00000000-0000-4000-8000-00000000d4a1'
const tenantB = '00000000-0000-4000-8000-00000000d4b2'
const ownerA = '00000000-0000-4000-8000-00000000d411'
const ownerB = '00000000-0000-4000-8000-00000000d422'
const ownerC = '00000000-0000-4000-8000-00000000d433'

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
      'xero-generation-importer@example.test',
      now(),
      now()
    );
    insert into public.xero_oauth_grants (
      id, user_id, xero_user_id, scopes, refresh_token_encrypted
    ) values (
      '${grantId}'::uuid,
      '${userId}'::uuid,
      'xero-generation-importer-user',
      array[
        'offline_access',
        'accounting.settings.read',
        'accounting.contacts.read',
        'accounting.transactions.read'
      ]::text[],
      'integration-test-ciphertext'
    );
    insert into public.xero_connections_public (
      user_id, tenant_id, tenant_name, auth_state, grant_id
    ) values
      (
        '${userId}'::uuid,
        '${tenantA}',
        'Generation Importer Tenant A',
        'active',
        '${grantId}'::uuid
      ),
      (
        '${userId}'::uuid,
        '${tenantB}',
        'Generation Importer Tenant B',
        'active',
        '${grantId}'::uuid
      );
  `)
}

function acquire(tenantId, owner) {
  const [acquired, resultCode, runId, fence, leaseExpiresAt] = psql(asServiceRole(`
    select
      acquired::text,
      result_code,
      coalesce(sync_run_id::text, ''),
      coalesce(fencing_token::text, ''),
      coalesce(lease_expires_at::text, '')
    from public.acquire_xero_sync_run(
      '${userId}'::uuid,
      '${tenantId}',
      '${owner}'::uuid,
      'collections_v1',
      300
    );
  `)).split('|')
  return {
    acquired: acquired === 'true',
    resultCode,
    runId,
    fence: Number(fence),
    leaseExpiresAt,
  }
}

function heartbeat(run, owner) {
  const [renewed, resultCode] = psql(asServiceRole(`
    select renewed::text, result_code
    from public.heartbeat_xero_sync_run(
      '${run.runId}'::uuid,
      '${owner}'::uuid,
      ${run.fence}::bigint,
      300
    );
  `)).split('|')
  return { renewed: renewed === 'true', resultCode }
}

function completeStep(run, owner, stepKey, recordCount) {
  const [completed, resultCode] = psql(asServiceRole(`
    select completed::text, result_code
    from public.complete_xero_sync_run_step(
      '${run.runId}'::uuid,
      '${owner}'::uuid,
      ${run.fence}::bigint,
      '${stepKey}',
      ${recordCount}::bigint
    );
  `)).split('|')
  return { completed: completed === 'true', resultCode }
}

function writeRaw(run, owner, tenantId, resourceType, rows) {
  return Number(psql(asServiceRole(`
    select public.upsert_xero_generation_raw_batch(
      '${run.runId}'::uuid,
      '${userId}'::uuid,
      '${tenantId}',
      '${owner}'::uuid,
      ${run.fence}::bigint,
      '${resourceType}',
      '2026-09-15T10:00:00Z'::timestamptz,
      ${json(rows)}
    );
  `)))
}

function writeCanonical(run, owner, tenantId, resourceType, rows) {
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

test(
  'a fully prepared generation remains inactive after heartbeat, persistence, mapping output, and validation',
  { skip: !enabled },
  () => {
    resetFixtures()
    const run = acquire(tenantA, ownerA)
    assert.equal(run.acquired, true)
    assert.equal(run.resultCode, 'acquired')
    assert.deepEqual(heartbeat(run, ownerA), { renewed: true, resultCode: 'renewed' })

    writeRaw(run, ownerA, tenantA, 'organisations', [{
      source_id: tenantA,
      raw_json: { OrganisationID: tenantA, BaseCurrency: 'GBP' },
    }])
    writeRaw(run, ownerA, tenantA, 'contacts', [{
      source_id: 'contact-a',
      raw_json: { ContactID: 'contact-a', Name: 'Contact A' },
    }])
    writeRaw(run, ownerA, tenantA, 'invoices', [{
      source_id: 'invoice-a',
      raw_json: {
        InvoiceID: 'invoice-a',
        Contact: { ContactID: 'contact-a' },
        Type: 'ACCREC',
        Status: 'AUTHORISED',
        CurrencyCode: 'GBP',
        Total: 100,
        AmountDue: 100,
      },
    }])
    writeRaw(run, ownerA, tenantA, 'payments', [])

    writeCanonical(run, ownerA, tenantA, 'organisations', [{
      source_organisation_id: tenantA,
      organisation_name: 'Generation Importer Tenant A',
      base_currency_code: 'GBP',
      source_retrieved_at: '2026-09-15T10:00:00Z',
    }])
    writeCanonical(run, ownerA, tenantA, 'customers', [{
      source_id: 'contact-a',
      name: 'Contact A',
    }])
    writeCanonical(run, ownerA, tenantA, 'invoices', [{
      source_id: 'invoice-a',
      customer_source_id: 'contact-a',
      type: 'ACCREC',
      status: 'AUTHORISED',
      currency_code: 'GBP',
      total: 100,
      amount_due: 100,
      amount_paid: 0,
      amount_credited: 0,
      transaction_currency_code: 'GBP',
      organisation_base_currency_code: 'GBP',
      total_native: 100,
      amount_due_native: 100,
      amount_paid_native: 0,
      amount_credited_native: 0,
      total_base: 100,
      amount_due_base: 100,
      amount_paid_base: 0,
      amount_credited_base: 0,
      currency_conversion_status: 'identity',
    }])

    for (const [stepKey, count] of [
      ['organisation', 1],
      ['contacts', 1],
      ['authorised_accrec_invoices', 1],
      ['paid_accrec_invoices', 0],
      ['authorised_accrec_payments', 0],
      ['canonical_mapping', 3],
      ['validation', 1],
    ]) {
      assert.equal(completeStep(run, ownerA, stepKey, count).completed, true)
    }

    assert.equal(
      psql(`
        select run.status || '|' ||
          count(*) filter (where step.status = 'succeeded')::text || '|' ||
          (state.active_sync_run_id is null)::text || '|' ||
          (state.last_successful_sync_at is null)::text
        from public.xero_sync_runs as run
        join public.xero_sync_run_steps as step on step.sync_run_id = run.id
        join public.xero_sync_tenant_state as state
          on state.user_id = run.user_id and state.tenant_id = run.tenant_id
        where run.id = '${run.runId}'::uuid
        group by run.status, state.active_sync_run_id, state.last_successful_sync_at;
      `),
      'running|7|true|true'
    )
    assert.equal(
      psql(`
        select count(*)::text || '|' ||
          count(*) filter (where sync_run_id = '${run.runId}'::uuid)::text
        from public.canonical_invoices
        where user_id = '${userId}'::uuid and tenant_id = '${tenantA}';
      `),
      '1|1'
    )
  }
)

test(
  'takeover fences stale work while another tenant remains independently writable',
  { skip: !enabled },
  () => {
    resetFixtures()
    const stale = acquire(tenantA, ownerA)
    psql(`
      update public.xero_sync_runs
      set lease_expires_at = now() - interval '1 second'
      where id = '${stale.runId}'::uuid;
    `)
    const currentA = acquire(tenantA, ownerB)
    const currentB = acquire(tenantB, ownerC)

    assert.equal(currentA.acquired, true)
    assert.equal(currentA.fence, stale.fence + 1)
    assert.equal(currentB.acquired, true)
    assert.equal(currentB.fence, 1)
    assert.deepEqual(heartbeat(stale, ownerA), {
      renewed: false,
      resultCode: 'superseded',
    })
    assert.deepEqual(heartbeat(currentB, ownerC), {
      renewed: true,
      resultCode: 'renewed',
    })

    assert.throws(
      () => writeRaw(stale, ownerA, tenantA, 'contacts', [{
        source_id: 'stale-contact',
        raw_json: { ContactID: 'stale-contact' },
      }]),
      /generation write authority rejected/
    )
    assert.equal(writeRaw(currentA, ownerB, tenantA, 'contacts', [{
      source_id: 'contact-a',
      raw_json: { ContactID: 'contact-a' },
    }]), 1)
    assert.equal(writeRaw(currentB, ownerC, tenantB, 'contacts', [{
      source_id: 'contact-b',
      raw_json: { ContactID: 'contact-b' },
    }]), 1)

    assert.equal(
      psql(asServiceRole(`
        select failed::text || '|' || result_code
        from public.fail_xero_sync_run(
          '${currentA.runId}'::uuid,
          '${ownerB}'::uuid,
          ${currentA.fence}::bigint,
          'provider_unavailable',
          'contacts'
        );
      `)),
      'true|failed'
    )
    assert.equal(
      psql(`
        select
          (select status from public.xero_sync_runs where id = '${currentA.runId}'::uuid) || '|' ||
          (select status from public.xero_sync_runs where id = '${currentB.runId}'::uuid) || '|' ||
          (select count(*) from public.xero_raw where source_id = 'stale-contact')::text;
      `),
      'failed|running|0'
    )
  }
)

test(
  'browser roles cannot invoke generation orchestration contracts',
  { skip: !enabled },
  () => {
    assert.equal(
      psql(`
        select array_to_string(array[
          has_function_privilege(
            'authenticated',
            'public.acquire_xero_sync_run(uuid,text,uuid,text,integer)',
            'execute'
          )::text,
          has_function_privilege(
            'anon',
            'public.complete_xero_sync_run_step(uuid,uuid,bigint,text,bigint)',
            'execute'
          )::text,
          has_function_privilege(
            'authenticated',
            'public.upsert_xero_generation_raw_batch(uuid,uuid,text,uuid,bigint,text,timestamptz,jsonb)',
            'execute'
          )::text
        ], '|');
      `),
      'false|false|false'
    )
  }
)

test.after(() => {
  if (enabled) psql(`delete from auth.users where id = '${userId}'::uuid;`)
})
