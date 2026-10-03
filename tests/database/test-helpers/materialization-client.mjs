import { loadTypeScriptModule } from '../../xero/test-helpers/ts-module-loader.mjs'
export const server = loadTypeScriptModule('lib/collections/customer-materialization-server.ts')
export const pure = loadTypeScriptModule('lib/collections/customer-materialization.ts')
const literal = (db, key, value) => value === null ? 'null' : key==='p_results' ? db.json(value) : Array.isArray(value)
  ? `array[${value.map(db.quote).join(',')}]::text[]` : typeof value==='number' ? String(value) : db.quote(value)
export function databaseClient(db, hook) {
  const calls=[]
  return { calls, async rpc(name,args) {
    calls.push({ name,args })
    if(hook) await hook(name,args)
    try { const measured = JSON.parse(await db.psqlAsync(`set role service_role;with started as materialized(select clock_timestamp() t),result as materialized(select to_jsonb(public.${name}(${Object.entries(args).map(([key,value]) => `${key} => ${literal(db,key,value)}`).join(',')})) value from started) select jsonb_build_object('data',result.value,'databaseMs',extract(epoch from clock_timestamp()-started.t)*1000) from result cross join started;`)); calls.at(-1).databaseMs=Number(measured.databaseMs); return {data:measured.data,error:null} }
    catch(error) { return {data:null,error:{message:error.message}} }
  } }
}
export function params(db, admin, date='2026-10-01T12:00:00Z') {
  return { admin,userId:db.user,tenantId:'tenant-a',sourceSystem:'xero',evaluationInstant:new Date(date),metrics:server.newCustomerMaterializationMetrics() }
}
export function featureFromInputs(input, db, date='2026-10-01') {
  return input.bases.map(b => ({customerId:b.customerId,revision:b.revision,result:pure.calculateMaterializedCustomerFeature({
    basis:b.payload,userId:db.user,tenantId:'tenant-a',generationId:input.context.generationId,evaluationDate:date,
    certificate:input.context.certificate,disputes:input.disputes,
    promises:new Map(input.promises.map(p=>[p.invoice_source_id,p])),
  })}))
}
export function cert(db, run, extra='') {
  db.psql(`insert into public.xero_customer_credit_validations(sync_run_id,user_id,tenant_id,source_system,readiness_state,reason_code,consistency_result,
    credit_notes_started_at,credit_notes_completed_at,credit_notes_page_requests,credit_notes_populated_pages,credit_notes_source_count,credit_notes_mapped_count,credit_notes_invalid_count,credit_notes_complete,validation_started_at,validation_completed_at,validation_fencing_token,resource_observations)
    values('${run}','${db.user}','tenant-a','xero','ready','stable_observation','matched','2026-09-25','2026-09-25 00:01Z',1,0,0,0,0,true,'2026-09-25','2026-09-25',1,
      '{"initial":{"overpayments":{"count":0},"prepayments":{"count":0},"creditnotes":{"count":0}}}');${extra}`)
}
