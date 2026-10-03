// Opt-in disposable local scale measurement; no hosted/provider activity.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import * as db from './test-helpers/dependency-database-fixture.mjs'
import { cert } from './test-helpers/materialization-client.mjs'
import { client, parameters, portfolio } from './test-helpers/portfolio-client.mjs'
import { loadTypeScriptModule } from '../xero/test-helpers/ts-module-loader.mjs'

if (process.env.RUN_SUPABASE_INTEGRATION !== '1') throw new Error('Disposable local opt-in required')
const { readCollectionQueueProjection } = loadTypeScriptModule('lib/collections/fast-queue-projection-server.ts')
const results = []
try {
  db.setup()
  for (const n of [100, 1000, 10000]) {
    db.reset()
    const run = db.ready({ invoiceChanges: { due_date: '2026-09-01' } })
    db.psql(`insert into public.canonical_customers
      select (jsonb_populate_record(null::public.canonical_customers,
        to_jsonb(c)||jsonb_build_object('id',gen_random_uuid(),
        'source_id','customer-'||lpad(s::text,5,'0'),'is_customer',true))).*
      from public.canonical_customers c cross join generate_series(1,${n}) s where c.source_id='c1';
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
      from public.canonical_invoices i cross join generate_series(1,${n}) s
        cross join generate_series(1,5) j where i.source_id='i1';
      insert into public.canonical_payments(user_id,tenant_id,source_system,sync_run_id,
        source_id,customer_source_id,invoice_source_id,payment_date)
      select '${db.user}','tenant-a','xero','${run.run}','payment-'||s,
        'customer-'||lpad(s::text,5,'0'),
        'invoice-'||lpad(s::text,5,'0')||'-1','2026-09-20'
      from generate_series(1,${n}) s;
      delete from public.canonical_invoices where source_id='i1';
      delete from public.canonical_customers where source_id='c1';`)
    cert(db, run.run)
    const admin = client(db)
    await portfolio.ensurePortfolioBaseCalculation(parameters(db, admin))
    const params = { admin, userId: db.user, tenantId: 'tenant-a',
      evaluationInstant: new Date('2026-10-01T12:00:00Z'),
      overdueOnly: true, limit: 50, legacyTodayDateIso: '2026-10-01' }
    async function measure(name) {
      const offset = admin.calls.length, start = performance.now()
      const projection = await readCollectionQueueProjection(params)
      const calls = admin.calls.slice(offset), totalMs = performance.now() - start
      assert.equal(projection.metrics.calculationRebuilt, false)
      assert.equal(calls.filter(call => call.name === 'read_collection_queue_projection_inputs').length, 1)
      assert.equal(calls.filter(call => call.name === 'read_collection_queue_projection_details').length, 1)
      const rowBytes = Buffer.byteLength(JSON.stringify(projection.rows))
      return { name, totalMs, databaseExecutionMs: calls.reduce((s, c) => s + c.databaseMs, 0),
        databaseWaitMs: projection.metrics.databaseWaitMs, projectionCpuAndDecodeMs: totalMs - projection.metrics.databaseWaitMs,
        rpcCount: calls.length, databasePayloadBytes: calls.reduce((s, c) => s + c.bytes, 0),
        browserRowPayloadBytes: rowBytes, rowsReturned: projection.rows.length,
        customersExamined: projection.metrics.customersExamined,
        calculationId: projection.version.financialCalculationId,
        projectionRevision: projection.version.projectionRevision }
    }
    function write(sql) {
      const started = performance.now()
      db.psql(sql)
      return performance.now() - started
    }
    const warm = await measure('warm-queue')
    const priorityWriteMs = write(db.override('priority', 'customer-00001'))
    const priority = await measure('priority')
    priority.mutationWriteMs = priorityWriteMs
    priority.localWritePlusProjectionMs = priorityWriteMs + priority.totalMs
    const normalWriteMs = write("delete from public.customer_overrides where customer_source_id='customer-00001';")
    const normal = await measure('restore-normal')
    normal.mutationWriteMs = normalWriteMs
    normal.localWritePlusProjectionMs = normalWriteMs + normal.totalMs
    const actionId = randomUUID()
    const actionWriteMs = write(db.action(actionId, 'customer-00001'))
    const action = await measure('action-create')
    action.mutationWriteMs = actionWriteMs
    action.localWritePlusProjectionMs = actionWriteMs + action.totalMs
    const undoWriteMs = write(`delete from public.collection_actions where id='${actionId}';`)
    const undo = await measure('action-undo')
    undo.mutationWriteMs = undoWriteMs
    undo.localWritePlusProjectionMs = undoWriteMs + undo.totalMs
    assert.equal(new Set([warm, priority, normal, action, undo].map(x => x.calculationId)).size, 1)
    const result = { customers: n, invoices: 5 * n, rowsStored: Number(db.psql('select count(*) from public.collection_portfolio_base_scores;')),
      journeys: [warm, priority, normal, action, undo] }
    results.push(result)
    console.log(JSON.stringify(result))
    writeFileSync('/tmp/yuohme-phase35/scale.json', JSON.stringify(results, null, 2))
  }
} finally { db.cleanup() }
