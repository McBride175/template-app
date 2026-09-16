import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import test from 'node:test'

const enabled = process.env.RUN_SUPABASE_INTEGRATION === '1'
const databaseContainer = 'supabase_db_template-app'
const userId = '00000000-0000-4000-8000-00000000c201'
const grantId = '00000000-0000-4000-8000-00000000c202'
const tenantId = 'xero-generation-integration-tenant'
const ownerA = '00000000-0000-4000-8000-00000000c2a1'
const ownerB = '00000000-0000-4000-8000-00000000c2b2'
const ownerC = '00000000-0000-4000-8000-00000000c2c3'

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

async function psqlAsync(sql) {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', [
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
    ])
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve(stdout.trim())
      else reject(new Error(stderr.trim() || `psql exited with code ${code}`))
    })
    child.stdin.end(sql)
  })
}

function asServiceRole(sql) {
  return `
    begin;
    set local role service_role;
    ${sql}
    commit;
  `
}

function resetFixtures() {
  psql(`
    delete from auth.users where id = '${userId}'::uuid;
    insert into auth.users (id, aud, role, email, created_at, updated_at)
    values (
      '${userId}'::uuid,
      'authenticated',
      'authenticated',
      'xero-generation@example.test',
      now(),
      now()
    );
    insert into public.xero_oauth_grants (
      id,
      user_id,
      xero_user_id,
      scopes,
      refresh_token_encrypted
    ) values (
      '${grantId}'::uuid,
      '${userId}'::uuid,
      'xero-generation-user',
      array['accounting.transactions.read']::text[],
      'integration-test-ciphertext'
    );
    insert into public.xero_connections_public (
      user_id,
      tenant_id,
      tenant_name,
      auth_state,
      grant_id
    ) values (
      '${userId}'::uuid,
      '${tenantId}',
      'Generation Test Tenant',
      'active',
      '${grantId}'::uuid
    );
  `)
}

function acquireSql(owner) {
  return asServiceRole(`
    select
      acquired::text,
      result_code,
      coalesce(sync_run_id::text, ''),
      coalesce(fencing_token::text, ''),
      (lease_expires_at is not null)::text
    from public.acquire_xero_sync_run(
      '${userId}'::uuid,
      '${tenantId}',
      '${owner}'::uuid,
      'collections_v1',
      300
    );
  `)
}

function acquire(owner) {
  const [acquired, resultCode, runId, fence, hasExpiry] = psql(acquireSql(owner)).split('|')
  return {
    acquired: acquired === 'true',
    resultCode,
    runId: runId || null,
    fence: fence ? Number(fence) : null,
    hasExpiry: hasExpiry === 'true',
  }
}

function heartbeat(runId, owner, fence) {
  const [renewed, resultCode, hasExpiry] = psql(asServiceRole(`
    select renewed::text, result_code, (lease_expires_at is not null)::text
    from public.heartbeat_xero_sync_run(
      '${runId}'::uuid,
      '${owner}'::uuid,
      ${fence}::bigint,
      300
    );
  `)).split('|')
  return { renewed: renewed === 'true', resultCode, hasExpiry: hasExpiry === 'true' }
}

function completeStep(runId, owner, fence, stepKey, recordCount) {
  const [completed, resultCode] = psql(asServiceRole(`
    select completed::text, result_code
    from public.complete_xero_sync_run_step(
      '${runId}'::uuid,
      '${owner}'::uuid,
      ${fence}::bigint,
      '${stepKey}',
      ${recordCount}::bigint
    );
  `)).split('|')
  return { completed: completed === 'true', resultCode }
}

function completeManifest(runId, owner, fence) {
  const counts = new Map([
    ['organisation', 1],
    ['contacts', 3],
    ['authorised_accrec_invoices', 4],
    ['paid_accrec_invoices', 5],
    ['authorised_accrec_payments', 6],
    ['canonical_mapping', 19],
    ['validation', 0],
  ])
  for (const [stepKey, recordCount] of counts) {
    assert.deepEqual(
      completeStep(runId, owner, fence, stepKey, recordCount),
      { completed: true, resultCode: 'completed' }
    )
  }
}

function promote(runId, owner, fence) {
  const [promoted, resultCode, hasTimestamp] = psql(asServiceRole(`
    select promoted::text, result_code, (promoted_at is not null)::text
    from public.promote_xero_sync_run(
      '${runId}'::uuid,
      '${owner}'::uuid,
      ${fence}::bigint,
      '2026-09-15T05:00:00Z'::timestamptz
    );
  `)).split('|')
  return {
    promoted: promoted === 'true',
    resultCode,
    hasTimestamp: hasTimestamp === 'true',
  }
}

function failRun(runId, owner, fence, errorCode = 'provider_timeout', resource = 'contacts') {
  const [failed, resultCode] = psql(asServiceRole(`
    select failed::text, result_code
    from public.fail_xero_sync_run(
      '${runId}'::uuid,
      '${owner}'::uuid,
      ${fence}::bigint,
      '${errorCode}',
      '${resource}'
    );
  `)).split('|')
  return { failed: failed === 'true', resultCode }
}

function abandonRun(runId, owner, fence) {
  const [abandoned, resultCode] = psql(asServiceRole(`
    select abandoned::text, result_code
    from public.abandon_xero_sync_run(
      '${runId}'::uuid,
      '${owner}'::uuid,
      ${fence}::bigint,
      'worker_abandoned'
    );
  `)).split('|')
  return { abandoned: abandoned === 'true', resultCode }
}

test(
  'concurrent acquisition creates one authoritative lease and a monotonic fence',
  { skip: !enabled },
  async () => {
    resetFixtures()

    const results = await Promise.all([
      psqlAsync(acquireSql(ownerA)),
      psqlAsync(acquireSql(ownerB)),
    ])
    const parsed = results.map((result) => result.split('|'))

    assert.deepEqual(parsed.map((row) => row[0]).sort(), ['false', 'true'])
    assert.deepEqual(parsed.map((row) => row[1]).sort(), ['acquired', 'lease_held'])
    assert.equal(
      psql(`
        select count(*) || '|' || min(fencing_token)::text || '|' || max(fencing_token)::text
        from public.xero_sync_runs
        where user_id = '${userId}'::uuid and tenant_id = '${tenantId}';
      `),
      '1|1|1'
    )

    const ownedRow = parsed.find((row) => row[0] === 'true')
    const ownedBy = results[0] === parsed[0].join('|') && parsed[0][0] === 'true' ? ownerA : ownerB
    const sameOwner = acquire(ownedBy)
    assert.equal(sameOwner.acquired, true)
    assert.equal(sameOwner.resultCode, 'already_owned')
    assert.equal(sameOwner.runId, ownedRow[2])
    assert.equal(sameOwner.fence, 1)
  }
)

test(
  'expired ownership can be superseded and the stale worker cannot renew, fail, or promote',
  { skip: !enabled },
  () => {
    resetFixtures()
    const first = acquire(ownerA)
    assert.deepEqual(
      { acquired: first.acquired, resultCode: first.resultCode, fence: first.fence },
      { acquired: true, resultCode: 'acquired', fence: 1 }
    )

    psql(`
      update public.xero_sync_runs
      set lease_expires_at = now() - interval '1 second'
      where id = '${first.runId}'::uuid;
    `)
    assert.deepEqual(heartbeat(first.runId, ownerA, first.fence), {
      renewed: false,
      resultCode: 'lease_expired',
      hasExpiry: false,
    })

    const second = acquire(ownerB)
    assert.equal(second.acquired, true)
    assert.equal(second.fence, 2)
    assert.equal(
      psql(`select status || '|' || error_code from public.xero_sync_runs where id = '${first.runId}'::uuid;`),
      'abandoned|lease_expired'
    )

    assert.deepEqual(heartbeat(first.runId, ownerA, first.fence), {
      renewed: false,
      resultCode: 'superseded',
      hasExpiry: false,
    })
    assert.deepEqual(failRun(first.runId, ownerA, first.fence), {
      failed: false,
      resultCode: 'superseded',
    })
    assert.deepEqual(promote(first.runId, ownerA, first.fence), {
      promoted: false,
      resultCode: 'superseded',
      hasTimestamp: false,
    })

    assert.deepEqual(heartbeat(second.runId, ownerC, second.fence), {
      renewed: false,
      resultCode: 'wrong_lease_owner',
      hasExpiry: false,
    })
    assert.deepEqual(heartbeat(second.runId, ownerB, first.fence), {
      renewed: false,
      resultCode: 'superseded',
      hasExpiry: false,
    })
    assert.deepEqual(heartbeat(second.runId, ownerB, second.fence), {
      renewed: true,
      resultCode: 'renewed',
      hasExpiry: true,
    })
  }
)

test(
  'owned runs fail or abandon safely and store only constrained classifications',
  { skip: !enabled },
  () => {
    resetFixtures()
    const first = acquire(ownerA)

    assert.deepEqual(failRun(first.runId, ownerB, first.fence), {
      failed: false,
      resultCode: 'wrong_lease_owner',
    })
    assert.deepEqual(failRun(first.runId, ownerA, first.fence), {
      failed: true,
      resultCode: 'failed',
    })
    assert.deepEqual(promote(first.runId, ownerA, first.fence), {
      promoted: false,
      resultCode: 'run_not_running',
      hasTimestamp: false,
    })
    assert.equal(
      psql(`
        select status || '|' || error_code || '|' || error_resource || '|' ||
          (failed_at is not null)::text || '|' || (lease_owner is null)::text
        from public.xero_sync_runs where id = '${first.runId}'::uuid;
      `),
      'failed|provider_timeout|contacts|true|true'
    )

    assert.throws(
      () => failRun(first.runId, ownerA, first.fence, 'raw provider body!', 'contacts'),
      /Xero sync failure input is invalid/
    )

    const second = acquire(ownerB)
    assert.equal(second.fence, 2)
    assert.deepEqual(abandonRun(second.runId, ownerB, second.fence), {
      abandoned: true,
      resultCode: 'abandoned',
    })
    assert.equal(
      psql(`select status || '|' || error_code from public.xero_sync_runs where id = '${second.runId}'::uuid;`),
      'abandoned|worker_abandoned'
    )
  }
)

test(
  'promotion remains blocked when current readiness evidence and coherent generated data are absent',
  { skip: !enabled },
  () => {
    resetFixtures()
    const first = acquire(ownerA)

    assert.deepEqual(promote(first.runId, ownerA, first.fence), {
      promoted: false,
      resultCode: 'manifest_incomplete',
      hasTimestamp: false,
    })
    assert.equal(
      psql(`
        select (active_sync_run_id is null)::text || '|' ||
          (last_successful_sync_at is null)::text
        from public.xero_sync_tenant_state
        where user_id = '${userId}'::uuid and tenant_id = '${tenantId}';
      `),
      'true|true'
    )

    assert.deepEqual(completeStep(first.runId, ownerB, first.fence, 'organisation', 1), {
      completed: false,
      resultCode: 'wrong_lease_owner',
    })
    completeManifest(first.runId, ownerA, first.fence)
    assert.deepEqual(completeStep(first.runId, ownerA, first.fence, 'organisation', 1), {
      completed: true,
      resultCode: 'already_completed',
    })
    assert.deepEqual(completeStep(first.runId, ownerA, first.fence, 'organisation', 2), {
      completed: false,
      resultCode: 'record_count_conflict',
    })
    assert.deepEqual(promote(first.runId, ownerB, first.fence), {
      promoted: false,
      resultCode: 'wrong_lease_owner',
      hasTimestamp: false,
    })

    assert.deepEqual(promote(first.runId, ownerA, first.fence), {
      promoted: false,
      resultCode: 'manifest_incomplete',
      hasTimestamp: false,
    })
    assert.equal(psql(`
      select (active_sync_run_id is null)::text || '|' ||
        latest_sync_run_id::text || '|' || current_fencing_token::text || '|' ||
        (last_successful_sync_at is null)::text
      from public.xero_sync_tenant_state
      where user_id = '${userId}'::uuid and tenant_id = '${tenantId}';
    `), `true|${first.runId}|1|true`)
    assert.deepEqual(failRun(first.runId, ownerA, first.fence), {
      failed: true,
      resultCode: 'failed',
    })
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
  'a stale worker cannot displace a newer tenant owner after takeover',
  { skip: !enabled },
  () => {
    resetFixtures()
    const first = acquire(ownerA)
    psql(`
      update public.xero_sync_runs
      set lease_expires_at = now() - interval '1 second'
      where id = '${first.runId}'::uuid;
    `)
    const second = acquire(ownerB)
    completeManifest(second.runId, ownerB, second.fence)
    assert.deepEqual(promote(second.runId, ownerB, second.fence), {
      promoted: false,
      resultCode: 'manifest_incomplete',
      hasTimestamp: false,
    })

    assert.deepEqual(promote(first.runId, ownerA, first.fence), {
      promoted: false,
      resultCode: 'superseded',
      hasTimestamp: false,
    })
    assert.equal(
      psql(`
        select (active_sync_run_id is null)::text || '|' || current_fencing_token::text
        from public.xero_sync_tenant_state
        where user_id = '${userId}'::uuid and tenant_id = '${tenantId}';
      `),
      'true|2'
    )
  }
)

test(
  'legacy NULL-generation rows stay readable but cannot constitute a verified snapshot',
  { skip: !enabled },
  () => {
    resetFixtures()
    psql(`
      insert into public.xero_raw (
        user_id, tenant_id, resource_type, source_id, raw_json
      ) values (
        '${userId}'::uuid, '${tenantId}', 'contacts', 'legacy-contact', '{}'::jsonb
      );
      insert into public.canonical_customers (
        user_id, tenant_id, source_system, source_id, name
      ) values (
        '${userId}'::uuid, '${tenantId}', 'xero', 'legacy-contact', 'Legacy Contact'
      );
    `)

    assert.equal(
      psql(`
        select
          (select count(*) from public.xero_raw
           where user_id = '${userId}'::uuid and sync_run_id is null)::text || '|' ||
          (select count(*) from public.canonical_customers
           where user_id = '${userId}'::uuid and sync_run_id is null)::text || '|' ||
          (select count(*) from public.xero_sync_tenant_state
           where user_id = '${userId}'::uuid and active_sync_run_id is not null)::text;
      `),
      '1|1|0'
    )
  }
)

test(
  'generation ownership is tenant-safe and connection deletion cascades run data cleanly',
  { skip: !enabled },
  () => {
    resetFixtures()
    const run = acquire(ownerA)

    assert.throws(
      () => psql(`
        insert into public.xero_raw (
          user_id, tenant_id, resource_type, source_id, raw_json, sync_run_id
        ) values (
          '${userId}'::uuid,
          'wrong-tenant',
          'contacts',
          'wrong-tenant-contact',
          '{}'::jsonb,
          '${run.runId}'::uuid
        );
      `),
      /xero_raw_sync_run_fkey/
    )

    psql(`
      insert into public.xero_raw (
        user_id, tenant_id, resource_type, source_id, raw_json, sync_run_id
      ) values (
        '${userId}'::uuid,
        '${tenantId}',
        'contacts',
        'generation-contact',
        '{}'::jsonb,
        '${run.runId}'::uuid
      );
      delete from public.xero_connections_public
      where user_id = '${userId}'::uuid and tenant_id = '${tenantId}';
    `)

    assert.equal(
      psql(`
        select
          (select count(*) from public.xero_sync_tenant_state
           where user_id = '${userId}'::uuid)::text || '|' ||
          (select count(*) from public.xero_sync_runs
           where user_id = '${userId}'::uuid)::text || '|' ||
          (select count(*) from public.xero_raw
           where user_id = '${userId}'::uuid and source_id = 'generation-contact')::text;
      `),
      '0|0|0'
    )
  }
)

test(
  'browser roles cannot access run infrastructure and service role cannot bypass RPC mutations',
  { skip: !enabled },
  () => {
    resetFixtures()

    const privileges = psql(`
      select array_to_string(array[
        has_table_privilege('anon', 'public.xero_sync_tenant_state', 'select')::text,
        has_table_privilege('authenticated', 'public.xero_sync_runs', 'select')::text,
        has_table_privilege('authenticated', 'public.xero_sync_run_steps', 'insert')::text,
        has_table_privilege('service_role', 'public.xero_sync_runs', 'select')::text,
        has_table_privilege('service_role', 'public.xero_sync_runs', 'insert')::text,
        has_table_privilege('service_role', 'public.xero_sync_runs', 'update')::text,
        has_function_privilege(
          'anon',
          'public.acquire_xero_sync_run(uuid,text,uuid,text,integer)',
          'execute'
        )::text,
        has_function_privilege(
          'authenticated',
          'public.promote_xero_sync_run(uuid,uuid,bigint,timestamptz)',
          'execute'
        )::text,
        has_function_privilege(
          'service_role',
          'public.promote_xero_sync_run(uuid,uuid,bigint,timestamptz)',
          'execute'
        )::text
      ], '|');
    `)
    assert.equal(privileges, 'false|false|false|true|false|false|false|false|true')

    assert.throws(
      () => psql(`
        begin;
        set local role authenticated;
        select * from public.xero_sync_runs;
        commit;
      `),
      /permission denied/
    )
    assert.throws(
      () => psql(`
        begin;
        set local role anon;
        select * from public.acquire_xero_sync_run(
          '${userId}'::uuid,
          '${tenantId}',
          '${ownerA}'::uuid,
          'collections_v1',
          300
        );
        commit;
      `),
      /permission denied/
    )
    assert.throws(
      () => psql(`
        begin;
        set local role service_role;
        insert into public.xero_sync_runs (
          user_id, tenant_id, fencing_token, status, scope_version, required_steps
        ) values (
          '${userId}'::uuid,
          '${tenantId}',
          1,
          'running',
          'collections_v1',
          array['validation']::text[]
        );
        commit;
      `),
      /permission denied/
    )

    assert.equal(
      psql(`
        select count(*) from pg_policies
        where schemaname = 'public'
          and tablename in (
            'xero_sync_tenant_state',
            'xero_sync_runs',
            'xero_sync_run_steps'
          );
      `),
      '0'
    )
  }
)

test.after(() => {
  if (enabled) {
    psql(`delete from auth.users where id = '${userId}'::uuid;`)
  }
})
