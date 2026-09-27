import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTypeScriptModule } from './test-helpers/ts-module-loader.mjs'
import { promise, payment, observation } from './test-helpers/promise-evidence-fixture.mjs'
const command = '00000000-0000-4000-8000-000000000001'
const mocks = {
 '@/lib/supabase-server': { createServerSupabaseClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: 'user-1' } } }) } }) },
 '@/lib/supabase-admin': { createSupabaseAdminClient: () => ({}) },
 '@/lib/billing/entitlements': { claimActionsEntitlementStatus: async () => ({ tenantId: 'tenant-1', hasActionsAccess: true }) },
 '@/lib/billing/collections-access': { resolveCollectionsCurrencyAccess: () => ({ allowed: true }) },
 '@/lib/collections/currency-context-server': { loadCollectionsCurrencyContext: async () => ({}) },
 '@/lib/xero/authoritative-snapshot': { resolveXeroAuthoritativeSnapshot: async () => ({}) },
}
const domain = loadTypeScriptModule('lib/collections/invoice-promises-server.ts', { mocks })
const { parsePromiseRequest: parse, planPromiseMutation: plan } = domain
const create = (overrides = {}) => ({ tenantId: 'tenant-1', commandId: command, operation: 'create', invoiceSourceId: 'invoice-1', amount: '4000', promisedDate: '2026-09-30', ...overrides })
const edit = (overrides = {}) => ({ tenantId: 'tenant-1', commandId: command, operation: 'edit', promiseId: command, expectedRevision: '1', ...overrides })
function held(overrides = {}) {
 const payments = [payment(), payment({ source_id: 'other', invoice_source_id: 'unrelated' })]
 return { sync_run_id: 'run-1', digest: 'a'.repeat(64), invoice: { user_id: 'user-1', tenant_id: 'tenant-1', source_system: 'xero', source_id: 'invoice-1', customer_source_id: 'customer-1', type: 'ACCREC', status: 'AUTHORISED', amount_due_native: '9000', transaction_currency_code: 'GBP', organisation_base_currency_code: 'GBP', xero_currency_rate: null, currency_conversion_status: 'identity', sync_run_id: 'run-1' },
 promise: null, observation: observation(payments, [], { started: '2026-09-29T00:00:00Z', completed: '2026-09-29T00:01:00Z' }), payment_ids: ['payment-1'], evidence: { payments, cash: [] }, ...overrides }
}
const now = '2026-09-29T12:00:00Z'
for (const amount of ['4000','9000','0.00000000000000000001']) test(`create exact fixed amount ${amount} and baseline`, () => {
 const result = plan(held(), parse(create({ amount })).intent, now)
 assert.equal(result.steps[0].payload.promised_amount_native, amount)
 assert.deepEqual(result.steps[0].payload.payment_baseline.payment_ids, ['payment-1'])
 assert.equal(result.steps[0].payload.creation_sync_run_id, 'run-1')
 assert.equal('qualifying_paid_amount_native' in result.steps[0].payload, false)
})
for (const amount of [0,'0','',null,'   ','-1','1e3',1,'10000']) test(`invalid creation amount ${JSON.stringify(amount)}`, () => assert.throws(() => plan(held(), parse(create({ amount })).intent, now)))
for (const date of ['2026-09-29','2026-09-30','2027-01-01']) test(`today/future date ${date} accepted`, () => assert.equal(plan(held(), parse(create({ promisedDate: date })).intent, now).steps.length, 1))
test('past local date rejected; timezone is organisation-local rather than UTC', () => {
 assert.throws(() => plan(held(), parse(create({ promisedDate: '2026-09-28' })).intent, now))
 assert.throws(() => plan(held(), parse(create({ promisedDate: '2026-09-29' })).intent, '2026-09-29T23:30:00Z'))
})
for (const [name, change] of [['missing', { invoice: null }], ['settled', { invoice: { ...held().invoice, status: 'PAID', amount_due_native: '0' } }], ['currency', { invoice: { ...held().invoice, transaction_currency_code: 'BAD!' } }], ['timezone', { observation: { ...held().observation, timezone_iana: null } }], ['unready', { observation: { ...held().observation, ready: false } }]]) test(`create rejects ${name} context`, () => assert.throws(() => plan(held(change), parse(create()).intent, now)))
test('disputed amount does not reduce creation maximum', () => assert.equal(plan(held(), parse(create({ amount: '9000' })).intent, now).steps[0].payload.promised_amount_native, '9000'))
for (const amount of [0,'0','0.00','','   ',null]) test(`cancel semantics ${JSON.stringify(amount)}`, () => {
 const intent = parse(edit({ amount })).intent
 assert.equal(intent.operation, 'cancel')
 const result = plan(held({ promise: { ...promise(), revision: '1', note: null } }), intent, now)
 assert.deepEqual(result.steps, [{ operation: 'cancel', payload: {} }])
})
test('omitted amount means note-only and no evidence work', () => {
 const intent = parse(edit({ note: '  hello  ' })).intent
 assert.equal(intent.operation, 'edit'); assert.equal('amount' in intent, false)
 const result = plan(held({ promise: { ...promise(), revision: '1', note: null }, evidence: null }), intent, now)
 assert.deepEqual(result.steps, [{ operation: 'change_note', payload: { note: 'hello' } }])
})
for (const status of ['kept','missed','unclear','cancelled']) test(`terminal ${status} cannot edit/cancel`, () => {
 const context = held({ promise: { ...promise({ status }), revision: '1' } })
 assert.throws(() => plan(context, parse(edit({ amount: '3000' })).intent, now))
 assert.throws(() => plan(context, parse(edit({ amount: '0' })).intent, now))
})
test('edit total amount preserves creation baseline and recomputes existing certified payment', () => {
 const old = { ...promise({ qualifying_paid_amount_native: '1000' }), revision: '1', note: null }
 const result = plan(held({ promise: old }), parse(edit({ amount: '3000' })).intent, now)
 assert.equal(result.steps[0].payload.promised_amount_native, '3000'); assert.equal(result.evaluation.qualifying_paid_amount_native, '1000')
 assert.equal('payment_baseline' in result.steps[0].payload, false); assert.equal(old.payment_baseline.payment_ids[0], 'old-payment')
})
test('immediately satisfied edit delegates to Phase5A and keeps both events ordered', () => {
 const result = plan(held({ promise: { ...promise({ qualifying_paid_amount_native: '1000' }), revision: '1', note: null } }), parse(edit({ amount: '1000', note: 'new' })).intent, now)
 assert.deepEqual(result.steps.map(s => s.operation), ['change_terms','change_note','resolve'])
 assert.equal(result.steps[2].payload.status, 'kept'); assert.equal(result.steps[2].payload.evidence.reason_code, 'payment_commitment_satisfied')
})
test('current balance limits remaining fixed commitment, not original total', () => {
 const context = held({ promise: { ...promise({ qualifying_paid_amount_native: '1000' }), revision: '1', note: null }, invoice: { ...held().invoice, amount_due_native: '2000' } })
 assert.equal(plan(context, parse(edit({ amount: '3000' })).intent, now).steps[0].payload.promised_amount_native, '3000')
 assert.throws(() => plan(context, parse(edit({ amount: '3001' })).intent, now))
})
test('stale revision and accounting customer/currency changes rejected', () => {
 assert.throws(() => plan(held({ promise: { ...promise(), revision: '2' } }), parse(edit({ amount: '3000' })).intent, now))
 for (const changes of [{ customer_source_id: 'different' }, { transaction_currency_code: 'USD' }]) assert.throws(() => plan(held({ promise: { ...promise(), revision: '1' }, invoice: { ...held().invoice, ...changes } }), parse(edit({ note: 'new' })).intent, now))
})
test('normal DTO never exposes baseline, owner, raw evidence or internal generation IDs', () => {
 const dto = domain.promiseDTO({ ...promise(), revision: '1', note: null })
 for (const field of ['payment_baseline','user_id','tenant_id','creation_sync_run_id','evaluated_sync_run_id']) assert.equal(field in dto, false)
 assert.equal(dto.revision, '1')
})
test('authentication rejects signed-out user and exact tenant fallback', async () => {
 for (const changes of [ { '@/lib/supabase-server': { createServerSupabaseClient: async () => ({ auth: { getUser: async () => ({ data: { user: null } }) } }) } }, { '@/lib/billing/entitlements': { claimActionsEntitlementStatus: async () => ({ tenantId: 'another', hasActionsAccess: true }) } } ]) {
  const loaded = loadTypeScriptModule('lib/collections/invoice-promises-server.ts', { mocks: { ...mocks, ...changes } })
  await assert.rejects(loaded.authenticatePromiseTenant('tenant-1'))
 }
})
test('unknown authoritative client fields, unsupported operation and malformed dates rejected', () => {
 for (const extra of [{ currency: 'GBP' }, { payment_baseline: {} }, { qualifying_paid_amount_native: '1000' }, { operation: 'reactivate' }, { promisedDate: '2026-02-30' }, { note: 'x'.repeat(2001) }]) assert.throws(() => parse(create(extra)))
})
test('authenticated mutation replays without fresh baseline construction or repeating persistence', async () => {
 const calls=[],saved={...promise(),id:command,revision:'1',note:null},result={promise:saved,events:[],replayed:true}
 const loaded=loadTypeScriptModule('lib/collections/invoice-promises-server.ts',{mocks:{...mocks,
  '@/lib/supabase-admin':{createSupabaseAdminClient:()=>({rpc:async(name,args)=>{calls.push([name,args]);return {data:result,error:null}}})},
 }})
 const returned=await loaded.mutateInvoicePromise(create())
 assert.equal(returned.replayed,true);assert.equal(returned.invoice,null)
 assert.deepEqual(calls.map(([name])=>name),['read_invoice_promise_request','prepare_invoice_promise_request'])
 assert.equal(calls[0][1].p_user,'user-1');assert.equal(calls[0][1].p_tenant,'tenant-1')
})
test('authenticated create uses one held generation and scoped derived baseline; mismatched generation aborts', async () => {
 for(const activeRun of ['run-1','other-run']) {
  const calls=[],context=held()
  const loaded=loadTypeScriptModule('lib/collections/invoice-promises-server.ts',{mocks:{...mocks,
   '@/lib/xero/authoritative-snapshot':{resolveXeroAuthoritativeSnapshot:async()=>({mode:'generation',syncRunId:activeRun})},
   '@/lib/supabase-admin':{createSupabaseAdminClient:()=>({rpc:async(name,args)=>{
    calls.push([name,args]);return {data:name==='read_invoice_promise_request'?null:name==='prepare_invoice_promise_request'?context:
     {promise:{...promise(),id:command,revision:'1',note:null},events:[],replayed:false},error:null}
   }})},
  }})
  if(activeRun!=='run-1') {await assert.rejects(loaded.mutateInvoicePromise(create({promisedDate:'2099-12-31'})));assert.equal(calls.length,2);continue}
  const result=await loaded.mutateInvoicePromise(create({promisedDate:'2099-12-31'}))
  assert.equal(result.invoice.invoiceSourceId,'invoice-1')
  assert.equal(calls[1][1].p_invoice,'invoice-1');assert.equal(calls[1][1].p_financial,false)
  const commit=calls[2][1];assert.equal(commit.p_run,'run-1');assert.equal(commit.p_digest,context.digest)
  assert.deepEqual(commit.p_steps[0].payload.payment_baseline.payment_ids,['payment-1'])
 }
})
test('financial edit cannot reuse stale positive qualifying total when qualification is unavailable',()=>{
 const row={...promise({qualifying_paid_amount_native:'1000'}),revision:'1',note:null},context=held({promise:row})
 context.observation.resources[0].complete=false
 assert.throws(()=>plan(context,parse(edit({amount:'1000'})).intent,now))
})
test('date-only and combined edits preserve creation window and requalify rather than reset payment history',()=>{
 const old={...promise({qualifying_paid_amount_native:'1000'}),revision:'1',note:null}
 for(const changes of [{promisedDate:'2026-10-02'},{amount:'3500',promisedDate:'2026-10-02'}]) {
  const result=plan(held({promise:old}),parse(edit(changes)).intent,now)
  assert.equal(result.steps[0].payload.promised_date,'2026-10-02')
  assert.equal(result.evaluation.qualifying_paid_amount_native,'1000')
  assert.equal('payment_baseline' in result.steps[0].payload,false)
  assert.equal('creation_sync_run_id' in result.steps[0].payload,false)
 }
})
test('shortened date cannot validate amount using payments outside the revised period',()=>{
 const context=held({promise:{...promise({qualifying_paid_amount_native:'1000'}),revision:'1',note:null},invoice:{...held().invoice,amount_due_native:'2000'}})
 assert.throws(()=>plan(context,parse(edit({amount:'3000',promisedDate:'2026-09-27'})).intent,'2026-09-27T12:00:00Z'))
})
test('financial edit rejects malformed payment evidence even when previously certified paid is zero',()=>{
 const context=held({promise:{...promise(),revision:'1',note:null}})
 context.evidence.payments[0].currency_code='USD'
 assert.throws(()=>plan(context,parse(edit({amount:'3000'})).intent,now))
})
test('new commitment may edit before a newer observation without inventing paid evidence',()=>{
 const context=held({promise:{...promise({created_at:'2026-09-29T09:00:00Z'}),revision:'1',note:null}})
 const result=plan(context,parse(edit({amount:'3000'})).intent,now)
 assert.equal(result.steps[0].operation,'change_terms');assert.equal(result.evaluation,null)
})
test('edited dates retain original creation window and delegate elapsed deadlines to existing resolver',()=>{
 const context=held({promise:{...promise(),revision:'1',note:null}})
 assert.throws(()=>plan(context,parse(edit({promisedDate:'2026-09-26'})).intent,now))
 const result=plan(context,parse(edit({promisedDate:'2026-09-28'})).intent,now)
 assert.deepEqual(result.steps.map(s=>s.operation),['change_terms','resolve'])
 assert.equal(result.steps[1].payload.status,'missed')
 assert.equal(result.steps[1].payload.evidence.reason_code,'insufficient_payment_no_plausible_cash')
})
