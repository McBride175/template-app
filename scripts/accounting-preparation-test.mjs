// Test-only lifecycle operator. Credentials remain environment/stdin only.
import {execFileSync} from 'node:child_process'
import {existsSync,readFileSync,writeFileSync} from 'node:fs'
const project='rbmxegyiwntomhpbepnu',temp='/private/tmp/yuohme74-preparation.json'
const job='7fdd5c13-561c-4ff8-88fd-114c4b742a1a',generation='3f31db81-8dcc-493f-99cd-4547bc3bd0b1'
if(readFileSync('supabase/.temp/project-ref','utf8').trim()!==project||new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname!==project+'.supabase.co')throw new Error('Test preflight failed')
const pooler=new URL(readFileSync('supabase/.temp/pooler-url','utf8').trim())
if(pooler.username!=='postgres.'+project||!process.env.SUPABASE_DB_PASSWORD)throw new Error('Test database preflight failed')
const q=s=>"'"+String(s).replaceAll("'","''")+"'"
const sql=query=>{try{return execFileSync('docker',['exec','-i','-e','PGHOST='+pooler.hostname,'-e','PGPORT='+(pooler.port||'5432'),'-e','PGUSER='+pooler.username,'-e','PGDATABASE=postgres','-e','PGSSLMODE=require','supabase_db_template-app','sh','-c','IFS= read -r PGPASSWORD;export PGPASSWORD;exec psql -X -q -v ON_ERROR_STOP=1 -At'],{input:process.env.SUPABASE_DB_PASSWORD+'\n'+query,encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim()}catch{throw new Error('Guarded Test SQL failed (details suppressed)')}}
const json=query=>JSON.parse(sql(query)||'null')
let config=existsSync(temp)?JSON.parse(readFileSync(temp,'utf8')):{}
const save=()=>writeFileSync(temp,JSON.stringify(config),{mode:0o600})
const fingerprints=()=>Object.fromEntries(['xero_raw','xero_sync_runs','xero_sync_tenant_state','canonical_organisations','canonical_customers','canonical_invoices','canonical_payments','canonical_payment_evidence','canonical_unapplied_cash_evidence','canonical_credit_note_evidence','xero_customer_credit_validations','invoice_promises','invoice_promise_events','invoice_disputes','customer_overrides','collection_actions','billing_usage_days','subscriptions','collection_dependency_heads','collection_customer_financial_revisions'].map(table=>[table,json(`select jsonb_build_array(count(*),md5(coalesce(string_agg(row_to_json(t)::text,'' order by row_to_json(t)::text),''))) from public.${table} t;`)]))
const action=process.argv[2]
if(action==='preflight'){
 const held=json(`select jsonb_build_object('job',j.id,'phase',j.phase,'stage',j.work_stage,'G',j.generation_run_id,'activeG',s.active_sync_run_id,
 'F',d.financial_epoch,'P',d.projection_revision,'epoch',j.connection_epoch,'currentEpoch',c.connection_epoch,'healthy',x.auth_state='active',
 'worker',j.worker_id,'attempt',j.attempt_number,'status',r.status,'providerRequests',b.diagnostics->'providerRequests',
 'calculations',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'F',financial_epoch,'date',evaluation_date,'overdueOnly',overdue_only,'basis',basis_version,'feature',feature_version,'model',scoring_model_version,'version',calculation_version,'evidence',evidence_identity)),'[]') from public.collection_portfolio_calculations where user_id=j.user_id and tenant_id=j.provider_organisation_id and generation_id=j.generation_run_id))
 from public.accounting_refresh_jobs j join public.accounting_refresh_connections c on c.id=j.connection_id
 join public.xero_connections_public x on x.user_id=j.user_id and x.tenant_id=j.provider_organisation_id
 join public.xero_sync_runs r on r.id=j.generation_run_id join public.xero_sync_tenant_state s on s.user_id=j.user_id and s.tenant_id=j.provider_organisation_id
 join public.collection_dependency_heads d on d.user_id=j.user_id and d.tenant_id=j.provider_organisation_id and d.source_system='xero'
 left join accounting_refresh_private.xero_runs b on b.sync_run_id=r.id where j.id=${q(job)};`)
 if(!held||held.phase!=='preparing'||held.stage!=='derivatives'||held.G!==generation||held.activeG!==generation||held.epoch!==held.currentEpoch||!held.healthy||held.worker!==null||held.status!=='succeeded')throw new Error('Unexpected parked Test authority')
 config.before=held;config.fingerprints=fingerprints();save();console.log(JSON.stringify(held))
}else if(action==='prepare-env'){
 const link=JSON.parse(readFileSync('.vercel/project.json','utf8'))
 if(link.projectId!=='prj_KP5fDQnF923Ibr1AOlkq29FkXa4h')throw new Error('Wrong Vercel project')
 execFileSync('vercel',['env','add','ACCOUNTING_REFRESH_PREPARATION_ENABLED','preview','--git-branch','develop','--force','--no-sensitive','--yes','--non-interactive'],{input:'1',stdio:['pipe','pipe','pipe']})
 console.log('Preparation enabled in Preview/develop environment only')
}else if(action==='inject'){
 if(!config.before)throw new Error('Preflight required')
 sql(`insert into accounting_refresh_private.preparation_test_controls(job_id,scenario) values(${q(job)},'fail_after_features_once');`)
 console.log('One preparation-only failure injected after feature ensure; provider gate unchanged')
}else if(action==='enable'||action==='disable'){
 sql(`update accounting_refresh_private.dispatch_config set preparation_enabled=${action==='enable'},updated_at=clock_timestamp() where singleton and project_ref=${q(project)};`)
 console.log('Test preparation dispatch '+(action==='enable'?'enabled':'disabled'))
}else if(action==='dispatch'){
 console.log(sql("select public.dispatch_accounting_refresh('immediate');"))
}else if(action==='status'){
 const r=json(`select jsonb_build_object('job',id,'phase',phase,'stage',work_stage,'attempt',attempt_number,'retry',preparation_retry_count,
 'due',next_eligible_at,'failure',failure_class,'kind',completion_kind,'identity',completion_identity,'diagnostics',preparation_diagnostics,
 'completedAt',completed_at,'claimedAt',claimed_at,'heartbeatAt',heartbeat_at) from public.accounting_refresh_jobs where id=${q(job)};`)
 config.result=r;save();console.log(JSON.stringify(r))
}else if(action==='integrity'){
 if(!config.fingerprints)throw new Error('Preflight fingerprints required')
 const after=fingerprints(),changed=Object.keys(after).filter(table=>JSON.stringify(after[table])!==JSON.stringify(config.fingerprints[table]))
 const requests=json(`select diagnostics->'providerRequests' from accounting_refresh_private.xero_runs where sync_run_id=${q(generation)};`)
 console.log(JSON.stringify({changedBusinessTables:changed,providerRequestDelta:requests-config.before.providerRequests}))
 if(changed.length||requests!==config.before.providerRequests)throw new Error('Preparation altered provider/business authority')
}else if(action==='cleanup'){
 if(sql(`select phase from public.accounting_refresh_jobs where id=${q(job)};`)!=='complete')throw new Error('Legitimate job must be complete before fixture cleanup')
 sql(`delete from accounting_refresh_private.preparation_test_controls where job_id=${q(job)};`)
 console.log('Controlled injection removed; legitimate completed job history retained')
}else throw new Error('Unknown guarded preparation operation')
