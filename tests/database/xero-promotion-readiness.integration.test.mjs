import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import test from 'node:test'

const enabled = process.env.RUN_SUPABASE_INTEGRATION === '1'
const databaseContainer = 'supabase_db_yuohme'
const userId = '00000000-0000-4000-8000-00000000e601'
const grantId = '00000000-0000-4000-8000-00000000e602'
const tenantId = '00000000-0000-4000-8000-00000000e603'
const ownerA = '00000000-0000-4000-8000-00000000e611'
const ownerB = '00000000-0000-4000-8000-00000000e622'
const ownerC = '00000000-0000-4000-8000-00000000e633'

function psql(sql) {
  return execFileSync('docker', [
    'exec', '-i', databaseContainer, 'psql', '-X', '-q', '-v', 'ON_ERROR_STOP=1',
    '-U', 'postgres', '-d', 'postgres', '-At', '-F', '|',
  ], { encoding: 'utf8', input: sql }).trim()
}

async function psqlAsync(sql) {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', [
      'exec', '-i', databaseContainer, 'psql', '-X', '-q', '-v', 'ON_ERROR_STOP=1',
      '-U', 'postgres', '-d', 'postgres', '-At', '-F', '|',
    ])
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.on('error', reject)
    child.on('close', (code) => code === 0
      ? resolve(stdout.trim())
      : reject(new Error(stderr.trim() || `psql exited with code ${code}`)))
    child.stdin.end(sql)
  })
}

function asServiceRole(sql) {
  return `begin; set local role service_role; ${sql} commit;`
}

function json(value) {
  return `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`
}

function resetFixtures() {
  psql(`
    delete from auth.users where id = '${userId}'::uuid;
    insert into auth.users (id, aud, role, email, created_at, updated_at)
    values ('${userId}'::uuid, 'authenticated', 'authenticated',
      'xero-readiness@example.test', now(), now());
    insert into public.xero_oauth_grants (
      id, user_id, xero_user_id, scopes, refresh_token_encrypted
    ) values (
      '${grantId}'::uuid,
      '${userId}'::uuid,
      'xero-readiness-user',
      array[
        'offline_access',
        'accounting.settings.read',
        'accounting.contacts.read',
        'accounting.invoices.read',
        'accounting.payments.read'
      ]::text[],
      'integration-test-ciphertext'
    );
    insert into public.xero_connections_public (
      user_id, tenant_id, tenant_name, auth_state, grant_id
    ) values (
      '${userId}'::uuid, '${tenantId}', 'Readiness Tenant', 'active', '${grantId}'::uuid
    );
  `)
}

function acquire(owner) {
  const [acquired, resultCode, runId, fence] = psql(asServiceRole(`
    select acquired::text, result_code, coalesce(sync_run_id::text, ''),
      coalesce(fencing_token::text, '')
    from public.acquire_xero_sync_run(
      '${userId}'::uuid, '${tenantId}', '${owner}'::uuid, 'collections_v1', 300
    );
  `)).split('|')
  return { acquired: acquired === 'true', resultCode, runId, fence: Number(fence) }
}

function completeStep(run, owner, stepKey, count) {
  return psql(asServiceRole(`
    select completed::text || '|' || result_code
    from public.complete_xero_sync_run_step(
      '${run.runId}'::uuid, '${owner}'::uuid, ${run.fence}::bigint, '${stepKey}', ${count}
    );
  `))
}

function prepareRun(options = {}) {
  const owner = options.owner ?? ownerA
  const run = acquire(owner)
  assert.equal(run.acquired, true)
  const currencyCode = options.currencyCode ?? 'GBP'
  const rawRate = options.rawRate
  const conversionStatus = options.conversionStatus ?? (currencyCode === 'GBP' ? 'identity' : 'converted')
  const failureReason = options.failureReason ?? null
  const native = '100'
  const canonicalRate = Object.prototype.hasOwnProperty.call(options, 'canonicalRate')
    ? options.canonicalRate
    : currencyCode === 'GBP' ? null : rawRate
  const base = options.baseAmount ?? (conversionStatus === 'identity'
    ? '100'
    : conversionStatus === 'converted' && Number(rawRate) > 0
      ? (100 / Number(rawRate)).toFixed(8)
      : null)
  const rawInvoice = {
    InvoiceID: 'invoice-a',
    Contact: { ContactID: 'contact-a' },
    Type: 'ACCREC',
    Status: 'AUTHORISED',
    CurrencyCode: currencyCode,
    Total: 100,
    AmountDue: 100,
    AmountPaid: 0,
    AmountCredited: 0,
  }
  if (rawRate !== undefined) rawInvoice.CurrencyRate = rawRate

  psql(asServiceRole(`
    select public.upsert_xero_generation_raw_batch(
      '${run.runId}'::uuid, '${userId}'::uuid, '${tenantId}', '${owner}'::uuid,
      ${run.fence}, 'organisations', now(), ${json([{
        source_id: tenantId,
        raw_json: { OrganisationID: tenantId, BaseCurrency: 'GBP' },
      }])}
    );
    select public.upsert_xero_generation_raw_batch(
      '${run.runId}'::uuid, '${userId}'::uuid, '${tenantId}', '${owner}'::uuid,
      ${run.fence}, 'contacts', now(), ${json([{
        source_id: 'contact-a', raw_json: { ContactID: 'contact-a', Name: 'Contact A' },
      }])}
    );
    select public.upsert_xero_generation_raw_batch(
      '${run.runId}'::uuid, '${userId}'::uuid, '${tenantId}', '${owner}'::uuid,
      ${run.fence}, 'invoices', now(), ${json([{
        source_id: 'invoice-a', raw_json: rawInvoice,
      }])}
    );
    select public.upsert_xero_generation_raw_batch(
      '${run.runId}'::uuid, '${userId}'::uuid, '${tenantId}', '${owner}'::uuid,
      ${run.fence}, 'payments', now(), '[]'::jsonb
    );
    select public.upsert_xero_generation_canonical_batch(
      '${run.runId}'::uuid, '${userId}'::uuid, '${tenantId}', '${owner}'::uuid,
      ${run.fence}, 'organisations', ${json([{
        source_organisation_id: tenantId,
        organisation_name: 'Readiness Tenant',
        base_currency_code: 'GBP',
        source_retrieved_at: '2026-09-16T10:00:00Z',
      }])}
    );
    select public.upsert_xero_generation_canonical_batch(
      '${run.runId}'::uuid, '${userId}'::uuid, '${tenantId}', '${owner}'::uuid,
      ${run.fence}, 'customers', ${json([{ source_id: 'contact-a', name: 'Contact A' }])}
    );
    select public.upsert_xero_generation_canonical_batch(
      '${run.runId}'::uuid, '${userId}'::uuid, '${tenantId}', '${owner}'::uuid,
      ${run.fence}, 'invoices', ${json([{
        source_id: 'invoice-a',
        customer_source_id: 'contact-a',
        type: 'ACCREC',
        status: 'AUTHORISED',
        currency_code: currencyCode,
        total: native,
        amount_due: native,
        amount_paid: 0,
        amount_credited: 0,
        transaction_currency_code: currencyCode,
        organisation_base_currency_code: 'GBP',
        xero_currency_rate: canonicalRate,
        total_native: native,
        amount_due_native: native,
        amount_paid_native: 0,
        amount_credited_native: 0,
        total_base: base,
        amount_due_base: base,
        amount_paid_base: conversionStatus === 'incomplete' ? null : 0,
        amount_credited_base: conversionStatus === 'incomplete' ? null : 0,
        currency_conversion_status: conversionStatus,
        currency_conversion_failure_reason: failureReason,
      }])}
    );
  `))

  for (const [stepKey, count] of [
    ['organisation', 1],
    ['contacts', 1],
    ['authorised_accrec_invoices', 1],
    ['paid_accrec_invoices', 0],
    ['authorised_accrec_payments', 0],
    ['canonical_mapping', 3],
    ['validation', 1],
  ]) {
    assert.equal(completeStep(run, owner, stepKey, count), 'true|completed')
  }
  return { ...run, owner }
}

function inspect(run) {
  return psql(asServiceRole(`
    select ready::text || '|' || result_code || '|' || incomplete_fx_invoice_count::text || '|' || fx_violation_count::text
    from public.inspect_xero_sync_run_readiness(
      '${run.runId}'::uuid, '${userId}'::uuid, '${tenantId}', 'collections_readiness_v2'
    );
  `))
}

function expire(run) {
  psql(`update public.xero_sync_runs set lease_expires_at = now() - interval '1 second' where id = '${run.runId}'::uuid;`)
}

function reacquireSql(run, owner) {
  return asServiceRole(`
    select acquired::text || '|' || result_code || '|' ||
      coalesce(fencing_token::text, '') || '|' || (lease_expires_at is not null)::text
    from public.reacquire_xero_sync_run_for_promotion(
      '${run.runId}'::uuid, '${userId}'::uuid, '${tenantId}', '${owner}'::uuid,
      'collections_readiness_v2', 300
    );
  `)
}

function reacquire(run, owner) {
  return psql(reacquireSql(run, owner))
}

function record(run, owner, fence) {
  return psql(asServiceRole(`
    select validated::text || '|' || result_code || '|' ||
      coalesce(fencing_token::text, '') || '|' || coalesce(incomplete_fx_invoice_count::text, '')
    from public.record_xero_sync_run_readiness(
      '${run.runId}'::uuid, '${userId}'::uuid, '${tenantId}', '${owner}'::uuid,
      ${fence}, 'collections_readiness_v2'
    );
  `))
}

test('current readiness accepts identity and valid foreign conversion', { skip: !enabled }, async (t) => {
  await t.test('GBP identity', () => {
    resetFixtures()
    assert.equal(inspect(prepareRun()), 'true|ready|0|0')
  })
  await t.test('foreign with valid rate', () => {
    resetFixtures()
    assert.equal(inspect(prepareRun({ currencyCode: 'USD', rawRate: '1.25' })), 'true|ready|0|0')
  })
})

test('missing, zero, negative, malformed, and mixed invalid FX fail the whole contract', { skip: !enabled }, async (t) => {
  for (const [label, rawRate, failureReason] of [
    ['missing', undefined, 'missing_rate'],
    ['zero', '0', 'invalid_rate'],
    ['negative', '-1.25', 'invalid_rate'],
    ['malformed', 'not-a-number', 'invalid_rate'],
    ['non-finite text', 'Infinity', 'invalid_rate'],
  ]) {
    await t.test(label, () => {
      resetFixtures()
      const run = prepareRun({
        currencyCode: 'USD',
        rawRate,
        canonicalRate: null,
        conversionStatus: 'incomplete',
        failureReason,
        baseAmount: null,
      })
      assert.equal(inspect(run), 'false|fx_incomplete|1|1')
      assert.equal(
        psql(`select count(*) from public.xero_sync_run_validations where sync_run_id = '${run.runId}'::uuid;`),
        '0'
      )
    })
  }
})

test('old validation step is insufficient; same-run reacquisition advances the fence and records v2 evidence', { skip: !enabled }, () => {
  resetFixtures()
  const run = prepareRun()
  assert.equal(
    psql(`select sync_run.status || '|' || count(*) filter (where step.step_key = 'validation' and step.status = 'succeeded') from public.xero_sync_runs as sync_run join public.xero_sync_run_steps as step on step.sync_run_id = sync_run.id where sync_run.id = '${run.runId}'::uuid group by sync_run.status;`),
    'running|1'
  )
  assert.equal(psql(`select count(*) from public.xero_sync_run_validations where sync_run_id = '${run.runId}'::uuid;`), '0')
  expire(run)
  assert.equal(reacquire(run, ownerB), 'true|reacquired|2|true')
  assert.equal(record(run, ownerB, 2), 'true|validated|2|0')
  assert.equal(
    psql(`select fencing_token::text || '|' || lease_owner::text || '|' || status from public.xero_sync_runs where id = '${run.runId}'::uuid;`),
    `2|${ownerB}|running`
  )
  assert.equal(
    psql(asServiceRole(`select renewed::text || '|' || result_code from public.heartbeat_xero_sync_run('${run.runId}'::uuid, '${ownerA}'::uuid, 1, 300);`)),
    'false|superseded'
  )
  assert.equal(
    psql(`select contract_version || '|' || fencing_token::text || '|' || incomplete_fx_invoice_count::text from public.xero_sync_run_validations where sync_run_id = '${run.runId}'::uuid;`),
    'collections_readiness_v2|2|0'
  )
  assert.equal(
    psql(`select (active_sync_run_id is null)::text || '|' || (last_successful_sync_at is null)::text from public.xero_sync_tenant_state where user_id = '${userId}'::uuid and tenant_id = '${tenantId}';`),
    'true|true'
  )
})

test('concurrent same-run reacquisition has one winner and no stale fence reuse', { skip: !enabled }, async () => {
  resetFixtures()
  const run = prepareRun()
  expire(run)
  const outcomes = await Promise.all([psqlAsync(reacquireSql(run, ownerB)), psqlAsync(reacquireSql(run, ownerC))])
  const codes = outcomes.map((value) => value.split('|')[1]).sort()
  assert.deepEqual(codes, ['lease_held', 'reacquired'])
  assert.equal(psql(`select fencing_token from public.xero_sync_runs where id = '${run.runId}'::uuid;`), '2')
})

test('active-generation drift, terminal runs, live ownership, expiry, and post-reacquisition validation failure are closed', { skip: !enabled }, async (t) => {
  await t.test('live ownership', () => {
    resetFixtures()
    const run = prepareRun()
    assert.match(reacquire(run, ownerB), /^false\|lease_held\|\|true$/)
  })

  await t.test('wrong user, tenant, and run identifiers', () => {
    resetFixtures()
    const run = prepareRun()
    expire(run)
    const wrongUser = '00000000-0000-4000-8000-00000000e688'
    const wrongRun = '00000000-0000-4000-8000-00000000e689'
    assert.match(psql(asServiceRole(`
      select acquired::text || '|' || result_code
      from public.reacquire_xero_sync_run_for_promotion(
        '${run.runId}'::uuid, '${wrongUser}'::uuid, '${tenantId}', '${ownerB}'::uuid,
        'collections_readiness_v2', 300
      );
    `)), /^false\|connection_not_available$/)
    assert.match(psql(asServiceRole(`
      select acquired::text || '|' || result_code
      from public.reacquire_xero_sync_run_for_promotion(
        '${run.runId}'::uuid, '${userId}'::uuid, 'wrong-tenant', '${ownerB}'::uuid,
        'collections_readiness_v2', 300
      );
    `)), /^false\|connection_not_available$/)
    assert.match(psql(asServiceRole(`
      select acquired::text || '|' || result_code
      from public.reacquire_xero_sync_run_for_promotion(
        '${wrongRun}'::uuid, '${userId}'::uuid, '${tenantId}', '${ownerB}'::uuid,
        'collections_readiness_v2', 300
      );
    `)), /^false\|run_not_found$/)
  })

  await t.test('active pointer drift', () => {
    resetFixtures()
    const run = prepareRun()
    const activeId = '00000000-0000-4000-8000-00000000e699'
    psql(`
      insert into public.xero_sync_runs (
        id, user_id, tenant_id, fencing_token, status, scope_version, required_steps,
        completed_at, snapshot_as_of
      ) values (
        '${activeId}'::uuid, '${userId}'::uuid, '${tenantId}', 99, 'succeeded', 'collections_v1',
        array[
          'organisation',
          'contacts',
          'authorised_accrec_invoices',
          'paid_accrec_invoices',
          'authorised_accrec_payments',
          'canonical_mapping',
          'validation'
        ]::text[], now(), now()
      );
      update public.xero_sync_tenant_state
      set active_sync_run_id = '${activeId}'::uuid,
          last_successful_sync_at = now()
      where user_id = '${userId}'::uuid and tenant_id = '${tenantId}';
    `)
    expire(run)
    assert.match(reacquire(run, ownerB), /^false\|active_generation_changed/)
  })

  for (const [status, rpc] of [
    ['failed', `select * from public.fail_xero_sync_run('${'RUN'}'::uuid, '${ownerA}'::uuid, 1, 'provider_unavailable', 'contacts')`],
    ['abandoned', `select * from public.abandon_xero_sync_run('${'RUN'}'::uuid, '${ownerA}'::uuid, 1, 'worker_abandoned')`],
  ]) {
    await t.test(status, () => {
      resetFixtures()
      const run = prepareRun()
      psql(asServiceRole(`${rpc.replace('RUN', run.runId)};`))
      assert.match(reacquire(run, ownerB), /^false\|run_not_eligible/)
    })
  }

  await t.test('already succeeded run', () => {
    resetFixtures()
    const run = prepareRun()
    psql(`
      update public.xero_sync_runs
      set status = 'succeeded',
          completed_at = now(),
          snapshot_as_of = now(),
          lease_owner = null,
          lease_expires_at = null
      where id = '${run.runId}'::uuid;
    `)
    assert.match(reacquire(run, ownerB), /^false\|already_promoted/)
  })

  await t.test('new lease expiry blocks evidence', () => {
    resetFixtures()
    const run = prepareRun()
    expire(run)
    assert.equal(reacquire(run, ownerB), 'true|reacquired|2|true')
    expire(run)
    assert.equal(record(run, ownerB, 2), 'false|lease_expired|2|')
  })

  await t.test('snapshot mutation after reacquisition fails revalidation', () => {
    resetFixtures()
    const run = prepareRun()
    expire(run)
    assert.equal(reacquire(run, ownerB), 'true|reacquired|2|true')
    psql(`
      update public.canonical_invoices
      set currency_conversion_status = 'incomplete',
          currency_conversion_failure_reason = 'missing_rate',
          total_base = null,
          amount_due_base = null,
          amount_paid_base = null,
          amount_credited_base = null
      where sync_run_id = '${run.runId}'::uuid;
    `)
    assert.equal(record(run, ownerB, 2), 'false|fx_incomplete|2|1')
    assert.equal(psql(`select count(*) from public.xero_sync_run_validations where sync_run_id = '${run.runId}'::uuid;`), '0')
  })
})

test('reacquisition and validation infrastructure is service-only with fixed search paths', { skip: !enabled }, () => {
  resetFixtures()
  const privileges = psql(`
    select array_to_string(array[
      has_table_privilege('anon', 'public.xero_sync_run_validations', 'select')::text,
      has_table_privilege('authenticated', 'public.xero_sync_run_validations', 'insert')::text,
      has_table_privilege('service_role', 'public.xero_sync_run_validations', 'select')::text,
      has_table_privilege('service_role', 'public.xero_sync_run_validations', 'insert')::text,
      has_function_privilege('anon', 'public.inspect_xero_sync_run_readiness(uuid,uuid,text,text)', 'execute')::text,
      has_function_privilege('authenticated', 'public.reacquire_xero_sync_run_for_promotion(uuid,uuid,text,uuid,text,integer)', 'execute')::text,
      has_function_privilege('service_role', 'public.record_xero_sync_run_readiness(uuid,uuid,text,uuid,bigint,text)', 'execute')::text
    ], '|');
  `)
  assert.equal(privileges, 'false|false|true|false|false|false|true')
  assert.equal(
    psql(`select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname in ('evaluate_xero_sync_run_readiness_v2','inspect_xero_sync_run_readiness','reacquire_xero_sync_run_for_promotion','record_xero_sync_run_readiness','promote_xero_sync_run') and proconfig @> array['search_path=pg_catalog, public'];`),
    '5'
  )
})

test.after(() => {
  if (enabled) psql(`delete from auth.users where id = '${userId}'::uuid;`)
})
