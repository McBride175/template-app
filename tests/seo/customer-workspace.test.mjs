import test from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { JSDOM } from 'jsdom'
import { loadTypeScriptModule } from '../xero/test-helpers/ts-module-loader.mjs'

const { customerFixture } = loadTypeScriptModule('stories/ui/customerFixture.ts')
const Overview = loadTypeScriptModule('app/collections/customers/CustomerOverview.tsx').default
const Frame = loadTypeScriptModule('app/collections/customers/InvoiceFrame.tsx').default
const { invoiceFixture, historyFixtures } = loadTypeScriptModule('stories/ui/customerFixture.ts')
const Timeline = loadTypeScriptModule('app/collections/customers/CustomerTimeline.tsx').default
const render = (component, props) => new JSDOM(renderToStaticMarkup(React.createElement(component, props)))

for (const [credit, net] of [[0,1000],[300,700],[1000,0],[1500,0]]) test(`customer credit ${credit} retains gross amounts and canonical To chase ${net}`,()=>{
  const dom=render(Overview,{row:{...customerFixture,total_outstanding_base:1000,overdue_outstanding_base:1000,customer_credit_applied_base:credit,customer_to_chase_overdue_base:net},currency:'GBP',equivalent:false})
  const text=dom.window.document.body.textContent
  assert.match(text,new RegExp(new Intl.NumberFormat(undefined,{style:'currency',currency:'GBP'}).format(net).replace(/[.*+?^${}()|[\]\\]/g,'\\$&')))
  assert.match(text,/Gross outstanding£1,000.00/);assert.match(text,/Gross overdue£1,000.00/)
  if(credit)assert.match(text,/Xero credit deducted/);else assert.doesNotMatch(text,/Xero credit deducted/)
  if(!net)assert.match(text,/Outstanding debt may still remain/)
})

test('unknown base amounts remain unavailable alongside native balances and explicit equivalent labels',()=>{
  const dom=render(Overview,{row:{...customerFixture,total_outstanding_base:null,overdue_outstanding_base:null,native_currency_breakdown:[{currency_code:'EUR',total_outstanding_native:'1200',overdue_outstanding_native:'900'}]},currency:'GBP',equivalent:true})
  const text=dom.window.document.body.textContent
  assert.match(text,/Base amount unavailable/);assert.match(text,/base currency equivalent/);assert.match(text,/EUR/)
  assert.equal(dom.window.document.querySelector('details').open,false)
})

test('invoice coverage is supplied separately and never applies customer credit or invents payment',()=>{
  const dom=render(Frame,{invoice:{...invoiceFixture,currentAmountDueNative:'5000',effectiveDisputedAmountNative:'1200',activePromisedCoverageAmountNative:'750'},children:null})
  const text=dom.window.document.body.textContent
  assert.match(text,/Outstanding£5,000.00/);assert.match(text,/Disputed£1,200.00/);assert.match(text,/Promised£750.00/)
  assert.doesNotMatch(text,/To chase|credit deducted/i)
  const unknown=render(Frame,{invoice:{...invoiceFixture,currentAmountDueNative:null,invoiceState:'unavailable'},children:null})
  assert.match(unknown.window.document.body.textContent,/Unavailable in current accounting data/)
  assert.match(unknown.window.document.body.textContent,/OutstandingUnavailable/)
})

test('timeline retains supplied chronology, read-only events and scoped invoice links',()=>{
  const dom=render(Timeline,{events:historyFixtures,busy:false,onDelete(){},customerHref:'/customers?tenantId=tenant&customerSourceId=customer'})
  const doc=dom.window.document
  assert.deepEqual([...doc.querySelectorAll('h2')].map(x=>x.textContent),historyFixtures.map(x=>x.label))
  assert.equal(doc.querySelectorAll('button').length,1)
  assert.match(doc.body.textContent,/Legacy · read only/)
  assert.equal(doc.querySelector('a').getAttribute('href'),'/customers?tenantId=tenant&customerSourceId=customer#invoice-synthetic-invoice-1')
})

test('customer Promises section reuses current/latest invoice commitments without creating another worklist',()=>{
  const Promises=loadTypeScriptModule('app/collections/customers/CustomerPromises.tsx').default
  const {invoiceFixtures}=loadTypeScriptModule('stories/ui/customerFixture.ts')
  const dom=render(Promises,{invoices:invoiceFixtures})
  const text=dom.window.document.body.textContent
  assert.match(text,/Current and latest invoice commitments/)
  assert.match(text,/£1,000.00 promised by 14 Oct 2026/)
  assert.match(text,/£250.00 received against this promise/)
  assert.match(text,/£750.00 currently promised against outstanding debt/)
  assert.match(text,/Promise kept/)
  assert.equal(dom.window.document.querySelectorAll('button').length,0)
  assert.deepEqual([...dom.window.document.querySelectorAll('a')].map(a=>a.getAttribute('href')),['#invoice-synthetic-invoice-1','#invoice-synthetic-invoice-3'])
})
