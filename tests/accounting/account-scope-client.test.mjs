import assert from 'node:assert/strict'
import test from 'node:test'
import React,{act} from 'react'
import {JSDOM} from 'jsdom'
import {loadTypeScriptModule} from '../xero/test-helpers/ts-module-loader.mjs'
const dom=new JSDOM('<!doctype html><html><body></body></html>',{url:'https://test.example/account',pretendToBeVisual:true})
for(const name of ['window','document','HTMLElement','Event','CustomEvent'])globalThis[name]=dom.window[name]
Object.defineProperty(globalThis,'navigator',{configurable:true,value:dom.window.navigator});globalThis.IS_REACT_ACT_ENVIRONMENT=true
const {createRoot}=await import('react-dom/client')
test('Account publishes its owned selected scope; historical disconnected organisations cannot hide Refresh',async()=>{
 const requests=[],selected='owned-active',router={replace(){}}
 const xero={connected:true,tenantId:selected,tenantName:'Fixture',authState:'active',syncState:'active',canSync:true,lastSyncedAt:'2026-10-08T12:00:00Z',connections:[{tenantId:selected,authState:'active',syncState:'active'},...['old-a','old-b'].map(tenantId=>({tenantId,authState:'disconnected',syncState:'disconnected'}))]}
 const publicStatus={connection:{provider:'xero',providerOrganisationId:selected,health:'healthy',displayName:'Xero'},accounting:{state:'valid',activeGenerationId:'G',accountingObservedAt:'2026-10-08T12:00:00Z',ageSeconds:43200,freshness:'materially_stale',derivatives:{state:'ready'}},work:{phase:'complete',stage:'derivatives',jobId:'job'},failure:null}
 const mocks={'next/navigation':{useRouter:()=>router,usePathname:()=>'/account',useSearchParams:()=>new URLSearchParams()},'next/link':{__esModule:true,default:({children,...p})=>React.createElement('a',p,children)},'@/lib/supabase':{supabase:{auth:{getUser:async()=>({data:{user:{id:'owner',email:'fixture@example.test'}}})}}},'@/lib/xero/account-status':{fetchXeroConnectionStatus:async()=>xero,resolveXeroAccountStatusView:()=> 'connected',shouldShowXeroConnectCta:()=>false},'@/app/components/SubscriptionStatus':{__esModule:true,default:()=>null},'@/app/components/ManageSubscriptionButton':{__esModule:true,default:()=>null},'@/app/components/ChangePasswordButton':{__esModule:true,default:()=>null}}
 const {default:Account}=loadTypeScriptModule('app/account/page.tsx',{mocks}),{default:Boundary}=loadTypeScriptModule('app/components/AccountingActivityBoundary.tsx',{mocks})
 const old=globalThis.fetch;globalThis.fetch=async url=>{requests.push(String(url));if(String(url).includes('refresh-status'))return String(url).includes('providerOrganisationId=owned-active')?Response.json({ok:true,status:publicStatus}):Response.json({error:'Choose organisation'},{status:409});if(String(url)==='/api/subscription')return Response.json({hasActive:true,status:'active'});return Response.json({ok:true,entitlement:{isPaid:true,plan:'paid'}})}
 const el=document.createElement('div');document.body.append(el);const root=createRoot(el)
 try{await act(async()=>root.render(React.createElement(React.Fragment,null,React.createElement(Boundary),React.createElement(Account))));assert.ok(requests.some(r=>r.includes('providerOrganisationId=owned-active')));assert.match(el.textContent,/Payments made since then/);assert.ok([...el.querySelectorAll('button')].some(b=>b.textContent==='Refresh'));assert.ok(!requests.some(r=>r==='/api/accounting/refresh'))}
 finally{await act(async()=>root.unmount());globalThis.fetch=old;el.remove()}
})
