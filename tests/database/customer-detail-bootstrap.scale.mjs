// Disposable local database measurement; never runs against hosted Supabase.
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import * as db from './test-helpers/dependency-database-fixture.mjs'
import { databaseClient, params, server, cert } from './test-helpers/materialization-client.mjs'
import { loadTypeScriptModule } from '../xero/test-helpers/ts-module-loader.mjs'

if (process.env.RUN_SUPABASE_INTEGRATION !== '1') throw new Error('Disposable local opt-in required')
const date = new Date().toISOString().slice(0, 10)
const detailService = loadTypeScriptModule('lib/collections/customer-detail-bootstrap-server.ts')
const results = []
try {
  db.setup()
  for (const [customers, selectedInvoiceCount] of [[100, 5], [1000, 5], [10000, 5],
    [1000, 100], [1000, 1000]]) {
    db.reset()
    const run = db.ready({ invoiceChanges: { due_date: '2026-09-01' } })
    db.psql(`insert into public.canonical_customers
      select (jsonb_populate_record(null::public.canonical_customers,
        to_jsonb(c)||jsonb_build_object('id',gen_random_uuid(),
        'source_id','customer-'||lpad(s::text,5,'0'),'is_customer',true))).*
      from public.canonical_customers c cross join generate_series(1,${customers}) s where c.source_id='c1';
      insert into public.canonical_invoices
      select (jsonb_populate_record(null::public.canonical_invoices,
        to_jsonb(i)||jsonb_build_object('id',gen_random_uuid(),
        'source_id','invoice-'||lpad(s::text,5,'0')||'-'||j,
        'customer_source_id','customer-'||lpad(s::text,5,'0'),
        'status',case when j>2 then 'PAID' else 'AUTHORISED' end,
        'issue_date','2026-07-01','due_date','2026-09-01',
        'fully_paid_date',case when j>2 then '2026-09-10' else null end,
        'total_native','100','amount_paid_native',case when j>2 then '100' else '10' end,
        'amount_due_native',case when j>2 then '0' else '90' end,
        'amount_due_base',case when j>2 then '0' else '90' end))).*
      from public.canonical_invoices i cross join generate_series(1,${customers}) s
        cross join lateral generate_series(1,case when s=1 then ${selectedInvoiceCount} else 5 end) j
      where i.source_id='i1';
      delete from public.canonical_invoices where source_id='i1';
      delete from public.canonical_customers where source_id='c1';`)
    cert(db, run.run)
    const admin = databaseClient(db)
    const selected = 'customer-00001'
    const prepared = params(db, admin, `${date}T12:00:00Z`)
    await server.ensureCustomerFinancialFeatures({ ...prepared, customerSourceId: selected })
    const start = performance.now(), before = admin.calls.length
    const { data, error } = await admin.rpc('read_collection_customer_detail_bootstrap', {
      p_user_id: db.user, p_tenant_id: 'tenant-a', p_customer_source_id: selected,
      p_evaluation_date: date,
    })
    const totalMs = performance.now() - start
    assert.equal(error, null)
    assert.equal(data.ready, true)
    assert.equal(data.invoices.length, selectedInvoiceCount)
    const calls = admin.calls.slice(before)
    assert.equal(calls.length, 1)
    const serviceBefore = admin.calls.length, serviceStarted = performance.now()
    const projected = await detailService.readCustomerDetailBootstrap({ admin,
      userId: db.user, tenantId: 'tenant-a', customerSourceId: selected,
      evaluationInstant: new Date() })
    const serviceTotalMs = performance.now() - serviceStarted
    const serviceCalls = admin.calls.slice(serviceBefore)
    assert.equal(serviceCalls.length, 2)
    assert.equal(projected.metrics.featureRebuilt, false)
    assert.equal(projected.invoices.length, 2)
    results.push({ customers, invoices: (customers - 1) * 5 + selectedInvoiceCount,
      selectedInvoices: data.invoices.length,
      totalMs, databaseExecutionMs: calls[0].databaseMs,
      databaseTransportAndDecodeMs: totalMs - calls[0].databaseMs,
      rpcCount: calls.length, responseBytes: Buffer.byteLength(JSON.stringify(data)),
      serviceTotalMs, serviceDatabaseWaitMs: projected.metrics.databaseWaitMs,
      serviceRpcCount: serviceCalls.length, projectedInvoiceRows: projected.invoices.length,
      browserPayloadBytes: Buffer.byteLength(JSON.stringify(projected)),
      unrelatedInvoiceRowsReturned: 0, canonicalFeatureRebuildReads: 0 })
    console.log(JSON.stringify(results.at(-1)))
    writeFileSync('/tmp/yuohme-phase36/customer-detail-scale.json', JSON.stringify(results, null, 2))
  }
} finally { db.cleanup() }
