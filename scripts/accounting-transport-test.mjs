// Test-only operator. Credentials stay in environment/stdin/private temp files.
import {execFileSync} from 'node:child_process'
import {readFileSync,writeFileSync,existsSync} from 'node:fs'
import {randomBytes,randomUUID} from 'node:crypto'
const project='rbmxegyiwntomhpbepnu',temp='/private/tmp/yuohme72-config.json'
if(readFileSync('supabase/.temp/project-ref','utf8').trim()!==project||new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname!==project+'.supabase.co')throw new Error('Test project preflight failed')
const url=new URL(readFileSync('supabase/.temp/pooler-url','utf8').trim())
if(url.username!=='postgres.'+project||!process.env.SUPABASE_DB_PASSWORD)throw new Error('Test database preflight failed')
const quote=s=>"'"+String(s).replaceAll("'","''")+"'"
const sql=query=>{
 const args=['exec','-i','-e','PGHOST='+url.hostname,'-e','PGPORT='+(url.port||'5432'),'-e','PGUSER='+url.username,'-e','PGDATABASE=postgres','-e','PGSSLMODE=require','supabase_db_template-app','sh','-c','IFS= read -r PGPASSWORD; export PGPASSWORD; exec psql -X -q -v ON_ERROR_STOP=1 -At']
 try{return execFileSync('docker',args,{input:process.env.SUPABASE_DB_PASSWORD+'\n'+query,encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim()}
 catch{throw new Error('Guarded Test SQL failed (details suppressed)')}
}
const json=query=>JSON.parse(sql(query)||'null')
let config=existsSync(temp)?JSON.parse(readFileSync(temp,'utf8')):{secret:randomBytes(32).toString('hex'),owner:randomUUID()}
const save=()=>writeFileSync(temp,JSON.stringify(config),{mode:0o600})
const action=process.argv[2]
if(action==='prepare-env'){
 save()
 for(const [name,value,sensitive] of [['ACCOUNTING_REFRESH_INTERNAL_SECRET',config.secret,true],['ACCOUNTING_REFRESH_SYNTHETIC_ENABLED','1',false]]){
  execFileSync('vercel',['env','add',name,'preview','--git-branch','develop','--force',sensitive?'--sensitive':'--no-sensitive','--yes','--non-interactive'],{input:value,stdio:['pipe','pipe','pipe']})
 }
 console.log('Preview/develop worker configuration set; secret not printed')
}else if(action==='configure'){
 const host=process.argv[3]
 if(!/^https:\/\/[a-zA-Z0-9-]+\.vercel\.app$/.test(host)||host.includes('-git-'))throw new Error('Exact immutable Preview required')
 config.url=host;save()
 sql(`do $$declare item record;begin
 for item in select * from (values(${quote(host+'/api/internal/accounting/refresh-worker')},'accounting_refresh_worker_url'),(${quote(config.secret)},'accounting_refresh_internal_secret')) s(value,name) loop
 if exists(select 1 from vault.secrets where name=item.name) then perform vault.update_secret((select id from vault.secrets where name=item.name),item.value);else perform vault.create_secret(item.value,item.name);end if;
 end loop;
 update accounting_refresh_private.dispatch_config set project_ref=${quote(project)},enabled=false where singleton;
 end $$;`)
 console.log('Test Vault exact URL/auth configured; values suppressed')
}else if(action==='activate'||action==='disable'){
 console.log(sql(`select public.set_accounting_refresh_cron(${action==='activate'});`))
}else if(action==='snapshot'){
 const file=readFileSync('tests/database/accounting-refresh-hosted-certification.sql','utf8')
 const names=[...file.split('business_tables text[]:=array[')[1].split('];')[0].matchAll(/'([^']+)'/g)].map(m=>m[1])
 config.fingerprints=Object.fromEntries(names.map(name=>[name,json(`select jsonb_build_array(count(*),md5(coalesce(string_agg(row_to_json(t)::text,'' order by row_to_json(t)::text),''))) from public.${name} t;`)]))
 save();console.log('31 business-table fingerprints captured; no payload output')
}else if(action==='seed'){
 const scenario=process.argv[3]??'complete',delay=Number(process.argv[4]??0),trigger=process.argv[5]??'internal'
 if(!['complete','delay_complete','retry_once','attention','disappear'].includes(scenario)||!Number.isInteger(delay)||delay<0||delay>40||!['internal','manual','onboarding','opportunistic','reconnect'].includes(trigger))throw new Error('Invalid synthetic request')
 const org='transport-'+randomUUID()
 const job=json(`do $$begin if not exists(select 1 from auth.users where id=${quote(config.owner)}) then insert into auth.users(id,aud,role,email,created_at,updated_at) values(${quote(config.owner)},'authenticated','authenticated',${quote(config.owner+'@transport.invalid')},now(),now());end if;end $$;
 with c as(select public.register_accounting_refresh_connection(${quote(config.owner)},'foundation_certification',${quote(org)},${quote(org)},'verified-test-fixture') r)
 select public.accept_accounting_refresh((r->>'connectionId')::uuid,${quote(config.owner)},'foundation_certification',${quote(org)},1,${quote(trigger)},${quote(randomUUID())})->'job' from c;`)
 sql(`insert into accounting_refresh_private.synthetic_jobs(job_id,scenario,delay_seconds) values(${quote(job.id)},${quote(scenario)},${delay});`)
 config.jobs??=[];config.jobs.push(job);save();console.log(JSON.stringify({jobId:job.id,scenario,delaySeconds:delay,phase:job.phase}))
}else if(action==='dispatch'){
 console.log(sql("select public.dispatch_accounting_refresh('immediate');"))
}else if(action==='idle'){
 const start=Date.now(),before=Number(sql('select count(*) from net._http_response;'))
 const tick=json("select public.dispatch_accounting_refresh('cron');")
 const after=Number(sql('select count(*) from net._http_response;'))
 const plans=['phase in(\'running\',\'preparing\') and attempt_expires_at>now()','delivery_owner is not null and delivery_expires_at>now()','phase in(\'queued\',\'retry_wait\') and next_eligible_at<=now()'].map(condition=>json('explain(analyze,buffers,format json) select id from public.accounting_refresh_jobs where '+condition+';'))
 console.log(JSON.stringify({tick,httpResponseDelta:after-before,clientMilliseconds:Date.now()-start,plans}))
}else if(action==='status'){
 console.log(sql(`select coalesce(jsonb_agg(jsonb_build_object('id',j.id,'phase',j.phase,'attempt',j.attempt_number,'retry',j.retry_count,'deliveryId',j.delivery_id,'nextEligibleAt',j.next_eligible_at,'epoch',j.connection_epoch,'heartbeats',s.heartbeat_count,'claims',s.claimed_count,'complete',s.completed_count,'failures',s.failure_count)),'[]'::jsonb) from public.accounting_refresh_jobs j join accounting_refresh_private.synthetic_jobs s on s.job_id=j.id where j.user_id=${quote(config.owner)};`))
}else if(action==='advance'){
 const id=process.argv[3],operation=process.argv[4]
 if(!config.jobs?.some(j=>j.id===id)||!['delivery_expire','attempt_expire','due','complete_mode','epoch'].includes(operation))throw new Error('Fixture-only operation required')
 if(operation==='epoch'){
  console.log(sql(`select public.advance_accounting_refresh_epoch(j.connection_id,j.user_id,j.provider,j.provider_organisation_id,c.connection_epoch,'disconnect') from public.accounting_refresh_jobs j join public.accounting_refresh_connections c on c.id=j.connection_id where j.id=${quote(id)};`))
 }else{
  if(operation==='complete_mode')sql(`update accounting_refresh_private.synthetic_jobs set scenario='complete',delay_seconds=0 where job_id=${quote(id)};`)
  else if(operation==='due')sql(`update public.accounting_refresh_jobs set next_eligible_at=now()-interval '1 second' where id=${quote(id)};update public.accounting_refresh_connections set cooldown_until=null,provider_not_before=null where id=(select connection_id from public.accounting_refresh_jobs where id=${quote(id)});`)
  else sql(`update public.accounting_refresh_jobs set ${operation==='delivery_expire'?'delivery_expires_at':'attempt_expires_at'}=now()-interval '1 second' where id=${quote(id)};`)
  console.log('Synthetic fixture control time/mode advanced')
 }
}else if(action==='duplicate'||action==='security'){
 if(!config.url)throw new Error('Exact Preview unavailable')
 const id=process.argv[3]??config.jobs?.at(-1)?.id
 const delivery=json(`select jsonb_build_object('jobId',id,'deliveryId',delivery_id) from public.accounting_refresh_jobs where id=${quote(id)} and user_id=${quote(config.owner)};`)
 const headers={'content-type':'application/json',authorization:'Bearer '+config.secret,'x-accounting-project-ref':project}
 const calls=action==='duplicate'?[{method:'POST',headers,body:JSON.stringify(delivery)}]:[
  {method:'GET'}, {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(delivery)},
  {method:'POST',headers:{...headers,authorization:'Bearer wrong'},body:JSON.stringify(delivery)},
  {method:'POST',headers,body:JSON.stringify({jobId:randomUUID(),deliveryId:randomUUID()})}]
 console.log(JSON.stringify(await Promise.all(calls.map(async init=>{const response=await fetch(config.url+'/api/internal/accounting/refresh-worker',init);return {status:response.status,body:await response.json()}}))))
}else if(action==='cleanup'){
 sql(`delete from auth.users where id=${quote(config.owner)};`)
 if(!config.fingerprints)throw new Error('Original fingerprints unavailable')
 for(const [name,before] of Object.entries(config.fingerprints)){
  const after=json(`select jsonb_build_array(count(*),md5(coalesce(string_agg(row_to_json(t)::text,'' order by row_to_json(t)::text),''))) from public.${name} t;`)
  if(JSON.stringify(after)!==JSON.stringify(before))throw new Error('Business integrity mismatch: '+name)
 }
 console.log('Synthetic fixtures cleaned; all 31 business fingerprints unchanged')
}else throw new Error('Unknown Test operation')
