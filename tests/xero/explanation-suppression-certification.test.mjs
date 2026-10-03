import assert from 'node:assert/strict'
import test, { before, after, mock } from 'node:test'
import { readFileSync, readdirSync } from 'node:fs'
import { interactionJourney, invoice, paidHistory, owner, scoreFields } from './test-helpers/interaction-journey-fixture.mjs'
import { fidelityUI, resultText } from './test-helpers/fidelity-ui-fixture.mjs'
import { loadTypeScriptModule } from './test-helpers/ts-module-loader.mjs'
import { TENANT_ID } from './test-helpers/disputes-journey-fixture.mjs'

before(()=>mock.timers.enable({apis:['Date'],now:new Date('2026-10-01T12:00:00Z')}))
after(()=>mock.timers.reset())
const row = (state,id='acme') => state.queue.rows.find(r=>r.customer_source_id===id)
const breakdown = r => r.score_breakdown_lines.join('\n')
const timing = loadTypeScriptModule('lib/collections/payment-behavior-copy.ts')
const create = (app, amount='300')=>app.promiseCommand({operation:'create',invoiceSourceId:'old',amount,promisedDate:'2026-10-08'})

test('net To chase explanation and capped urgency match production inputs, API and rendered diagnostics',async()=>{
  const app=interactionJourney();await app.dispute('partial','200');create(app);app.credit('150')
  const state=await app.read(),a=row(state),actual=state.observed.find(r=>r.row.customer_source_id==='acme')
  assert.equal(actual.row.customer_overdue_to_chase_base,350)
  assert.equal(actual.row.invoice_overdue_to_chase_base,500)
  assert.equal(a.gross_outstanding_base_decimal,'1000')
  for(const key of [...scoreFields,'reason','score_breakdown_lines']) assert.deepEqual(a[key],actual.result[key])
  assert.match(breakdown(a),/customer overdue To chase = 350\.00/)
  assert.doesNotMatch(breakdown(a),/customer overdue AR/)
  assert.match(breakdown(a),/Urgency:.*100\.0.*invoice bonus 5.*cap 100.*100\.0/)
  assert.match(breakdown(a),/display.*rounded/i)
  assert.match(a.reason,/£350.*to chase/)
  const ui=fidelityUI(app)
  try {
    await ui.render();await ui.expand('acme')
    assert.match(ui.container.textContent,/£350/)
    assert.match(ui.container.textContent,/£150.*Xero credit deducted/)
    assert.ok(ui.container.textContent.includes(a.reason))
    for(const line of a.score_breakdown_lines)assert.ok(ui.container.textContent.includes(line))
    assert.match(ui.container.textContent,/79\.2/)
    assert.match(resultText(state.queue),/£350 overdue to chase/)
  }finally{await ui.cleanup()}
})

test('rounded near ties never falsely claim the smaller customer is the largest',async()=>{
  const app=interactionJourney([invoice('old','acme','999.6',30),invoice('b','baker','1000',30)])
  const state=await app.read()
  assert.equal(row(state).priority_score,row(state,'baker').priority_score)
  assert.deepEqual(state.active,['baker','acme'])
  assert.doesNotMatch(row(state).first_value_reasons.map(r=>r.text).join(' '),/largest/)
  assert.match(row(state,'baker').first_value_reasons[0].text,/largest.*portfolio/)
})

test('deferred benchmark members remain accurately described as portfolio comparisons',async()=>{
  const app=interactionJourney()
  await app.actionHistory.createActionHistory({action_id:'00000000-0000-4000-8000-000000000051',tenant_id:TENANT_ID,
    source_system:'xero',customer_source_id:'baker',outcome:'message_sent',next_action_date:'2026-10-02'})
  const state=await app.read(),a=row(state)
  assert.deepEqual(state.active,['acme','cedar'])
  assert.match(a.first_value_reasons[0].text,/portfolio/)
  assert.doesNotMatch(a.first_value_reasons[0].text,/current queue|eligible overdue balance/)
  assert.equal(state.observed[0].context.totalOverdueOutstandingBase,1900)
})

test('suppression states expose accurate accounting, diagnostics, queue metadata and empty-state copy',async t=>{
  for(const kind of ['paid','dispute','Promise','credit','never','deferred','due'])await t.test(kind,async()=>{
    const app=interactionJourney([invoice('old','acme','100',30)])
    if(kind==='paid')app.pay('old','0','100')
    if(kind==='dispute')await app.dispute('full')
    if(kind==='Promise')create(app,'100')
    if(kind==='credit')app.credit('100')
    if(kind==='never')app.override('acme','do_not_chase')
    if(kind==='deferred'||kind==='due')app.tables.collection_actions.push({...owner,id:'event',customer_source_id:'acme',action_type:'outcome',
      outcome:'message_sent',action_timestamp:'2026-09-30T12:00:00Z',next_action_date:kind==='due'?'2026-10-01':'2026-10-02'})
    const state=await app.read(),a=row(state)
    assert.equal(state.customer.customer_to_chase_overdue_base_decimal,['never','deferred','due'].includes(kind)?'100':'0')
    assert.equal(state.customer.gross_outstanding_base_decimal,kind==='paid'?'0':'100')
    assert.equal(state.queue.queue.remainingCustomerCount,kind==='due'?1:0)
    assert.deepEqual(state.active,kind==='due'?['acme']:[])
    if(kind==='never'||kind==='due') {
      assert.equal(a.base_score,85);assert.equal(a.final_score,kind==='never'?0:85)
      assert.equal(a.queue_eligibility_reason,kind==='never'?'do_not_chase':'eligible')
      if(kind==='never')assert.match(a.reason,/Never chase.*final score to 0/)
    }else assert.equal(a,undefined)
    if(kind==='deferred') {
      assert.equal(state.observed[0].result.base_score,85)
      assert.equal(state.queue.queue.suppressedCustomerCount,1)
      assert.equal(state.queue.queue.suppression.nextReturnDate,'2026-10-02')
    }
    if(['dispute','Promise','credit'].includes(kind)) {
      assert.doesNotMatch(resultText(state.queue),/found no overdue receivables/)
      const ui=fidelityUI(app)
      try{await ui.render();assert.doesNotMatch(ui.container.textContent,/currently have overdue receivables|Next to chase|Review now/)}finally{await ui.cleanup()}
    }
    const diagnostic=await app.actions('overdueOnly=false')
    assert.equal(diagnostic.status,200)
    if(kind==='paid') {
      assert.equal(diagnostic.body.rows[0].recommended_action,'No action')
      assert.doesNotMatch(breakdown(diagnostic.body.rows[0]),/0\.00 \/ 0\.00/)
    }
  })
})

test('urgency facts use actionable weights and count, not naive invoice average or credit allocation',async()=>{
  const app=interactionJourney([invoice('old','acme','100',100),invoice('young','acme','900',10),invoice('b','baker','200',40)])
  let state=await app.read()
  assert.equal(row(state).weighted_avg_overdue_days,19)
  assert.match(breakdown(row(state)),/weighted avg overdue days = 19\.0/)
  assert.match(breakdown(row(state)),/invoice bonus 5/)
  const before=row(state).urgency_score
  app.credit('800');state=await app.read()
  assert.equal(row(state).urgency_score,before)
  assert.match(breakdown(row(state)),/weighted avg overdue days = 19\.0/)
  await app.dispute('full');state=await app.read()
  assert.equal(row(state).weighted_avg_overdue_days,10)
  assert.match(breakdown(row(state)),/invoice bonus 0/)
  assert.doesNotMatch(row(state).reason,/100 days/)
})

test('deterioration and recency explanations distinguish missing history, normal timing, floor and bands',async t=>{
  for(const [label,median,age,expected,text] of [['improving',20,10,0,'earlier than usual'],['normal',10,10,0,'About the same'],
    ['floor',10,13,0,'later than usual'],['above floor',10,14,100/27,'later than usual'],['deteriorating',10,40,100,'later than usual'],['sparse',null,40,0,'Not enough history']]) {
    await t.test(label,async()=>{
      const app=interactionJourney([invoice('old','acme','100',age),...(median===null?paidHistory('acme',10).slice(0,2):paidHistory('acme',median))])
      const state=await app.read(),a=row(state)
      assert.ok(Math.abs(a.relative_lateness_score-expected)<1e-12)
      assert.match(timing.formatRelativeLateness(state.customer.relative_lateness_days),new RegExp(text))
      if(median===null)assert.match(breakdown(a),/not enough recent payment history to assess deterioration/)
      if(expected===0)assert.equal(a.first_value_reasons.some(r=>r.kind==='deterioration'),false)
      assert.match(breakdown(a),/Payment recency input: last payment = no payment history/)
    })
  }
  for(const [days,score] of [[0,0],[1,10],[7,10],[8,20],[14,20],[15,40],[30,40],[31,60],[45,60],[46,80],[60,80],[61,100],[365,100]]) {
    const app=interactionJourney([invoice('old','acme','100',30)])
    const date=new Date(Date.now()-days*86400000).toISOString().slice(0,10)
    app.tables.canonical_payments.push({...owner,sync_run_id:'generation-1',customer_source_id:'acme',invoice_source_id:'old',payment_date:date})
    const a=row(await app.read())
    assert.equal(a.payment_recency_score,score)
    assert.match(breakdown(a),new RegExp(`Payment recency input: last payment = ${days} days ago`))
    assert.doesNotMatch(breakdown(a),/Behaviour:|reliability/i)
  }
})

test('all override explanations expose the actual base, multiplier and final score without a fifth signal',async()=>{
  for(const [level,final,multiplier] of [['safe',40,'0.40'],['normal',100,'1.00'],['priority',160,'1.60'],['do_not_chase',0,'0.00']]){
    const app=interactionJourney();app.override('acme',level)
    const a=row(await app.read())
    assert.equal(a.base_score,100);assert.equal(a.final_score,final);assert.equal(a.priority_score,final)
    assert.match(breakdown(a),/Base score: 100\.0/)
    assert.ok(breakdown(a).includes(`Multiplier: x${multiplier}`))
    assert.ok(breakdown(a).includes(`Final score: ${final.toFixed(1)}`))
    for(const weight of ['0.50','0.25','0.15','0.10'])assert.ok(breakdown(a).includes(`× ${weight}`))
    assert.doesNotMatch(breakdown(a),/\/100 ×/)
    assert.match(breakdown(a),/100\.0 × 0\.50 ≈ 50\.0 points/)
  }
})

test('older overlapping queue response cannot restore a customer after current credit coverage removed it',async()=>{
  const app=interactionJourney([invoice('old','acme','100',30)]),ui=fidelityUI(app)
  try{
    await ui.render();assert.match(ui.container.textContent,/acme Ltd/)
    const old=ui.holdNext();await old.start()
    app.credit('100');await ui.refresh()
    assert.doesNotMatch(ui.container.textContent,/acme Ltd/)
    await old.release()
    assert.doesNotMatch(ui.container.textContent,/acme Ltd|Next to chase/)
    app.credit();await ui.refresh();assert.match(ui.container.textContent,/acme Ltd/)
  }finally{await ui.cleanup()}
})

test('rendered API amounts, reasons, diagnostics and order refresh together throughout current-state transitions',async()=>{
  const app=interactionJourney(),ui=fidelityUI(app)
  async function check(amount,base,final=base) {
    const state=await app.read(),a=row(state)
    assert.equal(state.customer.customer_to_chase_overdue_base,amount)
    await ui.refresh()
    const rendered=[...ui.container.querySelectorAll('tbody tr')].filter(tr=>tr.querySelector('td'))
    const names=rendered.map(tr=>tr.textContent.match(/(acme|baker|cedar) Ltd/)?.[1]).filter(Boolean)
    assert.deepEqual(names,state.queue.rows.map(r=>r.customer_source_id))
    if(!a) { assert.equal(base,null); assert.doesNotMatch(ui.container.textContent,/acme Ltd/); return }
    assert.equal(a.base_score,base);assert.equal(a.final_score,final)
    const observed=state.observed.find(item=>item.row.customer_source_id==='acme')
    for(const key of [...scoreFields,'reason','score_breakdown_lines'])assert.deepEqual(a[key],observed.result[key])
    await ui.expand('acme')
    assert.ok(ui.container.textContent.includes(a.reason))
    for(const line of a.score_breakdown_lines)assert.ok(ui.container.textContent.includes(line))
    const tr=rendered.find(tr=>tr.textContent.includes('acme Ltd'))
    assert.ok(tr.textContent.includes(`£${amount.toLocaleString('en-GB')}`))
    assert.ok(tr.textContent.includes(final.toFixed(1)))
  }
  try{
    await ui.render();await check(1000,100)
    await app.dispute('partial','200');await check(800,100)
    const p=create(app);await check(500,91.7)
    app.credit('150');await check(350,79.2)
    app.pay('old','700','200','150');await check(350,69.2)
    await app.dispute('resolve');await check(550,85.8)
    app.promiseCommand({operation:'cancel',promiseId:p.id,expectedRevision:p.revision});await check(650,90)
    app.credit('800');await check(0,null)
    app.credit();await check(800,90)
    app.override('acme','safe');await check(800,90,36)
    app.override('acme','priority');await check(800,90,144)
    app.override('acme','do_not_chase');await check(800,90,0)
    app.override('acme','normal')
    await app.actionHistory.createActionHistory({action_id:'00000000-0000-4000-8000-000000000052',tenant_id:TENANT_ID,
      source_system:'xero',customer_source_id:'acme',outcome:'reviewed_no_chase',next_action_date:'2026-10-02'})
    await check(800,null)
    mock.timers.setTime(new Date('2026-10-02T12:00:00Z').getTime())
    const due=await app.read();assert.equal(row(due).queue_eligibility_reason,'eligible')
    await check(800,row(due).base_score)
    const again=await app.read();assert.deepEqual(again.queue,due.queue)
  }finally{await ui.cleanup();mock.timers.setTime(new Date('2026-10-01T12:00:00Z').getTime())}
})

test('obsolete stored-looking fields and legacy contact outcomes cannot override canonical scoring inputs',async()=>{
  const app=interactionJourney(),before=await app.read()
  for(const record of [...app.tables.canonical_customers,...app.tables.canonical_invoices])Object.assign(record,{
    priority_score:999,base_score:999,final_score:999,collectible_overdue_base:999999,overdue_total:999999,
    is_suppressed:true,promised_to_pay:true,behaviour_score:999,
  })
  app.tables.collection_actions.push({...owner,id:'legacy-contact',customer_source_id:'acme',action_type:'called',
    outcome:'promised_to_pay',next_action_date:'2026-11-01',action_timestamp:'2026-09-30T12:00:00Z'})
  const after=await app.read()
  assert.deepEqual(after.observed,before.observed)
  assert.deepEqual(after.active,before.active)
  assert.deepEqual(after.customer,before.customer)
  for(const key of [...scoreFields,'reason','score_breakdown_lines'])assert.deepEqual(row(after)[key],row(before)[key])
})

test('current visible language contains no obsolete collectible product terminology',()=>{
  const paths=['app/collections/actions/CollectionActionsClient.tsx','app/collections/customers/CustomerCollectionsClient.tsx',
    'app/collections/customers/CustomerInvoiceDisputes.tsx','app/disputes/DisputesClient.tsx']
  for(const path of paths)assert.doesNotMatch(readFileSync(path,'utf8'),/collectible in invoice currency|Oldest collectible overdue|debt that remains collectible|Remaining debt is collectible again/)
})

test('live scoring stays in pure queue boundaries and delegated synthetic playbook; client never assembles scores',()=>{
  function files(dir){return readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(`${dir}/${e.name}`):/\.tsx?$/.test(e.name)?[`${dir}/${e.name}`]:[])}
  const callers=[...files('app'),...files('lib')].filter(path=>/\bprioritiseCustomer\s*\(/.test(readFileSync(path,'utf8')))
  assert.deepEqual(callers.sort(),['lib/collections/prioritization.ts','lib/credit-control-playbook.ts'])
  assert.match(readFileSync('app/api/collections/actions/route.ts','utf8'), /calculatePortfolioBaseScores\(benchmarks, organisationBaseCurrency\)/)
  assert.match(readFileSync('lib/collections/portfolio-benchmarks.ts','utf8'), /calculateBaseCustomerScore\(/)
  assert.match(readFileSync('lib/collections/queue-projection.ts','utf8'), /adjustCustomerPriority\(base,/)
  const client=readFileSync('app/collections/actions/CollectionActionsClient.tsx','utf8')
  assert.doesNotMatch(client,/computeExposureScore|computeUrgencyScore|computeBehaviourScore|prioritiseCustomer\s*\(|calculateBaseCustomerScore|calculatePortfolioBaseScores|adjustCustomerPriority/)
  assert.match(client,/row\.priority_score\.toFixed\(1\)/)
  assert.match(client,/row\.score_breakdown_lines\.map/)
})
