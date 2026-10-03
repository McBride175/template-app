import {loadTypeScriptModule} from '../../xero/test-helpers/ts-module-loader.mjs'
export const portfolio=loadTypeScriptModule('lib/collections/portfolio-materialization-server.ts')
export const calculation=loadTypeScriptModule('lib/collections/portfolio-materialization.ts')
export function client(db,hook){
 const calls=[]
 const literal=(key,value)=>value===null?'null':Array.isArray(value)&&key!=='p_results'?`array[${value.map(db.quote).join(',')}]::text[]`:typeof value==='object'?db.json(value):typeof value==='boolean'||typeof value==='number'?String(value):db.quote(value)
 return {calls,async rpc(name,args){
  const call={name,args};calls.push(call);if(hook)await hook(name,args)
  try{const m=JSON.parse(await db.psqlAsync(`set role service_role;with started as materialized(select clock_timestamp() t), result as materialized(select to_jsonb(public.${name}(${Object.entries(args).map(([k,v])=>`${k} => ${literal(k,v)}`).join(',')})) value from started) select jsonb_build_object('data',result.value,'databaseMs',extract(epoch from clock_timestamp()-started.t)*1000) from result cross join started;`));call.databaseMs=Number(m.databaseMs);call.bytes=Buffer.byteLength(JSON.stringify(m.data));return {data:m.data,error:null}}
  catch(error){return {data:null,error:{message:error.message}}}
 }}
}
export const parameters=(db,admin,date='2026-10-01T12:00:00Z',overdueOnly=true)=>({admin,userId:db.user,tenantId:'tenant-a',sourceSystem:'xero',evaluationInstant:new Date(date),scoringScope:'collections',overdueOnly,metrics:portfolio.newPortfolioCalculationMetrics()})
