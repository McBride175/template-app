import assert from 'node:assert/strict'
import test from 'node:test'
import {scenarios,captureFeatureInput} from './test-helpers/calculation-parity-fixture.mjs'
import {partitionFeatureInput} from './test-helpers/customer-materialization-fixture.mjs'
import {loadTypeScriptModule} from './test-helpers/ts-module-loader.mjs'
const features=loadTypeScriptModule('lib/collections/customer-features.ts')
const basisLayer=loadTypeScriptModule('lib/collections/customer-materialization.ts')
const reference=loadTypeScriptModule('lib/collections/portfolio-benchmarks.ts')
const scoring=loadTypeScriptModule('lib/collections/prioritization.ts')
const money=loadTypeScriptModule('lib/money/currency.ts')
const materialized=loadTypeScriptModule('lib/collections/portfolio-materialization.ts')
for(const scenario of scenarios)test(`persisted portfolio/base/explanation parity: ${scenario.name}`,async()=>{
 const input=await captureFeatureInput(scenario);let f
 try{f=features.calculateCustomerFinancialFeatures(input)}catch(error){assert.throws(()=>features.calculateCustomerFinancialFeatures(input),{message:error.message});return}
 const mode=!(scenario.query??'overdueOnly=true').includes('overdueOnly=false')
 const persistedFeatures=basisLayer.mergeMaterializedCustomerFeatures(partitionFeatureInput(input).map(b=>({order:b.order,feature:basisLayer.calculateMaterializedCustomerFeature({basis:b.payload,...input,generationId:input.snapshot.syncRunId,certificate:input.customerCredit.certificate,disputes:input.disputes.filter(d=>b.payload.invoices.some(i=>i.source_id===d.invoice_source_id)),promises:new Map([...input.promises].filter(([,p])=>p.customer_source_id.trim()===b.customerId))})})))
 assert.deepEqual(persistedFeatures,f)
 const calc=materialized.calculateReusablePortfolio(persistedFeatures,mode)
 const stored=JSON.parse(JSON.stringify(calc))
 assert.deepEqual(stored,calc)
 if(f.currencyHealth.status==='unavailable'||!f.organisationBaseCurrency){assert.equal(calc.benchmarks,null);assert.deepEqual(calc.rows,[]);return}
 const b=reference.calculatePortfolioBenchmarks({rows:f.rows,overdueOnly:mode})
 const {invoiceScopeRows,scopeRows,ageingRows,filteredRows,analysedOverdueRows,...expectedBenchmarks}=b
 assert.deepEqual(calc.benchmarks,expectedBenchmarks)
 assert.equal(calc.population.invoiceScope,invoiceScopeRows.length);assert.equal(calc.population.ageing,ageingRows.length)
 assert.equal(calc.population.scoring,scopeRows.length);assert.equal(calc.population.scoring,filteredRows.length);assert.equal(calc.population.analysed,analysedOverdueRows.length)
 const bases=reference.calculatePortfolioBaseScores(b,f.organisationBaseCurrency)
 for(const {features:row,base} of bases){
  const restored=materialized.restorePortfolioBaseScore(stored.rows.find(r=>r.customerId===row.customer_source_id),stored.benchmarks)
  assert.deepEqual(restored,base)
  for(const override of ['safe','normal','priority','do_not_chase'])assert.deepEqual(scoring.adjustCustomerPriority(restored,override),scoring.adjustCustomerPriority(base,override))
 }
 assert.deepEqual(calc.rows.filter(r=>r.membership.scoring).map(r=>r.customerId),bases.map(r=>r.features.customer_source_id))
 assert.deepEqual(calc.rows.filter(r=>r.membership.ageing).map(r=>r.customerId),ageingRows.map(r=>r.customer_source_id))
 const ranking=rows=>rows.sort((a,b)=>b.score-a.score || (money.compareDecimalValues(b.amount,a.amount)??0) || a.name.localeCompare(b.name,undefined,{sensitivity:'base'})).map(r=>r.id)
 const expectedOrder=ranking(bases.map(({features:r,base})=>({id:r.customer_source_id,name:r.customer_name,amount:r.customer_to_chase_overdue_base_decimal,score:base.baseScore})))
 const actualOrder=ranking([...stored.rows].sort((a,b)=>a.order-b.order).filter(r=>r.score).map(r=>({id:r.customerId,name:r.score.input.customer_name,amount:r.projection.customer_to_chase_overdue_base_decimal,score:r.score.weighted})))
 assert.deepEqual(actualOrder,expectedOrder)
 assert.ok(!JSON.stringify(calc).includes('score_breakdown_lines'))
 assert.ok(!JSON.stringify(calc).includes('override_level'))
})
test('dependency comparisons distinguish numerical exposure from portfolio shares and isolate anchors',async()=>{
 const f=features.calculateCustomerFinancialFeatures(await captureFeatureInput(scenarios[0]))
 const initial=materialized.calculateReusablePortfolio(f,true).benchmarks
 const altered=structuredClone(initial);altered.totalOverdueOutstandingBase+=20
 assert.deepEqual(materialized.comparePortfolioBenchmarkDependencies(initial,altered),{exposure:false,exposureShares:true,urgency:false,deterioration:false})
 altered.maxOverdueOutstandingBase+=20;assert.equal(materialized.comparePortfolioBenchmarkDependencies(initial,altered).exposure,true)
 altered.overallWeightedAvgOverdueDays+=1;assert.equal(materialized.comparePortfolioBenchmarkDependencies(initial,altered).urgency,true)
 altered.relativeLatenessContext.highAnchorDays+=1;assert.equal(materialized.comparePortfolioBenchmarkDependencies(initial,altered).deterioration,true)
 assert.deepEqual(scoring.PRIORITIZATION_CONFIG.weights,{exposure:.5,urgency:.25,relativeDeterioration:.15,behaviour:.1})
})
test('real compact feature changes expose exact peer dependencies without payment cross-coupling',async()=>{
 const original=features.calculateCustomerFinancialFeatures(await captureFeatureInput(scenarios[0]))
 const before=materialized.calculateReusablePortfolio(original,true)
 const run=mutate=>{const changed=structuredClone(original);mutate(changed.rows);return materialized.calculateReusablePortfolio(changed,true)}
 const base=(c,id)=>c.rows.find(r=>r.customerId===id).score
 const exposure=run(rows=>{rows[0].customer_to_chase_overdue_base+=200;rows[0].customer_to_chase_overdue_base_decimal=String(rows[0].customer_to_chase_overdue_base)})
 assert.equal(materialized.comparePortfolioBenchmarkDependencies(before.benchmarks,exposure.benchmarks).exposure,true)
 assert.notEqual(base(before,'baker').components.exposureScore,base(exposure,'baker').components.exposureScore)
 assert.equal(base(before,'baker').components.paymentRecencyScore,base(exposure,'baker').components.paymentRecencyScore)
 const share=run(rows=>{const row=rows.find(r=>r.customer_source_id==='baker');row.customer_to_chase_overdue_base+=20;row.customer_to_chase_overdue_base_decimal=String(row.customer_to_chase_overdue_base)})
 assert.equal(materialized.comparePortfolioBenchmarkDependencies(before.benchmarks,share.benchmarks).exposure,false)
 assert.equal(base(before,'acme').components.exposureScore,base(share,'acme').components.exposureScore)
 assert.notEqual(base(before,'acme').explanation.exposureSharePercent,base(share,'acme').explanation.exposureSharePercent)
 const urgency=run(rows=>{rows[0].weighted_avg_overdue_days+=30})
 assert.equal(materialized.comparePortfolioBenchmarkDependencies(before.benchmarks,urgency.benchmarks).urgency,true)
 assert.notEqual(base(before,'baker').components.urgencyScore,base(urgency,'baker').components.urgencyScore)
 const payment=run(rows=>{rows[0].last_payment_days_ago=0;rows[0].last_payment_date='2026-10-01'})
 assert.deepEqual(before.benchmarks,payment.benchmarks)
 assert.equal(base(before,'baker').weighted,base(payment,'baker').weighted)
 assert.notEqual(base(before,'acme').components.paymentRecencyScore,base(payment,'acme').components.paymentRecencyScore)
 const population=structuredClone(original);population.rows=Array.from({length:7},(_,i)=>({...original.rows[0],customer_source_id:`member-${i}`,relative_lateness_days:10+i*8}))
 const first=materialized.calculateReusablePortfolio(population,true);population.rows[6].relative_lateness_days=120
 const next=materialized.calculateReusablePortfolio(population,true)
 assert.equal(materialized.comparePortfolioBenchmarkDependencies(first.benchmarks,next.benchmarks).deterioration,true)
 assert.notEqual(base(first,'member-4').components.relativeDeteriorationScore,base(next,'member-4').components.relativeDeteriorationScore)
 assert.equal(base(first,'member-4').components.exposureScore,base(next,'member-4').components.exposureScore)
})
