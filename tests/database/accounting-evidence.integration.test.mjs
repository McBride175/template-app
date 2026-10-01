import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import test, {before,after} from 'node:test'
const enabled=process.env.RUN_SUPABASE_INTEGRATION==='1'
const container='supabase_db_template-app'
const database=`evidence_phase3a_${randomUUID().replaceAll('-','')}`
const user='00000000-0000-4000-8000-00000000a301'
const other='00000000-0000-4000-8000-00000000a302'
const owner='00000000-0000-4000-8000-00000000a303'
const grant='00000000-0000-4000-8000-00000000a304'
let created=false
const sql=value=>`'${String(value).replaceAll("'","''")}'`
const json=value=>`${sql(JSON.stringify(value))}::jsonb`
function psql(statement){return execFileSync('docker',['exec','-i',container,'psql','-X','-q','-v','ON_ERROR_STOP=1','-U','postgres','-d',database,'-At'],{input:statement,encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim()}
before(()=>{
  if(!enabled)return
  execFileSync('docker',['exec',container,'createdb','-U','postgres',database]);created=true
  psql(execFileSync('docker',['exec',container,'pg_dump','-U','postgres','-d','postgres','--schema=auth','--schema-only','--no-owner','--no-privileges'],{encoding:'utf8'}))
  const dir=new URL('../../supabase/migrations/',import.meta.url)
  for(const file of readdirSync(dir).filter(name=>name.endsWith('.sql')).sort())psql(readFileSync(new URL(file,dir),'utf8'))
  psql(`insert into auth.users(id,aud,role,email,created_at,updated_at) values
    ('${user}','authenticated','authenticated','evidence-a@example.test',now(),now()),('${other}','authenticated','authenticated','evidence-b@example.test',now(),now());
    insert into public.xero_oauth_grants(id,user_id,xero_user_id,scopes,refresh_token_encrypted) values('${grant}','${user}','synthetic',array['accounting.transactions.read'],'synthetic');
    insert into public.xero_connections_public(user_id,tenant_id,tenant_name,auth_state,grant_id) values('${user}','tenant-a','synthetic','active','${grant}');`)
})
after(()=>{if(created)execFileSync('docker',['exec',container,'dropdb','-U','postgres',database])})
const payment={source_id:'p1',invoice_source_id:'i1',customer_source_id:'c1',amount_native:'12345678901234567890.123456789012345678901',currency_code:'GBP',payment_date:'2026-09-12',payment_type:'ACCRECPAYMENT',payment_status:'AUTHORISED',source_updated_at:'2026-09-15T00:00:00Z'}
const cash={source_kind:'overpayment',source_id:'cash1',customer_source_id:'c1',provider_type:'RECEIVE-OVERPAYMENT',remaining_credit_native:'10.123456789012345678901',currency_code:'GBP',accounting_date:'2026-09-12',status:'AUTHORISED',source_updated_at:null,organisation_base_currency_code:'GBP',xero_currency_rate:null,remaining_credit_base:'10.123456789012345678901',currency_conversion_status:'identity',currency_conversion_failure_reason:null}
const observation=(resource,count=0,complete=true)=>({resource,started_at:'2026-09-30T22:59:59Z',completed_at:'2026-09-30T23:00:02Z',page_requests:count?2:1,populated_pages:count?1:0,source_count:count,complete})
const helpers=`
create function pg_temp.ok(value boolean,message text) returns void language plpgsql as $$ begin if value is distinct from true then raise exception '%',message;end if;end $$;
create function pg_temp.fails(statement text) returns void language plpgsql as $$begin begin execute statement;exception when others then return;end;raise exception 'Unexpected success: %',statement;end $$;
create temporary table fixture(run uuid);
insert into fixture select sync_run_id from public.acquire_xero_sync_run('${user}','tenant-a','${owner}','collections_v1',300);
insert into public.canonical_organisations(sync_run_id,user_id,tenant_id,source_organisation_id,base_currency_code,country_code,source_timezone,source_retrieved_at)
  select run,'${user}','tenant-a','tenant-a','GBP','GB','GMTSTANDARDTIME',now() from fixture;
insert into public.canonical_customers(sync_run_id,user_id,tenant_id,source_id,name) select run,'${user}','tenant-a','c1','synthetic' from fixture;
insert into public.canonical_invoices(sync_run_id,user_id,tenant_id,source_id,customer_source_id,type,transaction_currency_code,organisation_base_currency_code,currency_conversion_status)
  select run,'${user}','tenant-a','i1','c1','ACCREC','GBP','GBP','identity' from fixture;
create function pg_temp.store(observation jsonb,rows jsonb default '[]',user_id uuid default '${user}',tenant text default 'tenant-a',tz text default 'Europe/London')
returns void language sql as $$select public.persist_xero_accounting_evidence((select run from fixture),user_id,tenant,'${owner}',1,observation,rows,tz)$$;
create function pg_temp.store_credit(observation jsonb,rows jsonb default '[]',user_id uuid default '${user}',tenant text default 'tenant-a')
returns void language sql as $$select public.persist_xero_credit_note_evidence((select run from fixture),user_id,tenant,'${owner}',1,observation,rows)$$;
create function pg_temp.inspect() returns jsonb language sql as $$select public.inspect_xero_accounting_evidence((select run from fixture),'${user}','tenant-a')$$;
-- Administrative fixture promotion, not a replacement for the unchanged production promotion RPC.
create function pg_temp.promote_fixture() returns void language plpgsql as $$begin
  update public.xero_sync_runs set status='succeeded',lease_owner=null,lease_expires_at=null,completed_at=now() where id=(select run from fixture);
  update public.xero_sync_tenant_state set active_sync_run_id=(select run from fixture),last_successful_sync_at=now() where user_id='${user}' and tenant_id='tenant-a';end $$;
`
function check(statement){assert.match(psql(`begin;${helpers}${statement} select 'evidence_ok';rollback;`),/evidence_ok/)}
function store(resource,rows=[],overrides={}){return `select pg_temp.store(${json({...observation(resource,rows.length),...overrides})},${json(rows)});`}
function expectFailure(resource,rows,overrides={}){return `select pg_temp.fails(${sql(store(resource,rows,overrides))});`}
const creditNote={source_id:'cn1',customer_source_id:'c1',provider_type:'ACCRECCREDIT',status:'AUTHORISED',residual_state:'qualifying',
  remaining_credit_native:'12345678901234567890.123456789012345678901',currency_code:'GBP',organisation_base_currency_code:'GBP',
  xero_currency_rate:'1.000000000000000001',source_updated_at:'2026-09-29T10:00:00Z'}
function storeCredit(rows=[],overrides={}){return `select pg_temp.store_credit(${json({...observation('creditnotes',rows.length),...overrides})},${json(rows)});`}
const stableObservation=(count,signature,started_at,completed_at)=>({count,signature,started_at,completed_at,
  page_requests:count?2:1,populated_pages:count?1:0,complete:true})
const initialCreditObservations={
  invoices:stableObservation(1,'a'.repeat(64),'2026-09-30T22:59:59Z','2026-09-30T23:00:02Z'),
  overpayments:stableObservation(0,'b'.repeat(64),'2026-09-30T22:59:59Z','2026-09-30T23:00:02Z'),
  prepayments:stableObservation(0,'c'.repeat(64),'2026-09-30T22:59:59Z','2026-09-30T23:00:02Z'),
  creditnotes:stableObservation(0,'d'.repeat(64),'2026-09-30T22:59:59Z','2026-09-30T23:00:02Z'),
}
const verifiedCreditObservations=Object.fromEntries(Object.entries(initialCreditObservations).map(([resource,entry])=>[
  resource,{...entry,started_at:resource==='invoices'?'2026-09-30T23:00:03Z':'2026-09-30T23:00:05Z',
    completed_at:resource==='invoices'?'2026-09-30T23:00:04Z':'2026-09-30T23:00:06Z'},
]))
const stableCreditCertificate={readiness_state:'ready',reason_code:'stable_observation',consistency_result:'matched',
  validation_started_at:'2026-09-30T23:00:03Z',validation_completed_at:'2026-09-30T23:00:07Z',
  resource_observations:{initial:initialCreditObservations,verification:verifiedCreditObservations}}
function recordCredit(validation=stableCreditCertificate,identity={}){
  return `select public.record_xero_customer_credit_stability_validation((select run from fixture),
    '${identity.user??user}','${identity.tenant??'tenant-a'}','${identity.owner??owner}',${identity.fence??1},
    'customer_credit_v1','invoice_exact_v1',${json(validation)});`
}

test('stable complete empty credit streams can certify one fenced generation; later invoice or evidence writes invalidate it',
  {skip:!enabled},()=>check(`
    update public.canonical_invoices set status='AUTHORISED' where sync_run_id=(select run from fixture);
    ${store('overpayments')}${store('prepayments')}${storeCredit()}
    ${recordCredit()}
    select pg_temp.ok((select readiness_state='ready' and consistency_result='matched' and validation_fencing_token=1
      from public.xero_customer_credit_validations where sync_run_id=(select run from fixture)),'stable certificate');
    ${recordCredit()}
    select pg_temp.ok((select readiness_state='ready' from public.xero_customer_credit_validations
      where sync_run_id=(select run from fixture)),'idempotent certificate');
    update public.canonical_invoices set amount_due=1 where sync_run_id=(select run from fixture);
    select pg_temp.ok((select readiness_state='unavailable' and reason_code='evidence_changed_after_validation'
      from public.xero_customer_credit_validations where sync_run_id=(select run from fixture)),'late write invalidates');
    select pg_temp.fails(${sql(recordCredit())});
  `))
test('changed, incomplete, wrong-owner, and wrong-fence certificates cannot become ready', {skip:!enabled},()=>check(`
    update public.canonical_invoices set status='AUTHORISED' where sync_run_id=(select run from fixture);
    ${store('overpayments')}${store('prepayments')}${storeCredit()}
    select pg_temp.fails(${sql(recordCredit(stableCreditCertificate,{user:other}))});
    select pg_temp.fails(${sql(recordCredit(stableCreditCertificate,{fence:2}))});
    select pg_temp.fails(${sql(recordCredit({...stableCreditCertificate,resource_observations:{...stableCreditCertificate.resource_observations,
      verification:{...verifiedCreditObservations,creditnotes:{...verifiedCreditObservations.creditnotes,signature:'e'.repeat(64)}}}}))});
    select pg_temp.fails(${sql(recordCredit({...stableCreditCertificate,resource_observations:{...stableCreditCertificate.resource_observations,
      verification:{...verifiedCreditObservations,creditnotes:{...verifiedCreditObservations.creditnotes,started_at:'2026-09-30T23:00:01Z'}}}}))});
    ${recordCredit({...stableCreditCertificate,readiness_state:'unavailable',reason_code:'credit_state_changed',consistency_result:'changed'})}
    select pg_temp.ok((select readiness_state='unavailable' from public.xero_customer_credit_validations
      where sync_run_id=(select run from fixture)),'failed observation remains unavailable');
  `))

test('persisted numeric residual crosses exact view, canonical customer summary and DTO without binary rounding',
  {skip:!enabled},async()=>{
    const exactResidual=psql(`begin;${helpers}${storeCredit([creditNote])}
      select remaining_credit_native from public.canonical_customer_credit_evidence_exact where source_kind='credit_note';rollback;`)
    assert.equal(exactResidual,creditNote.remaining_credit_native)
    const { createDisputesJourney, journeyInvoice, USER_ID: journeyUser, TENANT_ID: journeyTenant } =
      await import('../xero/test-helpers/disputes-journey-fixture.mjs')
    const due='12345678901234567890.123456789012345678902'
    const app=createDisputesJourney({invoices:[journeyInvoice('a','acme',due)]})
    app.tables.xero_customer_credit_validations=[{sync_run_id:'generation-1',user_id:journeyUser,tenant_id:journeyTenant,
      source_system:'xero',contract_version:'customer_credit_v1',invoice_money_contract_version:'invoice_exact_v1',
      readiness_state:'ready',reason_code:'stable_observation',consistency_result:'matched',
      resource_observations:{initial:{overpayments:{count:0},prepayments:{count:0},creditnotes:{count:1}}}}]
    app.tables.canonical_customer_credit_evidence_exact=[{sync_run_id:'generation-1',user_id:journeyUser,
      tenant_id:journeyTenant,source_system:'xero',source_kind:'credit_note',source_id:'cn1',customer_source_id:'acme',
      provider_type:'ACCRECCREDIT',status:'AUTHORISED',residual_state:'qualifying',remaining_credit_native:exactResidual,
      currency_code:'GBP',organisation_base_currency_code:'GBP',xero_currency_rate:'1'}]
    const response=await app.customers()
    assert.equal(response.status,200)
    const row=response.body.rows.find(row=>row.customer_source_id==='acme')
    assert.equal(row.invoice_to_chase_overdue_base_decimal,due)
    assert.equal(row.available_customer_credit_base_decimal,exactResidual)
    assert.equal(row.customer_to_chase_overdue_base_decimal,'0.000000000000000000001')
    assert.equal(row.to_chase_outstanding_base_decimal,due)
  })

test('forward replay enables RLS and only scoped service operations; numeric survives the JSON read boundary', {skip:!enabled},()=>check(`
  grant select on fixture to service_role;
  set local role service_role; ${store('payments',[payment])}${store('overpayments',[cash])} reset role;
  select pg_temp.ok((select amount_native::text=${sql(payment.amount_native)} from public.canonical_payment_evidence),'numeric precision');
  select pg_temp.ok((select jsonb_typeof(to_jsonb(p)->'amount_native')='string' from public.canonical_payment_evidence_exact p),'API numeric type');
  select pg_temp.ok((select remaining_credit_native::text=${sql(cash.remaining_credit_native)} from public.canonical_unapplied_cash_evidence),'cash precision');
  do $$declare role_name text;table_name text;begin
    foreach role_name in array array['anon','authenticated','service_role'] loop
      foreach table_name in array array['canonical_payment_evidence','canonical_unapplied_cash_evidence','xero_accounting_evidence_observations'] loop
        perform pg_temp.ok((select relrowsecurity from pg_class where oid=('public.'||table_name)::regclass),'RLS');
        perform pg_temp.ok(not has_table_privilege(role_name,'public.'||table_name,'INSERT,UPDATE,DELETE,TRUNCATE'),'write grants');
        if role_name<>'service_role' then perform pg_temp.ok(not has_table_privilege(role_name,'public.'||table_name,'SELECT'),'browser read');end if;
      end loop;
    end loop;end $$;
`))
test('empty successful streams become ready only on authoritative successful generation; old generation remains unready',{skip:!enabled},()=>check(`
  select pg_temp.ok((pg_temp.inspect()->>'ready')::boolean=false,'old generation unready');
  ${store('payments')}${store('overpayments')}${store('prepayments')}
  select pg_temp.ok((pg_temp.inspect()->>'ready')::boolean=false,'candidate not authoritative');
  select pg_temp.promote_fixture();
  select pg_temp.ok((pg_temp.inspect()->>'ready')::boolean,'empty ready');
  select pg_temp.ok(jsonb_array_length(pg_temp.inspect()->'resources')=3,'three streams');
  select pg_temp.fails(${sql(store('payments',[payment]))});
`))
for(const resource of ['payments','overpayments','prepayments']){
 test(`${resource} incomplete or absent prevents readiness, never implies zero`,{skip:!enabled},()=>check(`
   ${store('payments')}${store('overpayments')}${store('prepayments')}
   ${store(resource,[],{complete:false,completed_at:null,page_requests:0,populated_pages:0})}
   select pg_temp.promote_fixture(); select pg_temp.ok((pg_temp.inspect()->>'ready')::boolean=false,'incomplete veto');
 `))
}
test('readiness structural guarantees reject inconsistent counts, termination and observation time',{skip:!enabled},()=>check(`
  ${expectFailure('payments',[],{source_count:1})}
  ${expectFailure('payments',[],{page_requests:0})}
  ${expectFailure('payments',[],{page_requests:1,populated_pages:1})}
  ${expectFailure('payments',[],{completed_at:'2026-09-30T22:59:58Z'})}
  select pg_temp.ok((select count(*)=0 from public.xero_accounting_evidence_observations),'failed write atomic');
`))
test('ownership, invoice currency, customer relationships and unique identities fail closed',{skip:!enabled},()=>check(`
  select pg_temp.fails(${sql(`select pg_temp.store(${json(observation('payments',1))},${json([payment])},'${other}');`)});
  select pg_temp.fails(${sql(`select pg_temp.store(${json(observation('payments',1))},${json([payment])},'${user}','other-tenant');`)});
  ${expectFailure('payments',[{...payment,currency_code:'USD'}])}
  ${expectFailure('payments',[{...payment,invoice_source_id:'missing'}])}
  ${expectFailure('overpayments',[{...cash,customer_source_id:'other'}])}
  ${expectFailure('payments',[payment,payment])}
  ${expectFailure('overpayments',[cash,cash])}
  select pg_temp.ok((select count(*)=0 from public.canonical_payment_evidence),'invalid batches atomic');
`))
test('status/type semantics, unsupported records, FX integrity and unavailable conversion retained',{skip:!enabled},()=>check(`
  ${store('payments',[{...payment,payment_status:'DELETED'},{...payment,source_id:'refund',invoice_source_id:null,customer_source_id:null,currency_code:null,payment_type:'ARCREDITPAYMENT'}])}
  ${store('overpayments',[{...cash,currency_code:'USD',xero_currency_rate:'1.5',remaining_credit_native:'120.123456789',remaining_credit_base:'80.08230453',currency_conversion_status:'converted'},
    {...cash,source_id:'unknown-fx',currency_code:'USD',remaining_credit_base:null,currency_conversion_status:'incomplete',currency_conversion_failure_reason:'missing_rate'}])}
  select pg_temp.ok((select remaining_credit_base is null from public.canonical_unapplied_cash_evidence where source_id='unknown-fx'),'FX unavailable not zero');
  ${expectFailure('overpayments',[{...cash,currency_conversion_status:'converted',currency_code:'USD',xero_currency_rate:'2',remaining_credit_base:'99'}])}
  ${expectFailure('overpayments',[{...cash,provider_type:'SPEND-OVERPAYMENT'}])}
  ${expectFailure('payments',[{...payment,amount_native:'NaN'}])}
`))
test('resource start survives completion after midnight and later promotion; unknown timezone prevents readiness',{skip:!enabled},()=>check(`
  ${store('payments')}${store('overpayments')}${store('prepayments')}
  select pg_temp.store(${json(observation('payments'))},'[]','${user}','tenant-a',null);
  select pg_temp.promote_fixture();
  select pg_temp.ok((pg_temp.inspect()->>'ready')::boolean=false,'unknown timezone');
  select pg_temp.ok((select started_at<'2026-09-30T23:00:00Z' and completed_at>'2026-09-30T23:00:00Z'
    from public.xero_accounting_evidence_observations where resource='payments'),'observation retains straddle');
`))
test('generation scope and account erasure retain the privacy boundary',{skip:!enabled},()=>check(`
  ${store('payments',[payment])}${store('overpayments',[cash])}
  select pg_temp.ok((public.inspect_xero_accounting_evidence(gen_random_uuid(),'${user}','tenant-a')->>'ready')::boolean=false,'other generation');
  select pg_temp.ok(jsonb_array_length(public.inspect_xero_accounting_evidence((select run from fixture),'${other}','tenant-a')->'resources')=0,'other owner');
  delete from auth.users where id='${user}';
  select pg_temp.ok((select count(*)=0 from public.canonical_payment_evidence),'privacy payments');
  select pg_temp.ok((select count(*)=0 from public.canonical_unapplied_cash_evidence),'privacy cash');
  select pg_temp.ok((select count(*)=0 from public.xero_accounting_evidence_observations),'privacy observation');
`))

test('same durable IDs in separate generations coexist without crossing ownership or evidence scope',{skip:!enabled},()=>check(`
  ${store('payments',[payment])}${store('overpayments',[cash])}
  create temporary table previous_run(id uuid);insert into previous_run values(gen_random_uuid());
  insert into public.xero_sync_runs(id,user_id,tenant_id,fencing_token,status,scope_version,required_steps,completed_at)
    select id,'${user}','tenant-a',10,'succeeded','collections_v1',
      array['organisation','contacts','authorised_accrec_invoices','paid_accrec_invoices','authorised_accrec_payments','canonical_mapping','validation'],now() from previous_run;
  insert into public.canonical_payment_evidence(sync_run_id,user_id,tenant_id,source_id,invoice_source_id,customer_source_id,amount_native,currency_code,payment_date,payment_type,payment_status)
    select id,'${user}','tenant-a','p1','i1','c1',5,'GBP','2026-09-12','ACCRECPAYMENT','AUTHORISED' from previous_run;
  insert into public.canonical_unapplied_cash_evidence(sync_run_id,user_id,tenant_id,source_kind,source_id,customer_source_id,provider_type,remaining_credit_native,currency_code,accounting_date,status,
    organisation_base_currency_code,remaining_credit_base,currency_conversion_status)
    select id,'${user}','tenant-a','overpayment','cash1','c1','RECEIVE-OVERPAYMENT',5,'GBP','2026-09-12','AUTHORISED','GBP',5,'identity' from previous_run;
  select pg_temp.ok((select count(*)=2 from public.canonical_payment_evidence where source_id='p1'),'payment generations coexist');
  select pg_temp.ok((select count(*)=2 from public.canonical_unapplied_cash_evidence where source_id='cash1'),'cash generations coexist');
  select pg_temp.ok((select amount_native::text=${sql(payment.amount_native)} from public.canonical_payment_evidence where sync_run_id=(select run from fixture)),'exact scoped amount');
  select pg_temp.ok((public.inspect_xero_accounting_evidence((select id from previous_run),'${user}','tenant-a')->>'ready')::boolean=false,'old successful generation is not evidence ready');
`))
test('complete evidence on a failed candidate is never authoritative',{skip:!enabled},()=>check(`
  ${store('payments')}${store('overpayments')}${store('prepayments')}
  update public.xero_sync_runs set status='failed',lease_owner=null,lease_expires_at=null,failed_at=now(),error_code='fixture_failure' where id=(select run from fixture);
  select pg_temp.ok((pg_temp.inspect()->>'ready')::boolean=false,'failed candidate');
`))

test('credit-note residuals persist exactly, remain separate from Promise, and never produce a ready certificate',{skip:!enabled},()=>check(`
  ${store('payments')}${store('overpayments',[cash])}${store('prepayments',[{...cash,source_kind:'prepayment',source_id:'cash2',provider_type:'RECEIVE-PREPAYMENT'}])}
  ${storeCredit([creditNote])}${storeCredit([creditNote])}
  select pg_temp.ok((select remaining_credit_native::text=${sql(creditNote.remaining_credit_native)}
    from public.canonical_credit_note_evidence where source_id='cn1'),'exact credit residual');
  select pg_temp.ok((select xero_currency_rate::text=${sql(creditNote.xero_currency_rate)}
    from public.canonical_credit_note_evidence where source_id='cn1'),'exact credit rate');
  select pg_temp.ok((select count(*)=3 from public.canonical_customer_credit_evidence_exact),'three distinct credit kinds');
  select pg_temp.ok((select count(distinct source_kind)=3 from public.canonical_customer_credit_evidence_exact),'source identity');
  select pg_temp.ok((select jsonb_typeof(to_jsonb(c)->'remaining_credit_native')='string'
    from public.canonical_customer_credit_evidence_exact c where source_kind='credit_note'),'exact read boundary');
  select pg_temp.ok((select count(*)=2 from public.canonical_unapplied_cash_evidence_exact),'Promise cash unaffected');
  select pg_temp.ok((select count(*)=3 from public.xero_accounting_evidence_observations),'Promise resources unchanged');
  select pg_temp.ok((select readiness_state='unavailable' and credit_notes_complete and credit_notes_source_count=1
    and invoice_money_contract_version='invoice_exact_v1' from public.xero_customer_credit_validations),'no ready certificate');
  select pg_temp.promote_fixture();
  select pg_temp.ok((pg_temp.inspect()->>'ready')::boolean,'Promise readiness unchanged');
`))

test('completed empty credit-note observation cannot silently become non-empty in the same run',{skip:!enabled},()=>check(`
  ${storeCredit()}
  select pg_temp.ok((select credit_notes_complete and credit_notes_source_count=0 and credit_notes_mapped_count=0
    and readiness_state='unavailable' from public.xero_customer_credit_validations),'complete empty');
  select pg_temp.fails(${sql(storeCredit([creditNote]))});
  select pg_temp.ok((select count(*)=0 from public.canonical_credit_note_evidence),'conflicting replay rolled back');
`))

test('invalid credit-note state remains visible and cannot be certified',{skip:!enabled},()=>check(`
  ${storeCredit([{...creditNote,status:'PAID',residual_state:'invalid'}])}
  select pg_temp.ok((select credit_notes_invalid_count=1 and readiness_state='unavailable'
    from public.xero_customer_credit_validations),'contradictory state retained');
  select pg_temp.ok((select status='PAID' and remaining_credit_native::text=${sql(creditNote.remaining_credit_native)}
    from public.canonical_credit_note_evidence),'positive paid residual not zeroed');
`))

test('incomplete credit-note traversal is not interpreted as observed zero',{skip:!enabled},()=>check(`
  ${storeCredit([],{complete:false,completed_at:null,page_requests:0,populated_pages:0})}
  select pg_temp.ok((select not credit_notes_complete and credit_notes_completed_at is null and readiness_state='unavailable'
    from public.xero_customer_credit_validations),'incomplete unavailable');
`))

test('credit-note scope, immutable replay and row security reject unsafe writes',{skip:!enabled},()=>check(`
  select pg_temp.fails(${sql(`select pg_temp.store_credit(${json(observation('creditnotes',1))},${json([creditNote])},'${other}');`)});
  select pg_temp.fails(${sql(`select pg_temp.store_credit(${json(observation('creditnotes',1))},${json([creditNote])},'${user}','other-tenant');`)});
  select pg_temp.fails(${sql(storeCredit([{...creditNote,customer_source_id:'wrong'}]))});
  ${storeCredit([creditNote])}
  select pg_temp.fails(${sql(storeCredit([{...creditNote,remaining_credit_native:'1'}]))});
  select pg_temp.fails(${sql(storeCredit([creditNote,creditNote]))});
  select pg_temp.ok((select count(*)=1 from public.canonical_credit_note_evidence),'conflicts did not overwrite');
  select pg_temp.ok((select relrowsecurity from pg_class where oid='public.canonical_credit_note_evidence'::regclass),'credit RLS');
  select pg_temp.ok(not has_table_privilege('authenticated','public.canonical_credit_note_evidence','SELECT,INSERT,UPDATE,DELETE'),'browser inaccessible');
  select pg_temp.ok(not has_table_privilege('service_role','public.xero_customer_credit_validations','INSERT,UPDATE,DELETE'),'no service ready bypass');
  select pg_temp.ok(not has_function_privilege('authenticated','public.persist_xero_credit_note_evidence(uuid,uuid,text,uuid,bigint,jsonb,jsonb)','EXECUTE'),'no browser RPC');
`))

test('combined credit view contains residuals once and excludes ordinary payments, allocations and refunds', {skip:!enabled},()=>check(`
  ${store('payments', [
    {...payment, amount_native:'300'},
    {...payment, source_id:'allocated-payment', amount_native:'200'},
    {...payment, source_id:'refund', invoice_source_id:null, customer_source_id:null, currency_code:null, payment_type:'ARCREDITPAYMENT', amount_native:'100'},
  ])}
  ${store('overpayments', [{...cash,remaining_credit_native:'100',remaining_credit_base:'100'}])}
  ${store('prepayments', [{...cash,source_kind:'prepayment',provider_type:'RECEIVE-PREPAYMENT',remaining_credit_native:'200',remaining_credit_base:'200'}])}
  ${storeCredit([{...creditNote,remaining_credit_native:'300',xero_currency_rate:'1'}])}
  select pg_temp.ok((select count(*)=3 and sum(remaining_credit_native::numeric)=600
    from public.canonical_customer_credit_evidence_exact),'only three exact residuals');
  select pg_temp.ok((select count(distinct source_kind)=3 from public.canonical_customer_credit_evidence_exact),'cash source kinds remain distinct even with same source ID');
  select pg_temp.ok((select count(*)=3 from public.canonical_payment_evidence),'payments retained separately');
`))

test('canonical invoice uniqueness prevents duplicate aggregation within both generation and legacy scopes', {skip:!enabled},()=>check(`
  do $$
  begin
    begin
      insert into public.canonical_invoices(sync_run_id,user_id,tenant_id,source_id,customer_source_id,type,
        transaction_currency_code,organisation_base_currency_code,currency_conversion_status)
        select run,'${user}','tenant-a','i1','c1','ACCREC','GBP','GBP','identity' from fixture;
      raise exception 'duplicate generation invoice was accepted';
    exception when unique_violation then null;
    end;
  end $$;
  insert into public.canonical_invoices(user_id,tenant_id,source_id,customer_source_id,type,
    transaction_currency_code,organisation_base_currency_code,currency_conversion_status)
    values('${user}','tenant-a','i1','c1','ACCREC','GBP','GBP','identity');
  do $$
  begin
    begin
      insert into public.canonical_invoices(user_id,tenant_id,source_id,customer_source_id,type,
        transaction_currency_code,organisation_base_currency_code,currency_conversion_status)
        values('${user}','tenant-a','i1','c1','ACCREC','GBP','GBP','identity');
      raise exception 'duplicate legacy invoice was accepted';
    exception when unique_violation then null;
    end;
  end $$;
  select pg_temp.ok((select count(*)=1 from public.canonical_invoices where sync_run_id=(select run from fixture)), 'one current invoice');
  select pg_temp.ok((select count(*)=1 from public.canonical_invoices where sync_run_id is null), 'one legacy invoice');
`))

test('PostgreSQL invoice and Dispute numerics survive exact text reads',{skip:!enabled},()=>check(`
  update public.canonical_invoices set amount_due_native=${sql(creditNote.remaining_credit_native)}::numeric,
    amount_due_base=${sql(creditNote.remaining_credit_native)}::numeric where source_id='i1';
  insert into public.invoice_disputes(user_id,tenant_id,source_system,invoice_source_id,dispute_mode,
    recorded_disputed_amount_native,amount_due_at_last_review_native)
    values('${user}','tenant-a','xero','i1','partial','0.000000000000000001'::numeric,${sql(creditNote.remaining_credit_native)}::numeric);
  select pg_temp.ok((select amount_due_native::text=${sql(creditNote.remaining_credit_native)} from public.canonical_invoices),'exact invoice due');
  select pg_temp.ok((select recorded_disputed_amount_native::text='0.000000000000000001'
    and amount_due_at_last_review_native::text=${sql(creditNote.remaining_credit_native)} from public.invoice_disputes),'exact Dispute operands');
`))
