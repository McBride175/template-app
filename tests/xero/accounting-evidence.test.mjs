import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTypeScriptModule } from './test-helpers/ts-module-loader.mjs'
import { createGenerationImportHarness, contact, invoice, payment } from './test-helpers/xero-generation-import-harness.mjs'
const evidence = loadTypeScriptModule('lib/xero/accounting-evidence.ts')
const timezone = loadTypeScriptModule('lib/xero/organisation-timezone.ts')
const client = loadTypeScriptModule('lib/xero/accounting-api-client.ts')
const importer = loadTypeScriptModule('lib/xero/generation-importer.ts')
const invoices = [invoice('i1','c1','AUTHORISED'), invoice('i2','c1','PAID')]
const contacts = [contact('c1')]
const org = { BaseCurrency: 'GBP', CountryCode: 'GB', Timezone: 'GMTSTANDARDTIME' }
const p = overrides => payment('p1','i1','AUTHORISED', '2026-09-15T10:00:00Z',{ Amount:'12345678901234567890.1234567890123456789', ...overrides })
const cash = (kind, overrides = {}) => ({ [`${kind === 'overpayments' ? 'Overpayment' : 'Prepayment'}ID`]: 'cash1',
  Type: kind === 'overpayments' ? 'RECEIVE-OVERPAYMENT' : 'RECEIVE-PREPAYMENT', Contact: { ContactID:'c1' },
  RemainingCredit:'10.123456789012345678901', CurrencyCode:'GBP', Date:'2026-09-12', Status:'AUTHORISED', ...overrides })
const requestDeps = fetch => ({ fetch, async sleep(){}, random:()=>0.5,
  scheduleTimeout:()=>0,cancelTimeout(){},now:()=>Date.parse('2026-09-27T12:00:00Z') })
function fetchResource(kind, pages) {
  let page = 0
  const key = kind === 'payments' ? 'Payments' : kind === 'overpayments' ? 'Overpayments' : 'Prepayments'
  return client.fetchXeroPaginatedCollection({ accessToken:'synthetic',tenantId:'tenant-a',
    config: kind === 'payments' ? client.createXeroPaymentsCollectionConfig() : client.createXeroCashCollectionConfig(kind),
    requestMaxAttempts:1, dependencies: requestDeps(async () => {
      const value = pages[page++]
      if (value instanceof Error) throw value
      return new Response(typeof value === 'string' ? value : JSON.stringify({[key]:value}))
    }) })
}

test('HTTP numeric tokens reach exact native storage inputs without binary rounding or BankAmount substitution', async () => {
  const fetched = await fetchResource('payments', ['{"Payments":[{"PaymentID":"p1","Invoice":{"InvoiceID":"i1"},"PaymentType":"ACCRECPAYMENT","Status":"AUTHORISED","Amount":12345678901234567890.1234567890123456789,"BankAmount":5,"Date":"2026-09-12"}]}',[]])
  const [row] = evidence.mapXeroPaymentEvidence(fetched.records,invoices)
  assert.equal(row.amount_native,'12345678901234567890.1234567890123456789')
  assert.equal(row.source_id,'p1'); assert.equal(row.invoice_source_id,'i1'); assert.equal(row.currency_code,'GBP')
  assert.equal(row.customer_source_id,'c1'); assert.equal(row.source_updated_at,null)
})
test('accounting date and genuine modification time remain different, never retrieval fallback', () => {
  const [row] = evidence.mapXeroPaymentEvidence([p({Date:'/Date(1789171200000+0000)/',UpdatedDateUTC:'2026-09-20T11:12:13Z'})],invoices)
  assert.equal(row.payment_date,'2026-09-12'); assert.equal(row.source_updated_at,'2026-09-20T11:12:13.000Z')
})
test('authorised, deleted, refund and unsupported types remain explicitly distinguishable', () => {
  const rows = evidence.mapXeroPaymentEvidence([p(),p({PaymentID:'deleted',Status:'DELETED'}),p({PaymentID:'refund',PaymentType:'ARCREDITPAYMENT',Invoice:undefined}),p({PaymentID:'spend',PaymentType:'ACCPAYPAYMENT'})],invoices)
  assert.deepEqual(rows.map(row=>[row.payment_type,row.payment_status]),[['ACCRECPAYMENT','AUTHORISED'],['ACCRECPAYMENT','DELETED'],['ARCREDITPAYMENT','AUTHORISED'],['ACCPAYPAYMENT','AUTHORISED']])
  assert.equal(rows[2].currency_code,null)
})
test('multiple allocations/batch constituent payment IDs preserve their individual invoice amounts', () => {
  const rows = evidence.mapXeroPaymentEvidence([p({Amount:'20',BatchPaymentID:'batch'}),p({PaymentID:'p2',Amount:'30',BatchPaymentID:'batch'}),p({PaymentID:'p3',Invoice:{InvoiceID:'i2'},Amount:'50',BatchPaymentID:'batch'})],invoices)
  assert.deepEqual(rows.map(row=>[row.source_id,row.invoice_source_id,row.amount_native]),[['p1','i1','20'],['p2','i1','30'],['p3','i2','50']])
})
for (const [name,overrides] of Object.entries({ missing_invoice:{Invoice:{InvoiceID:'missing'}},malformed_money:{Amount:'12x'},inexact_number:{Amount:0.1},negative:{Amount:'-1'},nan:{Amount:'NaN'},bad_currency:{CurrencyCode:'?GB'},conflicting_currency:{CurrencyCode:'USD'},bad_date:{Date:'2026-02-30'},bad_status:{Status:'VOIDED'},bad_update:{UpdatedDateUTC:'garbage'},bad_customer:{Invoice:{InvoiceID:'i1',Contact:{ContactID:'wrong'}}} })) {
  test(`payment evidence fails closed: ${name}`,()=>assert.throws(()=>evidence.mapXeroPaymentEvidence([p(overrides)],invoices)))
}
test('duplicate durable payment identities cannot silently collapse',()=>assert.throws(()=>evidence.mapXeroPaymentEvidence([p(),p()],invoices)))
for (const kind of ['overpayments','prepayments']) {
  test(`${kind}: exact remaining cash, customer, currency, zero, voided and spend exclusion`,async()=>{
    const result = await fetchResource(kind,[[cash(kind)],[],])
    const rows = evidence.mapXeroUnappliedCashEvidence(kind,result.records,contacts,org)
    assert.equal(rows[0].remaining_credit_native,'10.123456789012345678901')
    assert.equal(rows[0].customer_source_id,'c1'); assert.equal(rows[0].currency_code,'GBP'); assert.equal(rows[0].accounting_date,'2026-09-12')
    assert.equal(evidence.mapXeroUnappliedCashEvidence(kind,[cash(kind,{RemainingCredit:'0',Status:'PAID'})],contacts,org)[0].remaining_credit_native,'0')
    assert.equal(evidence.mapXeroUnappliedCashEvidence(kind,[cash(kind,{Status:'VOIDED'})],contacts,org)[0].status,'VOIDED')
    assert.deepEqual(evidence.mapXeroUnappliedCashEvidence(kind,[cash(kind,{Type:kind==='overpayments'?'SPEND-OVERPAYMENT':'SPEND-PREPAYMENT'})],contacts,org),[])
  })
  test(`${kind}: complete multi-page traversal includes terminal empty page`,async()=>{
    const id = kind === 'overpayments' ? 'OverpaymentID' : 'PrepaymentID'
    const result = await fetchResource(kind,[[cash(kind)],[cash(kind,{[id]:'cash2'})],[]])
    assert.equal(result.recordCount,2);assert.equal(result.pageRequestCount,3)
    assert.equal(evidence.mapXeroUnappliedCashEvidence(kind,result.records,contacts,org).length,2)
  })
  test(`${kind}: empty success differs from failed page/envelope`,async()=>{
    assert.equal((await fetchResource(kind,[[]])).pageRequestCount,1)
    await assert.rejects(fetchResource(kind,[[cash(kind)],new Error('failed page')]))
    await assert.rejects(fetchResource(kind,['{}']))
  })
  test(`${kind}: duplicate, malformed and unavailable contact evidence rejected`,async()=>{
    await assert.rejects(fetchResource(kind,[[cash(kind)],[cash(kind)],[]]))
    for (const overrides of [{RemainingCredit:'x'},{CurrencyCode:'BAD!'},{Date:'2026-02-30'},{Status:'UNKNOWN'},{Contact:{ContactID:'missing'}},{Type:'UNKNOWN'}]) {
      assert.throws(()=>evidence.mapXeroUnappliedCashEvidence(kind,[cash(kind,overrides)],contacts,org))
    }
  })
}
test('cash cross-currency uses exact Xero native/rate, missing/invalid FX remains unavailable',()=>{
  const row = evidence.mapXeroUnappliedCashEvidence('overpayments',[cash('overpayments',{CurrencyCode:'USD',RemainingCredit:'120.123456789',CurrencyRate:'1.5'})],contacts,org)[0]
  assert.equal(row.remaining_credit_base,'80.08230453');assert.equal(row.xero_currency_rate,'1.5')
  for (const rate of [undefined,'0','NaN','-1',0.1]) {
    const row = evidence.mapXeroUnappliedCashEvidence('prepayments',[cash('prepayments',{CurrencyCode:'USD',CurrencyRate:rate})],contacts,org)[0]
    assert.equal(row.currency_conversion_status,'incomplete');assert.equal(row.remaining_credit_base,null)
  }
})

for (const [zone,country,expected] of [['GMTSTANDARDTIME','GB','Europe/London'],['Eastern Standard Time','US','America/New_York'],['EASTERNSTANDARDTIME','CA','America/Toronto'],['NEWZEALANDSTANDARDTIME','NZ','Pacific/Auckland'],['INDIASTANDARDTIME','IN','Asia/Calcutta'],['TOKYOSTANDARDTIME','JP','Asia/Tokyo']]) {
  test(`CLDR normalization ${zone}/${country}`,()=>assert.equal(timezone.normalizeXeroOrganisationTimezone(zone,country),expected))
}
test('missing/unknown timezone and invalid territory fail closed',()=>{
  for (const [zone,country] of [[null,'GB'],['bogus','GB'],['GMTSTANDARDTIME',null],['GMTSTANDARDTIME','ZZ'],['GMTSTANDARDTIME','UK']]) {
    assert.equal(timezone.normalizeXeroOrganisationTimezone(zone,country),null)
  }
})
test('normalized UK IANA zone preserves DST boundary',()=>{
  const timeZone = timezone.normalizeXeroOrganisationTimezone('GMTSTANDARDTIME','GB')
  const format = value => new Intl.DateTimeFormat('en-GB',{timeZone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(value))
  assert.equal(format('2026-03-29T00:30:00Z'),'00:30');assert.equal(format('2026-03-29T01:30:00Z'),'02:30')
  assert.equal(format('2026-10-25T00:30:00Z'),'01:30');assert.equal(format('2026-10-25T01:30:00Z'),'01:30')
})

test('generation importer retains recency population while deleted evidence supersedes authorised earlier state',async()=>{
  const captured=[]
  const harness = createGenerationImportHarness({catchUpPayments:[payment('payment-a','invoice-paid','DELETED','2026-09-15T10:01:00Z')],persistEvidence:params=>captured.push(params)})
  const result = await importer.importXeroGeneration(harness.params)
  assert.equal(result.status,'ready_for_promotion');assert.equal(result.counts.payments,0)
  assert.equal(captured[0].rows[0].payment_status,'DELETED')
  assert.equal(captured[0].observation.complete,true)
  assert.ok(captured.every(value=>value.syncRunId==='run-tenant-a'&&value.userId==='user-a'&&value.tenantId==='tenant-a'))
})
test('complete empty cash streams and populated receivable evidence are certified separately',async()=>{
  const captured=[]
  const harness = createGenerationImportHarness({persistEvidence:params=>captured.push(params)})
  await importer.importXeroGeneration(harness.params)
  assert.deepEqual(captured.map(value=>[value.observation.resource,value.observation.complete,value.rows.length]),[['payments',true,1],['overpayments',true,0],['prepayments',true,0]])
})
for (const resource of ['payments','overpayments','prepayments']) {
  test(`failed ${resource} does not become zero evidence or break collections promotion readiness`,async()=>{
    const captured=[]
    const harness = createGenerationImportHarness({persistEvidence:params=>captured.push(params),fetchCollection:({request,records,pageResult})=>{
      if(request.config.resource===resource && (resource !== 'payments' || !request.config.query.where)) throw new Error('unavailable')
      return pageResult(records)
    }})
    assert.equal((await importer.importXeroGeneration(harness.params)).status,'ready_for_promotion')
    assert.equal(captured.find(value=>value.observation.resource===resource).observation.complete,false)
  })
}
test('mapping failure makes payment evidence unavailable while collections recency mapping remains unchanged',async()=>{
  const captured=[]
  const harness = createGenerationImportHarness({payments:[payment('payment-a','invoice-paid','AUTHORISED',undefined,{Amount:'malformed'})],persistEvidence:params=>captured.push(params)})
  await importer.importXeroGeneration(harness.params)
  assert.equal(captured[0].observation.complete,false)
  assert.equal(harness.persisted.get('payments').length,1)
})
test('observation starts are not replaced by late completion/promotion timestamps across midnight',async()=>{
  const captured=[];let clock=Date.parse('2026-09-30T22:59:59Z') // UK deadline at 23:00Z
  const harness=createGenerationImportHarness({now:()=>clock,persistEvidence:params=>captured.push(params),fetchCollection:({request,records,pageResult})=>{if(request.config.resource === 'payments' && !request.config.query.where) clock+=1200;return pageResult(records)}})
  await importer.importXeroGeneration({...harness.params,deadlineMs:240000})
  assert.ok(Date.parse(captured[0].observation.started_at)<Date.parse('2026-09-30T23:00:00Z'))
  assert.ok(Date.parse(captured[0].observation.completed_at)>Date.parse('2026-09-30T23:00:00Z'))
  assert.ok(Date.parse(captured[1].observation.started_at)>Date.parse('2026-09-30T23:00:00Z'))
})
test('evidence persistence chunks exact values and certifies only the final successfully stored batch',async()=>{
  const calls=[]
  await evidence.persistXeroAccountingEvidence({syncRunId:'run',userId:'user',tenantId:'tenant',leaseOwner:'owner',fencingToken:2,
    organisation:org,observation:{resource:'payments',started_at:'2026-09-01T00:00:00Z',completed_at:'2026-09-01T00:01:00Z',complete:true,source_count:501,page_requests:2,populated_pages:1},
    rows:Array.from({length:501},()=>({amount_native:'1.1234567890123456789'})),supabaseAdmin:{async rpc(name,args){calls.push(args);return {error:null}}}})
  assert.deepEqual(calls.map(call=>[call.p_rows.length,call.p_observation.complete]),[[500,false],[1,true]])
  assert.equal(calls[0].p_rows[0].amount_native,'1.1234567890123456789')
  assert.equal(calls[1].p_timezone_iana,'Europe/London')
})

test('missing authoritative invoice currency is unavailable rather than a guessed payment denomination',()=> {
  assert.throws(()=>evidence.mapXeroPaymentEvidence([p()],[{...invoices[0],CurrencyCode:undefined}]))
})
test('failed persistence is not swallowed as missing accounting evidence', async()=> {
  await assert.rejects(evidence.persistXeroAccountingEvidence({syncRunId:'r',userId:'u',tenantId:'t',leaseOwner:'o',fencingToken:1,
    observation:{resource:'payments',started_at:'2026-09-01T00:00:00Z',completed_at:null,complete:false,page_requests:0,populated_pages:0,source_count:0},
    rows:[],organisation:org,supabaseAdmin:{async rpc(){return {error:{code:'failure'}}}}}))
})

test('malformed readiness response is unavailable rather than a trusted certification', async()=> {
  for (const data of [null,{}, {contract_version:'old',ready:true,resources:[]}, {contract_version:'promise_accounting_evidence_v1',ready:true,resources:[],timezone_iana:null}]) {
    await assert.rejects(evidence.inspectXeroAccountingEvidence({syncRunId:'r',userId:'u',tenantId:'t',supabaseAdmin:{async rpc(){return {data,error:null}}}}))
  }
})
