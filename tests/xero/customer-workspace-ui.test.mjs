import assert from 'node:assert/strict'
import test from 'node:test'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import { loadTypeScriptModule } from './test-helpers/ts-module-loader.mjs'
const { customerFixtures, invoiceFixture } = loadTypeScriptModule('stories/ui/customerFixture.ts')
const runtime = await import('react/jsx-runtime')

async function setup({ hash = '', invoices = [], originQueueCustomer = null, originPromises = null } = {}) {
  const dom=new JSDOM('<!doctype html><div id="root"></div>',{url:`http://localhost/customers?tenantId=synthetic&customerSourceId=synthetic-1${originQueueCustomer ? '&queueCustomerSourceId='+originQueueCustomer : ''}${originPromises ? '&promisesReturn='+encodeURIComponent(originPromises) : ''}${hash}`,pretendToBeVisual:true})
  const keys=['window','document','HTMLElement','HTMLInputElement','Event','CustomEvent','StorageEvent','fetch','IS_REACT_ACT_ENVIRONMENT']
  const previous=Object.fromEntries(keys.map(key=>[key,globalThis[key]]))
  for(const key of keys)if(key in dom.window)globalThis[key]=dom.window[key]
  globalThis.IS_REACT_ACT_ENVIRONMENT=true
  dom.window.HTMLElement.prototype.scrollIntoView=function(){}
  dom.window.matchMedia=()=>({matches:true});dom.window.confirm=()=>true
  const requests=[],router={push(){},replace(){}}, rows=customerFixtures.map(row=>({...row}))
  globalThis.fetch=async(url,init={})=>{
    const path=new URL(String(url),'http://localhost'),method=init.method??'GET'
    requests.push({path:path.pathname,query:Object.fromEntries(path.searchParams),method,body:init.body?JSON.parse(init.body):null})
    if(path.pathname==='/api/collections/override') {const body=JSON.parse(init.body);rows.find(row=>row.customer_source_id===body.customer_source_id).override_level=body.override_level;return new Response(JSON.stringify({ok:true}))}
    if(path.pathname==='/api/collections/customers')return new Response(JSON.stringify({ok:true,rows,tenantId:'synthetic',organisationBaseCurrency:'GBP',currencyContext:{mode:'single_currency'},currencyAccess:{allowed:true},currencyHealth:{status:'healthy'}}))
    if(path.pathname==='/api/collections/customer-detail'){const id=path.searchParams.get('customerSourceId');return new Response(JSON.stringify({ok:true,customerSourceId:id,tenantId:'synthetic',row:rows.find(row=>row.customer_source_id===id),invoices,organisationBaseCurrency:'GBP',currencyHealth:{status:'healthy'}}))}
    throw Error('Unexpected request '+path)
  }
  const Link=({href,children,...props})=>React.createElement('a',{href,...props},children)
  const Client=loadTypeScriptModule('app/collections/customers/CustomerCollectionsClient.tsx',{mocks:{react:React,'react/jsx-runtime':runtime,'next/link':Link,'next/navigation':{useRouter:()=>router}}}).default
  const container=dom.window.document.getElementById('root'),root=createRoot(container)
  await act(async()=>root.render(React.createElement(Client,{tenantId:'synthetic',initialCustomerSourceId:'synthetic-1'})))
  const click=async(button)=>{assert.ok(button);await act(async()=>button.click())}
  const button=label=>[...container.querySelectorAll('button')].find(node=>node.textContent.trim()===label)
  const change=async(control,value)=>await act(async()=>{const key=Object.keys(control).find(k=>k.startsWith('__reactProps$'));control[key].onChange({target:{value,checked:value}})})
  return {container,requests,button,click,change,dom,cleanup:async()=>{await act(async()=>root.unmount());Object.assign(globalThis,previous);dom.window.close()}}
}

test('discovery keeps existing request counts, filter/sort contracts and tenant/customer URL selection',async()=>{
  const ui=await setup()
  try{
    assert.equal(ui.requests.length,2,'detail and list are independent initial reads')
    assert.equal(ui.requests[0].path,'/api/collections/customer-detail')
    await ui.change(ui.container.querySelector('input[type="search"]'),'cedar')
    assert.equal(ui.requests.length,2,'local search does not refetch')
    const customer=[...ui.container.querySelectorAll('button[aria-pressed]')].find(x=>x.textContent.includes('Cedar'))
    await ui.click(customer)
    assert.equal(ui.requests.length,3)
    assert.equal(ui.requests[2].path,'/api/collections/customer-detail')
    assert.equal(ui.requests[2].query.customerSourceId,'synthetic-2')
    assert.equal(new URL(ui.dom.window.location.href).searchParams.get('tenantId'),'synthetic')
    assert.equal(new URL(ui.dom.window.location.href).searchParams.get('customerSourceId'),'synthetic-2')
    assert.equal(ui.container.querySelector('input[type="search"]').value,'cedar')
    await ui.change(ui.container.querySelector('select'),'customer_name:asc')
    assert.equal(ui.requests.at(-1).query.sortBy,'customer_name');assert.equal(ui.requests.at(-1).query.sortDir,'asc');assert.equal(ui.requests.at(-1).query.limit,'200')
    await ui.change(ui.container.querySelector('input[type="checkbox"]'),true)
    assert.equal(ui.requests.at(-1).query.overdueOnly,'true')
    const count=ui.requests.length
    await ui.click(ui.button('Close customer'))
    assert.equal(ui.requests.length,count,'closing leaves the list, filters and search mounted without a read')
    assert.equal(ui.container.querySelector('input[type="search"]').value,'cedar')
    assert.equal(ui.container.querySelector('select').value,'customer_name:asc')
    assert.equal(ui.container.querySelector('input[type="checkbox"]').checked,true)
  }finally{await ui.cleanup()}
})

test('priority controls reuse the current list row and can return to Normal after a save',async()=>{
  const ui=await setup()
  try{
    const control=()=>ui.container.querySelector('select[id="customer-context-synthetic-1"]')
    await ui.change(control(),'priority');assert.equal(control().value,'priority')
    await ui.change(control(),'normal');assert.equal(control().value,'normal')
    const writes=ui.requests.filter(x=>x.method==='POST')
    assert.deepEqual(writes.map(x=>x.body.override_level),['priority','normal'])
    assert.ok(writes.every(x=>x.path==='/api/collections/override'&&x.body.tenant_id==='synthetic'))
    assert.equal(ui.requests.filter(x=>x.path==='/api/collections/customer-detail').length,1)
  }finally{await ui.cleanup()}
})

test('invoice deep links focus the existing selected invoice and retain history/queue context',async()=>{
  const ui=await setup({hash:'#invoice-synthetic-invoice-1',invoices:[invoiceFixture]})
  try{
    assert.equal(ui.dom.window.document.activeElement.id,'invoice-synthetic-invoice-1')
    const links=[...ui.container.querySelectorAll('a')]
    assert.equal(links.find(x=>x.textContent==='View history').getAttribute('href'),'/customers/synthetic-1/history?tenantId=synthetic')
    assert.equal(links.find(x=>x.textContent==='Back to Priorities').getAttribute('href'),'/dashboard?tenantId=synthetic#collection-actions')
    assert.equal(ui.requests.length,2)
  }finally{await ui.cleanup()}
})

for(const section of ['customer-invoices','customer-promises','customer-overview'])test(`asynchronous customer loading honours the ${section} deep link without another read`,async()=>{
  const ui=await setup({hash:'#'+section,invoices:[invoiceFixture]})
  try{
    assert.equal(ui.dom.window.document.activeElement.id,section)
    assert.equal(ui.requests.length,2)
  }finally{await ui.cleanup()}
})

test('customer deep dive and history retain originating queue identity while browsing another account',async()=>{
  const ui=await setup({originQueueCustomer:'synthetic-2'})
  try{
    const back=()=>[...ui.container.querySelectorAll('a')].find(x=>x.textContent==='Back to Priorities')
    assert.equal(new URL(back().href).searchParams.get('queueCustomerSourceId'),'synthetic-2')
    const history=[...ui.container.querySelectorAll('a')].find(x=>x.textContent==='View history')
    assert.equal(new URL(history.href).searchParams.get('queueCustomerSourceId'),'synthetic-2')
    const customer=[...ui.container.querySelectorAll('button[aria-pressed]')].find(x=>x.textContent.includes('Cedar'))
    await ui.click(customer)
    assert.equal(new URL(back().href).searchParams.get('queueCustomerSourceId'),'synthetic-2')
    assert.equal(ui.requests.length,3)
  }finally{await ui.cleanup()}
})

test('Promises deep dive preserves list filters and invoice focus through customer/history links without extra reads',async()=>{
  const origin='/promises?status=active&date=passed&page=2&pageSize=25&tenantId=synthetic&q=Northbridge'
  const ui=await setup({hash:'#invoice-synthetic-invoice-1',invoices:[invoiceFixture],originPromises:origin})
  try{
    const links=[...ui.container.querySelectorAll('a')]
    assert.equal(links.find(x=>x.textContent==='Back to Promises').getAttribute('href'),origin)
    const history=new URL(links.find(x=>x.textContent==='View history').getAttribute('href'),'http://localhost')
    assert.equal(history.searchParams.get('promisesReturn'),origin)
    assert.equal(ui.requests.length,2)
    assert.equal(ui.dom.window.document.activeElement.id,'invoice-synthetic-invoice-1')
  }finally{await ui.cleanup()}
})
