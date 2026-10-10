import assert from 'node:assert/strict'
import test from 'node:test'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { JSDOM } from 'jsdom'
import { loadTypeScriptModule } from './test-helpers/ts-module-loader.mjs'
const runtime = await import('react/jsx-runtime')
const { invoiceFixture } = loadTypeScriptModule('stories/ui/customerFixture.ts')
const { priorityInvoiceContext, validInvoiceDate } = loadTypeScriptModule('app/collections/actions/priority-invoices.ts')
const { priorityInvoicesHref, prioritiesReturnHref, queueCustomerId } = loadTypeScriptModule('app/collections/actions/queue-navigation-context.ts')
const Link = ({ children, href, ...props }) => React.createElement('a', { href, ...props }, children)

const invoice = (id, patch = {}) => ({ ...invoiceFixture, invoiceSourceId: id, invoiceNumber: id, ...patch })
test('display uses gross open overdue state and stable due-date/identity order, never coverage eligibility', () => {
  const rows = [invoice('b'), invoice('a', { toChaseAmountNative: '0', disputeMode: 'full', effectiveDisputedAmountNative: '5000' }),
    invoice('early', { dueDate: '2026-08-01' }), invoice('future', { dueDate: '2026-10-20' }), invoice('today', { dueDate: '2026-10-10' }),
    invoice('settled', { invoiceState: 'settled', currentAmountDueNative: '0' }), invoice('unknown', { invoiceState: 'unavailable', currentAmountDueNative: null }),
    invoice('invalid', { invoiceState: 'invalid' }), invoice('no-date', { dueDate: null }), invoice('no-currency', { currencyCode: null })]
  const context = priorityInvoiceContext(rows, '2026-10-10')
  assert.deepEqual(context.overdue.map(x => x.invoiceSourceId), ['early','a','b','no-currency'])
  assert.deepEqual(context.uncertain.map(x => x.invoiceSourceId), ['unknown','invalid','no-date','no-currency'])
  assert.equal(rows[0].invoiceSourceId,'b','input is not reordered')
  assert.equal(context.overdue[1].currentAmountDueNative, '5000','fully covered does not become paid')
  assert.equal(priorityInvoiceContext(rows, null).overdue.length,0)
  assert.equal(validInvoiceDate('2026-02-30'), false)
})
test('navigation encodes only durable bounded identity and tenant, never an open redirect', () => {
  const href = new URL(priorityInvoicesHref('tenant&1','customer/2'), 'http://localhost')
  assert.equal(href.pathname,'/customers');assert.equal(href.hash,'#customer-invoices')
  assert.deepEqual(Object.fromEntries(href.searchParams),{customerSourceId:'customer/2',queueCustomerSourceId:'customer/2',tenantId:'tenant&1'})
  assert.equal(new URL(prioritiesReturnHref('tenant&1','customer/2'),'http://localhost').searchParams.get('queueCustomerSourceId'),'customer/2')
  for(const value of ['', ' bad', 'bad\n', 'x'.repeat(201)])assert.equal(queueCustomerId(value),null)
})
test('compact rendering limits to three and preserves exact money and partial/full coverage labels', () => {
  const View=loadTypeScriptModule('app/collections/actions/QueueInvoices.tsx',{mocks:{'next/link':Link}}).default
  const invoices=[invoice('partial'),invoice('full',{disputeMode:'full',effectiveDisputedAmountNative:'5000',activePromise:null}),
    invoice('promised',{isActive:false,activePromisedCoverageAmountNative:'5000'}),invoice('z-extra')]
  const dom=new JSDOM(renderToStaticMarkup(React.createElement(View,{state:{status:'ready',invoices},evaluationDate:'2026-10-10',href:'/customers',onRetry(){}})))
  assert.equal(dom.window.document.querySelectorAll('li').length,3)
  assert.match(dom.window.document.body.textContent,/Partial dispute · £1,200.00 disputed/)
  assert.match(dom.window.document.body.textContent,/Full dispute · £5,000.00 disputed/)
  assert.match(dom.window.document.body.textContent,/Active promise · £5,000.00 currently covered/)
  assert.match(dom.window.document.body.textContent,/first 3 of 4/)
  assert.doesNotMatch(dom.window.document.body.textContent,/paid|net collectible/)
  dom.window.close()
})

async function setup({ returnId, rows = ['alpha','beta','gamma'] } = {}) {
  const dom=new JSDOM('<div id="root"></div>',{url:`http://localhost/dashboard?tenantId=tenant${returnId ? '&queueCustomerSourceId='+encodeURIComponent(returnId):''}`,pretendToBeVisual:true})
  const keys=['window','document','HTMLElement','Event','CustomEvent','StorageEvent','fetch','IS_REACT_ACT_ENVIRONMENT']
  const previous=Object.fromEntries(keys.map(key=>[key,globalThis[key]]))
  for(const key of keys)if(key in dom.window)globalThis[key]=dom.window[key]
  globalThis.IS_REACT_ACT_ENVIRONMENT=true
  dom.window.matchMedia=()=>({matches:false});dom.window.HTMLElement.prototype.scrollIntoView=function(){}
  const requests=[], router={push(){},replace(){}}, queueReads=[]
  const baseRows=rows.map(id=>({customer_source_id:id,customer_name:id+' Ltd',customer_email:null,customer_to_chase_overdue_base:100,customer_credit_applied_base:0,
    has_actionable_overdue_balance:true,overdue_outstanding_base:100,effective_disputed_overdue_base_decimal:'0',weighted_avg_overdue_days:20,last_payment_date:null,
    collectible_native_currency_breakdown:[],override_level:'normal',recommended_action:'Follow up',last_action_type:null,last_action_outcome:null,last_action_timestamp:null,priority_score:50}))
  const payload={ok:true,rows:baseRows,tenantId:'tenant',organisationBaseCurrency:'GBP',currencyAccess:{allowed:true},
    version:{accountingGenerationId:'generation',financialEpoch:'1',projectionRevision:'1',evaluationDate:'2026-10-10'},
    followUpSchedule:{today:'2026-10-10',tomorrow:'2026-10-11'},experience:{hasPriorCollectionActivity:true}}
  globalThis.fetch=(url,init={})=>{
    const parsed=new URL(String(url),'http://localhost')
    assert.equal(parsed.pathname,'/api/collections/invoice-disputes','no queue, portfolio or refresh request')
    let resolve
    const promise=new Promise(r=>{resolve=r})
    requests.push({customer:parsed.searchParams.get('customerSourceId'),tenant:parsed.searchParams.get('tenantId'),signal:init.signal,resolve,url:parsed})
    return promise
  }
  const Client=loadTypeScriptModule('app/collections/actions/CollectionActionsClient.tsx',{mocks:{react:React,'react/jsx-runtime':runtime,
    'next/link':Link,'next/navigation':{useRouter:()=>router},'@/app/collections/FounderContextControl':()=>null}}).default
  const container=document.getElementById('root'),root=createRoot(container)
  const render=async()=>act(async()=>root.render(React.createElement(Client,{embedded:true,showTable:false,tenantId:'tenant',dashboardData:payload,dashboardState:'ready',dashboardRefresh:async()=>{queueReads.push(1);return payload}})))
  await render()
  const click=async(label)=>{const button=[...container.querySelectorAll('button')].find(x=>x.textContent.trim()===label);assert.ok(button,label);await act(async()=>button.click())}
  const respond=async(index,invoices=[invoice(requests[index].customer+'-invoice')],status=200)=>act(async()=>requests[index].resolve(new Response(JSON.stringify(status===200?{ok:true,invoices}:{error:'Synthetic invoice failure'}),{status})))
  return {dom,container,requests,payload,render,click,respond,queueReads,
    cleanup:async()=>{await act(async()=>root.unmount());Object.assign(globalThis,previous);dom.window.close()}}
}
test('bootstrap/actions render before invoices; only selected customer loads, then cache reuse and scoped invalidation',async()=>{
  const ui=await setup()
  try{
    assert.deepEqual(ui.requests.map(x=>x.customer),['alpha'])
    assert.equal(ui.container.querySelectorAll('[aria-label="Record outcome"] button').length,4)
    assert.ok([...ui.container.querySelectorAll('[aria-label="Record outcome"] button')].every(x=>!x.disabled))
    await ui.respond(0);await ui.click('Next');await ui.respond(1)
    await ui.click('Previous');assert.equal(ui.requests.length,2,'recent customer reuses scoped batch')
    await ui.click('Next');assert.equal(ui.requests.length,2,'no redundant request')
    await act(async()=>window.dispatchEvent(new CustomEvent('yuohme:promise-actionability-changed',{detail:'other-tenant'})))
    assert.equal(ui.requests.length,2,'other tenant does not invalidate')
    await act(async()=>window.dispatchEvent(new Event('accounting-updated')))
    assert.equal(ui.requests.length,3)
    await ui.respond(2)
    ui.payload.version={...ui.payload.version,financialEpoch:'2',projectionRevision:'2'}
    await ui.render();assert.equal(ui.requests.length,4,'financial epoch changes invalidate reused data')
    await ui.respond(3)
    await act(async()=>window.dispatchEvent(new CustomEvent('yuohme:promise-actionability-changed',{detail:'tenant'})))
    assert.equal(ui.requests.length,5,'same-tenant financial mutation reloads only selected invoices')
    await ui.respond(4)
    assert.ok(ui.requests.every(x=>x.tenant==='tenant'&&!x.url.searchParams.has('invoiceSourceId')))
  }finally{await ui.cleanup()}
})
test('rapid selection cancels old requests and ignores out-of-order responses even if transport ignores abort',async()=>{
  const ui=await setup()
  try{
    await ui.click('Next');assert.equal(ui.requests[0].signal.aborted,true)
    await ui.respond(1,[invoice('beta-current')]);await ui.respond(0,[invoice('alpha-stale')])
    const region=ui.container.querySelector('[aria-label="Invoices requiring attention"]')
    assert.match(region.textContent,/beta-current/);assert.doesNotMatch(region.textContent,/alpha-stale/)
    assert.equal(ui.queueReads.length,0)
  }finally{await ui.cleanup()}
})
test('invoice failure/retry does not block actions or refresh accounting',async()=>{
  const ui=await setup()
  try{
    await ui.respond(0,[],500);assert.match(ui.container.textContent,/Synthetic invoice failure/)
    assert.ok([...ui.container.querySelectorAll('[aria-label="Record outcome"] button')].every(x=>!x.disabled))
    await ui.click('Retry invoices');await ui.respond(1,[])
    assert.match(ui.container.textContent,/Other debt or commitments may remain/)
    assert.equal(ui.queueReads.length,0)
  }finally{await ui.cleanup()}
})
test('durable return identity restores selection without fetching first customer and supports browser history',async()=>{
  const ui=await setup({returnId:'beta'})
  try{
    assert.equal(ui.container.querySelector('article h2').textContent,'beta Ltd')
    assert.deepEqual(ui.requests.map(x=>x.customer),['beta'])
    assert.match(ui.container.textContent,/Priority 2 of 3/)
    const link=[...ui.container.querySelectorAll('a')].find(x=>x.textContent==='View all invoices')
    assert.equal(new URL(link.href).searchParams.get('queueCustomerSourceId'),'beta')
    assert.equal(new URL(link.href).hash,'#customer-invoices')
    const history=[...ui.container.querySelectorAll('a')].find(x=>x.textContent==='View full history')
    assert.equal(new URL(history.href).searchParams.get('queueCustomerSourceId'),'beta')
    await ui.respond(0)
    await act(async()=>{window.history.pushState({},'', '/dashboard?tenantId=tenant&queueCustomerSourceId=gamma');window.dispatchEvent(new Event('popstate'))})
    assert.equal(ui.container.querySelector('article h2').textContent,'gamma Ltd')
    await ui.respond(1)
    await ui.click('Back to #1');assert.equal(ui.container.querySelector('article h2').textContent,'alpha Ltd')
  }finally{await ui.cleanup()}
})
test('removed/deferred return falls back to current eligible head without altering order',async()=>{
  const ui=await setup({returnId:'missing',rows:['gamma','beta']})
  try{
    assert.equal(ui.container.querySelector('article h2').textContent,'gamma Ltd')
    assert.match(ui.container.textContent,/no longer in the eligible queue/)
    assert.equal(ui.requests[0].customer,'gamma')
  }finally{await ui.cleanup()}
})

test('cache TTL and four-entry bound cannot retain old invoice batches indefinitely',async()=>{
  const originalNow=Date.now
  const ui=await setup({rows:['alpha','beta','gamma','delta','epsilon']})
  try{
    await ui.respond(0)
    for(let n=1;n<5;n++){await ui.click('Next');await ui.respond(n)}
    await ui.click('Back to #1');assert.equal(ui.requests.length,6,'fifth selection evicts oldest batch')
    await ui.respond(5)
    await ui.click('Next');assert.equal(ui.requests.length,7,'second oldest was evicted')
    await ui.respond(6)
    Date.now=()=>originalNow()+61_000
    await ui.click('Previous');assert.equal(ui.requests.length,8,'expired batch is not reused')
  }finally{Date.now=originalNow;await ui.cleanup()}
})
test('empty eligible queue makes no invoice request and explains unavailable return',async()=>{
  const ui=await setup({returnId:'alpha',rows:[]})
  try{assert.equal(ui.requests.length,0);assert.match(ui.container.textContent,/no longer in the eligible queue/)}
  finally{await ui.cleanup()}
})

test('unavailable dates/currency/amounts and historical records stay clearly separate from the normal list',()=>{
  const View=loadTypeScriptModule('app/collections/actions/QueueInvoices.tsx',{mocks:{'next/link':Link}}).default
  const render=(invoices,evaluationDate='2026-10-10')=>new JSDOM(renderToStaticMarkup(React.createElement(View,{state:{status:'ready',invoices},evaluationDate,href:'/customers',onRetry(){}})))
  const dom=render([invoice('unknown',{invoiceState:'unavailable',currentAmountDueNative:null}),invoice('settled',{invoiceState:'settled',currentAmountDueNative:'0'}),invoice('currency',{currencyCode:null,needsReview:true})])
  assert.equal(dom.window.document.querySelectorAll('li').length,1)
  assert.match(dom.window.document.body.textContent,/unavailable accounting, date or currency/)
  assert.match(dom.window.document.body.textContent,/Currency unavailable/)
  assert.match(dom.window.document.body.textContent,/dispute balance.*need review/)
  const missing=render([invoice('open')],null)
  assert.equal(missing.window.document.querySelectorAll('li').length,0)
  assert.match(missing.window.document.body.textContent,/evaluation date is unavailable/)
  dom.window.close();missing.window.close()
})
