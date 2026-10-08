// Local isolated SQL adapter. Production uses the ordinary service PostgREST
// client. Values are quoted; function/table names come only from held source.
export function workerClient(db) {
 const calls=[],literal=v=>v==null?'null':typeof v==='boolean'?String(v):typeof v==='number'?String(v):typeof v==='object'?db.json(v):db.quote(v)
 return {calls,async rpc(name,args) {
   calls.push({name,args});if(!/^[a-z_]+$/.test(name))throw new Error('invalid test RPC')
   try {
     const set=db.psql(`select proretset from pg_proc where proname=${db.quote(name)} and pronamespace='public'::regnamespace;`)==='t'
     const query=`public.${name}(${Object.entries(args).map(([k,v])=>`${k}=>${literal(v)}`).join(',')})`
     const result=await db.psqlAsync(`set role service_role;${set?`select coalesce(jsonb_agg(to_jsonb(r)),'[]') from ${query} r;`:`select to_jsonb(${query});`}`)
     return {data:JSON.parse(result),error:null}
   }catch(e){return {data:null,error:{code:/stale_|authority/.test(e.message)?'40001':'XX000',message:e.message}}}
 },from(table) {
   if(!/^[a-z_]+$/.test(table))throw new Error('invalid test table')
   const filters=[];return {select(){return this},eq(k,v){if(!/^[a-z_]+$/.test(k))throw new Error('invalid test field');filters.push(`${k}=${literal(v)}`);return this},
     then(resolve,reject){db.psqlAsync(`set role service_role;select coalesce(jsonb_agg(to_jsonb(r)),'[]') from public.${table} r where ${filters.join(' and ')};`).then(row=>resolve({data:JSON.parse(row),error:null}),reject)},
     order(){return this},async range(from,to){try {const rows=await db.psqlAsync(`set role service_role;select coalesce(jsonb_agg(to_jsonb(r)),'[]') from (select * from public.${table} where ${filters.join(' and ')} order by source_id limit ${Number(to)-Number(from)+1} offset ${Number(from)}) r;`);return {data:JSON.parse(rows),error:null}}catch(e){return {data:null,error:{message:e.message}}}},
     async maybeSingle(){try {const row=await db.psqlAsync(`set role service_role;select to_jsonb(r) from public.${table} r where ${filters.join(' and ')};`);return {data:row?JSON.parse(row):null,error:null}}catch(e){return {data:null,error:{message:e.message}}}}}
 }}
}
