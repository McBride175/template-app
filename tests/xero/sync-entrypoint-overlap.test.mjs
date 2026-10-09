import test from 'node:test'
import assert from 'node:assert/strict'
import {createRouteHarness,sleep} from './test-helpers/xero-sync-harness.mjs'
const path=new URL('../../app/api/internal/xero/sync/route.ts',import.meta.url)
const request=()=>new Request('http://localhost/api/internal/xero/sync',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer test-secret'},body:JSON.stringify({userId:'user-1',tenantId:'tenant-1'})})
async function internal(fn){const before=process.env.XERO_SYNC_INTERNAL_SECRET;process.env.XERO_SYNC_INTERNAL_SECRET='test-secret';try{await fn()}finally{if(before===undefined)delete process.env.XERO_SYNC_INTERNAL_SECRET;else process.env.XERO_SYNC_INTERNAL_SECRET=before}}
test('operator direct execution still cannot overlap a held generation admission lock',()=>internal(async()=>{
 const h=createRouteHarness({syncDelayMs:100});h.tenantLocks.set('user-1:tenant-1','held');const r=await h.loadRoute(path).POST(request());assert.equal(r.status,409);assert.equal(h.inflightSyncCalls.length,0)
}))
test('duplicate internal operator calls remain single flight',()=>internal(async()=>{
 const h=createRouteHarness({syncDelayMs:120}),route=h.loadRoute(path);const first=route.POST(request());await sleep(10);const second=route.POST(request());const r=await Promise.all([first,second]);assert.deepEqual(r.map(x=>x.status).sort(),[200,409]);assert.equal(h.inflightSyncCalls.length,1)
}))
