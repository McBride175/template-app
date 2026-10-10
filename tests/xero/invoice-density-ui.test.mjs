import assert from 'node:assert/strict'
import test from 'node:test'
import React, { act } from 'react'
import { JSDOM } from 'jsdom'
import { loadTypeScriptModule } from './test-helpers/ts-module-loader.mjs'
const runtime = await import('react/jsx-runtime')
const { invoiceFixture, invoiceFixtures } = loadTypeScriptModule('stories/ui/customerFixture.ts')
const ordinary = { ...invoiceFixtures[1], invoiceSourceId: 'ordinary', invoiceNumber: 'INV-ORDINARY' }

async function setup(invoices = [ordinary], handler = async () => { throw Error('Unexpected request') }, hash = '') {
  const dom = new JSDOM(`<div id="root"></div>`, { url: `http://localhost/customers${hash}`, pretendToBeVisual: true })
  const keys=['window','document','HTMLElement','HTMLInputElement','Event','CustomEvent','StorageEvent','fetch','IS_REACT_ACT_ENVIRONMENT']
  const previous=Object.fromEntries(keys.map(key=>[key,globalThis[key]]))
  for(const key of keys)if(key in dom.window)globalThis[key]=dom.window[key]
  globalThis.IS_REACT_ACT_ENVIRONMENT=true
  const requests=[]
  globalThis.fetch=async(url,init={})=>{requests.push({url,init,body:init.body?JSON.parse(init.body):null});return handler(url,init)}
  const { InvoiceDisputeList }=loadTypeScriptModule('app/collections/customers/CustomerInvoiceDisputes.tsx',{mocks:{react:React,'react/jsx-runtime':runtime}})
  const props={tenantId:'synthetic',customerSourceId:'synthetic',customerName:'Fictional',invoices,workspace:true,
    reload:async()=>true,onChanged:async()=>true,onPromiseRefresh:async()=>true,onMutationStarted(){},onMutationPending(){},onMutationResult(){}}
  const { createRoot } = await import('react-dom/client')
  const root=createRoot(dom.window.document.getElementById('root'))
  await act(async()=>root.render(React.createElement(InvoiceDisputeList,props)))
  const container=dom.window.document.getElementById('root')
  const button=label=>[...container.querySelectorAll('button')].find(node=>node.getAttribute('aria-label')===label||node.textContent.trim()===label)
  const click=async label=>{const node=button(label);assert.ok(node,label);await act(async()=>node.click())}
  const change=async(control,value)=>await act(async()=>{const key=Object.keys(control).find(k=>k.startsWith('__reactProps$'));control[key].onChange({target:{value,checked:value}})})
  return {container,requests,button,click,change,dom,cleanup:async()=>{await act(async()=>root.unmount());Object.assign(globalThis,previous);dom.window.close()}}
}

test('ordinary row has one labelled disclosure, native outstanding, no normal-state jargon or eager reads',async()=>{
  const ui=await setup()
  try{
    const row=ui.container.querySelector('article')
    assert.doesNotMatch(row.textContent,/Open in accounting|No dispute/)
    assert.match(row.textContent,/Outstanding GBP/);assert.match(row.textContent,/£4,792.50/)
    const control=ui.button('Manage invoice INV-ORDINARY'),details=ui.dom.window.document.getElementById(control.getAttribute('aria-controls'))
    assert.equal(control.getAttribute('aria-expanded'),'false');assert.equal(details.hidden,true)
    await ui.click('Manage invoice INV-ORDINARY');assert.equal(details.hidden,false)
    await ui.click('Close invoice details');assert.equal(details.hidden,true);assert.equal(ui.dom.window.document.activeElement,control)
    assert.equal(ui.requests.length,0)
  }finally{await ui.cleanup()}
})

test('closing and reopening keeps the dispute amount, note, mode and displayed revision',async()=>{
  const ui=await setup([invoiceFixture],async()=>new Response(JSON.stringify({ok:true})))
  try{
    await ui.click('Manage invoice INV-1048');await ui.click('Edit dispute')
    await ui.change(ui.container.querySelector('input[inputmode="decimal"]'),'456.78')
    await ui.change(ui.container.querySelector('textarea'),'Fictional draft')
    await ui.click('Close invoice INV-1048');await ui.click('Manage invoice INV-1048')
    assert.equal(ui.container.querySelector('input[inputmode="decimal"]').value,'456.78')
    assert.equal(ui.container.querySelector('textarea').value,'Fictional draft');assert.equal(ui.requests.length,0)
    await ui.click('Save dispute')
    assert.equal(ui.requests.length,1);assert.equal(ui.requests[0].body.disputedAmountNative,'456.78')
    assert.equal(ui.requests[0].body.expected_revision,'4');assert.equal(ui.requests[0].body.note,'Fictional draft')
  }finally{await ui.cleanup()}
})

test('Promise draft and uncertain command identity survive invoice collapse without extra reads',async()=>{
  let attempt=0
  const ui=await setup([ordinary],async()=>{if(attempt++===0)throw Error('Uncertain response');return new Response(JSON.stringify({ok:true,promise:{id:'fictional',revision:'1',status:'active',promisedAmountNative:'123.45',promisedDate:'2026-10-20',qualifyingPaidAmountNative:'0'}}))})
  try{
    await ui.click('Manage invoice INV-ORDINARY');await ui.click('Record promise')
    await ui.change(ui.container.querySelector('input[inputmode="decimal"]'),'123.45')
    await ui.change(ui.container.querySelector('input[type="date"]'),'2026-10-20')
    await ui.change(ui.container.querySelector('textarea'),'Retained draft')
    await ui.click('Close invoice INV-ORDINARY');await ui.click('Manage invoice INV-ORDINARY')
    assert.equal(ui.container.querySelector('input[inputmode="decimal"]').value,'123.45')
    assert.equal(ui.container.querySelector('textarea').value,'Retained draft');assert.equal(ui.requests.length,0)
    const submit=async()=>await act(async()=>ui.container.querySelector('form').dispatchEvent(new ui.dom.window.Event('submit',{bubbles:true,cancelable:true})))
    await submit();assert.match(ui.container.textContent,/Retry with the same details/)
    await ui.click('Close invoice INV-ORDINARY');await ui.click('Manage invoice INV-ORDINARY');await submit()
    assert.equal(ui.requests.length,2);assert.equal(ui.requests[0].body.commandId,ui.requests[1].body.commandId)
    assert.equal(ui.requests[1].body.amount,'123.45')
  }finally{await ui.cleanup()}
})

test('pending Promise cannot duplicate a write after closing and reopening',async()=>{
  let resolve
  const ui=await setup([invoiceFixture],()=>new Promise(done=>{resolve=done}))
  try{
    await ui.click('Manage invoice INV-1048');await ui.click('Edit promise')
    await ui.change(ui.container.querySelector('input[inputmode="decimal"]'),'800')
    await act(async()=>ui.container.querySelector('form').dispatchEvent(new ui.dom.window.Event('submit',{bubbles:true,cancelable:true})))
    assert.equal(ui.requests.length,1)
    await ui.click('Close invoice INV-1048');await ui.click('Manage invoice INV-1048')
    assert.equal(ui.button('Saving…').disabled,true)
    await act(async()=>ui.container.querySelector('form').dispatchEvent(new ui.dom.window.Event('submit',{bubbles:true,cancelable:true})))
    assert.equal(ui.requests.length,1)
    await act(async()=>resolve(new Response(JSON.stringify({ok:true,promise:{...invoiceFixture.activePromise,promisedAmountNative:'800'}}))))
  }finally{await ui.cleanup()}
})

test('bulk actions start quietly collapsed and selection survives disclosure changes',async()=>{
  const ui=await setup([ordinary,invoiceFixture])
  try{
    const bulk=ui.container.querySelector('details')
    assert.equal(bulk.open,false);assert.equal(bulk.querySelector('summary').textContent,'Bulk actions')
    const checkbox=ui.container.querySelector('input[type="checkbox"]')
    await ui.change(checkbox,true)
    assert.match(bulk.querySelector('summary').textContent,/1 selected/)
    bulk.open=true;bulk.open=false
    assert.equal(checkbox.checked,true);assert.equal(ui.requests.length,0)
  }finally{await ui.cleanup()}
})

test('exception warnings and precise coverage survive collapsed rows without altering membership',async()=>{
  const rows=[invoiceFixture,{...ordinary,invoiceSourceId:'review',needsReview:true},
    {...ordinary,invoiceSourceId:'settled',invoiceState:'settled',isActive:true},
    {...ordinary,invoiceSourceId:'unavailable',invoiceState:'unavailable',currencyCode:null,currentAmountDueNative:null},
    {...ordinary,invoiceSourceId:'invalid',invoiceState:'invalid',currentAmountDueNative:null}]
  const ui=await setup(rows)
  try{
    assert.equal(ui.container.querySelectorAll('article').length,5)
    const visibleText=[...ui.container.querySelectorAll('article')].map(row=>row.firstElementChild.textContent).join(' ')
    assert.match(visibleText,/£750.00 coverage/);assert.match(visibleText,/£1,200.00 disputed/)
    assert.match(visibleText,/Balance changed/);assert.match(visibleText,/dispute remains unresolved/)
    assert.match(visibleText,/Unavailable in current accounting data/);assert.match(visibleText,/Accounting balance unavailable/)
  }finally{await ui.cleanup()}
})

test('invoice fragments reveal management on initial load and later hash navigation',async()=>{
  const ui=await setup([ordinary,invoiceFixture],undefined,'#invoice-ordinary')
  try{
    assert.equal(ui.button('Close invoice INV-ORDINARY').getAttribute('aria-expanded'),'true')
    await act(async()=>{ui.dom.window.location.hash='#invoice-synthetic-invoice-1';ui.dom.window.dispatchEvent(new ui.dom.window.Event('hashchange'))})
    assert.equal(ui.button('Close invoice INV-1048').getAttribute('aria-expanded'),'true')
    assert.equal(ui.requests.length,0)
  }finally{await ui.cleanup()}
})
