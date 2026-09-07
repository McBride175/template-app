import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import test from 'node:test'

const enabled = process.env.RUN_SUPABASE_INTEGRATION === '1'
const databaseContainer = 'supabase_db_template-app'
const userA = '00000000-0000-4000-8000-0000000000a1'
const userB = '00000000-0000-4000-8000-0000000000b2'

function psql(sql) {
  return execFileSync(
    'docker',
    [
      'exec',
      '-i',
      databaseContainer,
      'psql',
      '-X',
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

function claimSql(userId, tenantId, usageDate) {
  return `select allowed, usage_days_consumed, usage_date_already_recorded
from public.claim_billing_usage_day(
  '${userId}'::uuid,
  '${tenantId}'::text,
  '${usageDate}'::date,
  5
);`
}

function resetFixtures() {
  psql(`
    delete from public.billing_usage_days
    where user_id in ('${userA}'::uuid, '${userB}'::uuid)
       or tenant_id like 'billing-integration-%';
    delete from public.subscriptions
    where user_id in ('${userA}'::uuid, '${userB}'::uuid);
    delete from public.stripe_customers
    where user_id in ('${userA}'::uuid, '${userB}'::uuid);
    delete from auth.users where id in ('${userA}'::uuid, '${userB}'::uuid);
    insert into auth.users (id, aud, role, email, created_at, updated_at)
    values
      ('${userA}'::uuid, 'authenticated', 'authenticated', 'billing-a@example.test', now(), now()),
      ('${userB}'::uuid, 'authenticated', 'authenticated', 'billing-b@example.test', now(), now());
  `)
}

test(
  'database atomically enforces five user usage dates and permits all requests on day five',
  { skip: !enabled },
  () => {
    resetFixtures()

    assert.equal(psql(claimSql(userA, 'billing-integration-tenant-a', '2026-09-01')), 't|1|t')
    assert.equal(psql(claimSql(userA, 'billing-integration-tenant-a', '2026-09-01')), 't|1|t')
    assert.equal(psql(claimSql(userA, 'billing-integration-tenant-b', '2026-09-01')), 't|1|t')
    assert.equal(psql(claimSql(userA, 'billing-integration-tenant-a', '2026-09-02')), 't|2|t')
    assert.equal(psql(claimSql(userA, 'billing-integration-tenant-a', '2026-09-03')), 't|3|t')
    assert.equal(psql(claimSql(userA, 'billing-integration-tenant-a', '2026-09-04')), 't|4|t')
    assert.equal(psql(claimSql(userA, 'billing-integration-tenant-a', '2026-09-05')), 't|5|t')
    assert.equal(psql(claimSql(userA, 'billing-integration-tenant-a', '2026-09-05')), 't|5|t')
    assert.equal(psql(claimSql(userA, 'billing-integration-tenant-a', '2026-09-06')), 'f|5|f')
    assert.equal(psql(claimSql(userA, 'billing-integration-tenant-new', '2026-09-06')), 'f|5|f')
    assert.equal(psql(claimSql(userB, 'billing-integration-tenant-a', '2026-09-06')), 'f|5|f')
    assert.equal(psql(claimSql(userB, 'billing-integration-tenant-b', '2026-09-06')), 't|1|t')
    assert.equal(psql(claimSql(userA, 'billing-integration-tenant-b', '2026-09-06')), 'f|5|f')
    assert.equal(psql(claimSql(userB, 'billing-integration-tenant-a', '2026-09-06')), 'f|5|f')

    assert.equal(
      psql(`select count(*) from public.billing_usage_days where user_id = '${userA}'::uuid;`),
      '5'
    )

    psql(`delete from auth.users where id = '${userA}'::uuid;`)
    assert.equal(
      psql(`
        select count(*) from public.billing_usage_days
        where tenant_id = 'billing-integration-tenant-a' and user_id is null;
      `),
      '5'
    )
    assert.equal(psql(claimSql(userB, 'billing-integration-tenant-a', '2026-09-06')), 'f|5|f')
  }
)

test(
  'parallel first-use requests create one user/day row and return one consumed day',
  { skip: !enabled },
  async () => {
    resetFixtures()

    const results = await Promise.all(
      Array.from({ length: 12 }, () =>
        psqlAsync(claimSql(userB, 'billing-integration-concurrent', '2026-09-06'))
      )
    )

    assert.deepEqual(new Set(results), new Set(['t|1|t']))
    assert.equal(
      psql(`select count(*) from public.billing_usage_days where user_id = '${userB}'::uuid;`),
      '1'
    )
  }
)

test(
  'browser roles cannot read or mutate billable tables or invoke the usage claim function',
  { skip: !enabled },
  () => {
    resetFixtures()
    psql(`
      insert into public.subscriptions (
        user_id,
        stripe_customer_id,
        stripe_subscription_id,
        stripe_price_id,
        status,
        current_period_end,
        stripe_subscription_created_at
      ) values
        (
          '${userA}'::uuid,
          'cus_billing_rls_a',
          'sub_billing_rls_a',
          'price_basic',
          'active',
          '2026-10-01T00:00:00Z'::timestamptz,
          '2026-09-01T00:00:00Z'::timestamptz
        ),
        (
          '${userB}'::uuid,
          'cus_billing_rls_b',
          'sub_billing_rls_b',
          'price_basic',
          'active',
          '2026-10-01T00:00:00Z'::timestamptz,
          '2026-09-01T00:00:00Z'::timestamptz
        );
    `)

    const privileges = psql(`
      select array_to_string(array[
        has_table_privilege('authenticated', 'public.billing_usage_days', 'select')::text,
        has_table_privilege('authenticated', 'public.billing_usage_days', 'insert')::text,
        has_table_privilege('authenticated', 'public.subscriptions', 'update')::text,
        has_table_privilege('authenticated', 'public.xero_raw', 'select')::text,
        has_table_privilege('authenticated', 'public.canonical_customers', 'select')::text,
        has_table_privilege('authenticated', 'public.customer_overrides', 'insert')::text,
        has_table_privilege('authenticated', 'public.collection_actions', 'insert')::text,
        has_function_privilege(
          'authenticated',
          'public.claim_billing_usage_day(uuid,text,date,integer)',
          'execute'
        )::text
      ], '|');
    `)

    assert.equal(privileges, 'false|false|false|false|false|false|false|false')

    const visibleSubscriptions = psql(`
      begin;
      set local role authenticated;
      set local request.jwt.claim.sub = '${userA}';
      select count(*) || '|' || min(user_id::text)
      from public.subscriptions;
      rollback;
    `)
    assert.ok(visibleSubscriptions.split('\n').includes(`1|${userA}`))
  }
)

test(
  'newer Stripe subscription state wins over duplicate and late older-subscription events',
  { skip: !enabled },
  () => {
    resetFixtures()

    const apply = ({ subscriptionId, status, createdAt }) =>
      psql(`
        select public.apply_stripe_subscription_cache(
          '${userA}'::uuid,
          'cus_billing_integration',
          '${subscriptionId}',
          'price_basic',
          '${status}',
          '2026-10-01T00:00:00Z'::timestamptz,
          '${createdAt}'::timestamptz
        );
      `)

    assert.equal(apply({
      subscriptionId: 'sub_new',
      status: 'active',
      createdAt: '2026-09-06T10:00:00Z',
    }), 't')
    assert.equal(apply({
      subscriptionId: 'sub_new',
      status: 'active',
      createdAt: '2026-09-06T10:00:00Z',
    }), 't')
    assert.equal(apply({
      subscriptionId: 'sub_old',
      status: 'canceled',
      createdAt: '2026-08-01T10:00:00Z',
    }), 'f')

    assert.equal(
      psql(`
        select stripe_subscription_id || '|' || status
        from public.subscriptions
        where user_id = '${userA}'::uuid;
      `),
      'sub_new|active'
    )
  }
)
