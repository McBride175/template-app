import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTypeScriptModule } from './test-helpers/ts-module-loader.mjs'
import { promise, payment, cash, observation, valuation } from './test-helpers/promise-evidence-fixture.mjs'
const { preparePromiseReconciliation: prepare, promoteXeroGenerationWithPromises: promote } = loadTypeScriptModule('lib/xero/promise-reconciliation.ts')
const snapshot = (payments = [], cashRows = [], terms = {}, obs = {}) => ({
  evidence_digest: 'a'.repeat(64), promises: [{ ...promise(terms), revision: String(terms.revision ?? 1) }],
  facts: { observation: observation(payments, cashRows, obs), payments, cash: cashRows,
    invoices: [{ ...valuation(), type: 'ACCREC', customer_source_id: 'customer-1' }] },
})
for (const [label, rows, cashRows, obs, decision, paid] of [
  ['partial before deadline', [payment()], [], { started: '2026-09-28T00:00:00Z', completed: '2026-09-28T00:01:00Z' }, 'retain_active', '1000'],
  ['early fulfilment', [payment({ amount_native: '4000' })], [], {}, 'kept', '4000'],
  ['missed', [payment()], [], {}, 'missed', '1000'],
  ['unclear', [payment()], [cash()], {}, 'unclear', '1000'],
  ['deleted', [payment({ payment_status: 'DELETED' })], [], { started: '2026-09-28T00:00:00Z', completed: '2026-09-28T00:01:00Z' }, 'retain_active', '0'],
]) test(`prepared ${label} delegates to certified domain`, () => {
  const result = prepare(snapshot(rows, cashRows, {}, obs)).proposals[0].result
  assert.equal(result.decision, decision)
  assert.equal(result.qualifying_paid_amount_native, paid)
})
test('missing or mismatched invoice context cannot certify payments', () => {
  for (const invoices of [[], [{ ...valuation(), type: 'ACCREC', customer_source_id: 'wrong' }], [{ ...valuation(), type: 'ACCREC', customer_source_id: 'customer-1', currency_code: 'USD' }]]) {
    const held = snapshot([payment({ amount_native: '4000' })]); held.facts.invoices = invoices
    assert.equal(prepare(held).proposals[0].result.payment_evaluation_valid, false)
  }
})
test('unready generation does not become authoritative for Promise decisions', () => {
  const held = snapshot([payment({ amount_native: '4000' })], [], {}, { ready: false, authoritative: false, status: 'candidate' })
  assert.equal(prepare(held).proposals[0].result.decision, 'defer')
  assert.equal(prepare(held).proposals[0].result.payment_evaluation_valid, false)
})
test('safe payment evaluation survives cash-only currency deferral', () => {
  const foreign = cash({ currency_code: 'USD', remaining_credit_base: null, currency_conversion_status: 'incomplete', currency_conversion_failure_reason: 'missing_rate' })
  const result = prepare(snapshot([payment()], [foreign])).proposals[0].result
  assert.equal(result.decision, 'defer'); assert.equal(result.payment_evaluation_valid, true)
  assert.equal(result.qualifying_paid_amount_native, '1000')
})
test('unsafe revision or duplicate Active set rejected before commit', () => {
  const held = snapshot(); held.promises.push(held.promises[0])
  assert.throws(() => prepare(held), /Active/)
  assert.throws(() => prepare(snapshot([], [], { revision: '9007199254740993' })), /Active/)
})
function client(responses) {
  const calls = []
  return { calls, async rpc(name, args) {
    calls.push({ name, args }); const next = responses.shift()
    if (next instanceof Error) throw next
    if (!next) throw new Error('unexpected call')
    return next
  } }
}
const args = supabaseAdmin => ({ supabaseAdmin, syncRunId: 'run-1', leaseOwner: 'lease', fencingToken: 1 })
const success = { data: [{ promoted: true, result_code: 'promoted', promoted_at: '2026-10-01T00:02:00Z' }], error: null }
test('race recomputes same held generation without provider calls', async () => {
  const db = client([{ data: snapshot(), error: null }, { data: [{ promoted: false, result_code: 'promise_state_changed', promoted_at: null }] },
    { data: snapshot([], [], { revision: 2 }), error: null }, success])
  assert.equal((await promote(args(db))).promoted, true)
  assert.equal(db.calls.length, 4)
  assert.equal(db.calls[3].args.p_reconciliation.proposals[0].expected_revision, '2')
})
test('bounded races stop after three preparations', async () => {
  const changed = { data: [{ promoted: false, result_code: 'promise_state_changed', promoted_at: null }] }
  const db = client(Array.from({ length: 3 }, () => [{ data: snapshot() }, changed]).flat())
  assert.equal((await promote(args(db))).promoted, false); assert.equal(db.calls.length, 6)
})
test('ambiguous commit recovers exact successful run without replaying events', async () => {
  const db = client([{ data: snapshot() }, new Error('timeout'), { data: { already_promoted: true, promoted_at: '2026-10-01T00:02:00Z' } }])
  assert.equal((await promote(args(db))).resultCode, 'already_promoted'); assert.equal(db.calls.length, 3)
})
test('failed commit remains failed if candidate was not published', async () => {
  const db = client([{ data: snapshot() }, { error: { code: '23514' } }, { data: snapshot() }])
  await assert.rejects(promote(args(db)), /23514/)
})
test('already committed generation is a read-only no-op', async () => {
  const db = client([{ data: { already_promoted: true, promoted_at: '2026-10-01T00:02:00Z' } }])
  assert.equal((await promote(args(db))).promoted, true); assert.equal(db.calls.length, 1)
})
test('empty Active set skips evidence loading and commits through guarded fast path', async () => {
  const db = client([{ data: { empty_active_set: true, promises: [] } }, success])
  assert.equal((await promote(args(db))).promoted, true)
  assert.equal(db.calls[1].args.p_reconciliation, null)
})
test('new Promise after empty preparation reloads complete set before publication', async () => {
  const db = client([{ data: { empty_active_set: true, promises: [] } }, { data: [{ promoted: false, result_code: 'promise_preparation_required', promoted_at: null }] },
    { data: snapshot() }, success])
  assert.equal((await promote(args(db))).promoted, true)
  assert.equal(db.calls[3].args.p_reconciliation.proposals.length, 1)
})
test('the existing production generation-run entry point uses atomic Promise promotion', async () => {
  const { promoteXeroGenerationRun } = loadTypeScriptModule('lib/xero/generation-run.ts', {
    mocks: { '@/lib/supabase-admin': { createSupabaseAdminClient() { throw new Error('Use injected local client') } } },
  })
  const db = client([{ data: snapshot([payment()]) }, success])
  assert.equal((await promoteXeroGenerationRun(args(db))).promoted, true)
  assert.deepEqual(db.calls.map(call => call.name), ['prepare_invoice_promise_reconciliation', 'promote_xero_sync_run_with_promises'])
  assert.equal(db.calls[1].args.p_reconciliation.proposals[0].result.qualifying_paid_amount_native, '1000')
})
