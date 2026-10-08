// Explicit Test-only operator. No public acceptance endpoint. No tokens queried.
import {execFileSync} from 'node:child_process'
import {existsSync,readFileSync,writeFileSync} from 'node:fs'
import {randomUUID} from 'node:crypto'
const project='rbmxegyiwntomhpbepnu',temp='/private/tmp/yuohme73-certification.json'
if(readFileSync('supabase/.temp/project-ref','utf8').trim()!==project||new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname!==project+'.supabase.co')throw new Error('Test project preflight failed')
const pooler=new URL(readFileSync('supabase/.temp/pooler-url','utf8').trim())
if(pooler.username!=='postgres.'+project||!process.env.SUPABASE_DB_PASSWORD)throw new Error('Test database preflight failed')
const quote=s=>"'"+String(s).replaceAll("'","''")+"'"
const sql=query=>{try{return execFileSync('docker',['exec','-i','-e','PGHOST='+pooler.hostname,'-e','PGPORT='+(pooler.port||'5432'),'-e','PGUSER='+pooler.username,'-e','PGDATABASE=postgres','-e','PGSSLMODE=require','supabase_db_template-app','sh','-c','IFS= read -r PGPASSWORD; export PGPASSWORD; exec psql -X -q -v ON_ERROR_STOP=1 -At'],{input:process.env.SUPABASE_DB_PASSWORD+'\n'+query,encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim()}catch{throw new Error('Guarded Test SQL failed (details suppressed)')}}
const json=query=>JSON.parse(sql(query)||'null')
let config=existsSync(temp)?JSON.parse(readFileSync(temp,'utf8')):{}
const save=()=>writeFileSync(temp,JSON.stringify(config),{mode:0o600})
const action=process.argv[2],uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const fingerprints=()=>Object.fromEntries(['invoice_promises','invoice_promise_events','invoice_disputes','customer_overrides','collection_actions','billing_usage_days','subscriptions'].map(table=>[table,json(`select jsonb_build_array(count(*),md5(coalesce(string_agg(row_to_json(t)::text,'' order by row_to_json(t)::text),''))) from public.${table} t;`)]))
const promiseTerms=()=>json(`select jsonb_build_array(count(*),md5(coalesce(string_agg((to_jsonb(t)-array['status','updated_at','resolved_at','revision','qualifying_paid_amount_native','evaluated_sync_run_id','evaluated_at','resolution_reason_code','resolution_contract_version'])::text,'' order by id),''))) from public.invoice_promises t;`)
if(action==='preflight'){
 const owner=process.argv[3],tenant=process.argv[4]
 if(!uuid.test(owner??'')||!uuid.test(tenant??''))throw new Error('Explicit owned Test Xero connection required')
 config.owner=owner;config.tenant=tenant
 const held=json(`select jsonb_build_object('owner',x.user_id,'tenant',x.tenant_id,'health',x.auth_state,'linked',x.grant_id is not null,
 'generation',s.active_sync_run_id,'generationStatus',r.status,'fence',s.current_fencing_token,'F',d.financial_epoch,'P',d.projection_revision,
 'running',(select count(*) from public.xero_sync_runs where user_id=x.user_id and tenant_id=x.tenant_id and status='running'),
 'jobs',(select count(*) from public.accounting_refresh_jobs where phase not in('complete','cancelled')),
 'activePromises',(select count(*) from public.invoice_promises where user_id=x.user_id and tenant_id=x.tenant_id and status='active'))
 from public.xero_connections_public x join public.xero_sync_tenant_state s on s.user_id=x.user_id and s.tenant_id=x.tenant_id
 join public.xero_sync_runs r on r.id=s.active_sync_run_id left join public.collection_dependency_heads d on d.user_id=x.user_id and d.tenant_id=x.tenant_id and d.source_system='xero'
 where x.user_id=${quote(owner)} and x.tenant_id=${quote(tenant)};`)
 if(!held||held.health!=='active'||!held.linked||held.generationStatus!=='succeeded'||held.running!==0||held.jobs!==0)throw new Error('Unsafe Test connection provenance')
 config.before=held;config.fingerprints=fingerprints();config.promiseTerms=promiseTerms();save();console.log(JSON.stringify(held))
}else if(action==='prepare-env'){
 execFileSync('vercel',['env','add','ACCOUNTING_REFRESH_XERO_ENABLED','preview','--git-branch','develop','--force','--no-sensitive','--yes','--non-interactive'],{input:'1',stdio:['pipe','pipe','pipe']})
 console.log('Preview/develop real-Xero gate configured; Production untouched')
}else if(action==='enable'||action==='disable'){
 sql(`update accounting_refresh_private.dispatch_config set xero_enabled=${action==='enable'},updated_at=clock_timestamp() where singleton and project_ref=${quote(project)};`)
 console.log('Test real-Xero dispatch '+(action==='enable'?'enabled':'disabled'))
}else if(action==='epoch-barrier'){
 if(!config.owner||!config.tenant)throw new Error('Preflight required')
 // A rollback-only, database-authoritative race using a valid copied candidate.
 // It never calls Xero or dispatches a worker; the real connection stays intact.
 const file=readFileSync('tests/database/accounting-xero-hosted-epoch.sql','utf8')
 console.log(sql(`begin;select set_config('yuohme.cert_owner',${quote(config.owner)},true);select set_config('yuohme.cert_tenant',${quote(config.tenant)},true);${file}rollback;`))
 if(JSON.stringify(fingerprints())!==JSON.stringify(config.fingerprints))throw new Error('Epoch certificate changed operational state')
}else if(action==='accept'){
 if(!config.owner||!config.tenant||config.jobId)throw new Error('Fresh preflight required; no duplicate acceptance')
 const start=Date.now(),result=json(`select public.accept_test_xero_accounting_refresh(${quote(config.owner)},${quote(config.tenant)},${quote('phase73-'+randomUUID())});`)
 config.jobId=result.job.id;config.connection=result.job.connection;config.acceptedAt=new Date().toISOString();save()
 // Acceptance committed before the best-effort signal. No worker HTTP request
 // is held by this client: pg_net runs after the short dispatch transaction.
 const dispatch=json("select public.dispatch_accounting_refresh('immediate');")
 console.log(JSON.stringify({jobId:config.jobId,phase:result.job.phase,epoch:result.job.connection.epoch,acknowledgementMs:Date.now()-start,dispatch}))
}else if(action==='status'){
 if(!config.jobId)throw new Error('Accepted job required')
 const result=json(`select jsonb_build_object('jobId',j.id,'phase',j.phase,'stage',j.work_stage,'attemptId',j.attempt_id,'attemptNumber',j.attempt_number,
 'epoch',j.connection_epoch,'currentEpoch',c.connection_epoch,'workerLease',j.attempt_expires_at,'runId',j.generation_run_id,'failure',j.failure_class,'code',j.failure_code,
 'requestedAt',j.requested_at,'claimedAt',j.claimed_at,'runStarted',r.started_at,'promotedAt',r.completed_at,'status',r.status,
 'active',s.active_sync_run_id,'F',d.financial_epoch,'P',d.projection_revision,'handoff',b.handoff_at,'diagnostics',b.diagnostics,
 'generationCount',(select count(*) from public.xero_sync_runs where user_id=j.user_id and tenant_id=j.provider_organisation_id and started_at>=j.requested_at),
 'readiness',(select jsonb_agg(jsonb_build_object('contract',contract_version,'validatedAt',validated_at)) from public.xero_sync_run_validations where sync_run_id=r.id),
 'credit',(select jsonb_build_object('state',readiness_state,'reason',reason_code) from public.xero_customer_credit_validations where sync_run_id=r.id))
 from public.accounting_refresh_jobs j join public.accounting_refresh_connections c on c.id=j.connection_id
 left join public.xero_sync_runs r on r.id=j.generation_run_id left join public.xero_sync_tenant_state s on s.user_id=j.user_id and s.tenant_id=j.provider_organisation_id
 left join public.collection_dependency_heads d on d.user_id=j.user_id and d.tenant_id=j.provider_organisation_id and d.source_system='xero'
 left join accounting_refresh_private.xero_runs b on b.sync_run_id=r.id where j.id=${quote(config.jobId)};`)
 config.result=result;save();console.log(JSON.stringify(result))
}else if(action==='integrity'){
 const after=fingerprints();const changed=Object.keys(after).filter(table=>JSON.stringify(after[table])!==JSON.stringify(config.fingerprints[table]))
 console.log(JSON.stringify({changedOperationalTables:changed,counts:Object.fromEntries(Object.entries(after).map(([table,v])=>[table,v[0]]))}))
 if(changed.some(t=>!['invoice_promises','invoice_promise_events'].includes(t))||JSON.stringify(promiseTerms())!==JSON.stringify(config.promiseTerms))throw new Error('Operational terms/history integrity mismatch')
 const reconciliation=json(`select jsonb_build_object('evaluatedOnNewGeneration',count(*) filter(where evaluated_sync_run_id=${quote(config.result?.runId)}),'active',count(*) filter(where status='active'),'terminal',count(*) filter(where status<>'active')) from public.invoice_promises where user_id=${quote(config.owner)} and tenant_id=${quote(config.tenant)};`)
 console.log(JSON.stringify({promiseTermsPreserved:true,reconciliation}))
}else throw new Error('Unknown Test operation')
