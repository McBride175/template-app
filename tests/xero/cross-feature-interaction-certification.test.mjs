import assert from 'node:assert/strict'
import test, { before, after, mock } from 'node:test'
import { interactionJourney, invoice, paidHistory, owner, moneyFields, scoreFields, close } from './test-helpers/interaction-journey-fixture.mjs'
import { TENANT_ID } from './test-helpers/disputes-journey-fixture.mjs'

before(() => mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-01T12:00:00Z') }))
after(() => mock.timers.reset())

// Fixed, independently calculated oracles. No scorer/formula implementation here.
// Each row is E / U / R / P / rounded base; final equals base unless overridden.
// Example A: age=(900*60+100*10)/1000=55; portfolio mean=77500/1900.
// Baker U=1500/(775/19)=1140/31; composite=30+285/31+10=49.2.
const golden = {
  A: { age: 55, mean: 775 / 19, total: 1900, max: 1000, scores: [[100,100,100,100,100], [60,1140/31,0,100,49.2], [30,570/31,0,100,29.6]] },
  B: { age: 53.75, mean: 655 / 17, total: 1700, max: 800, scores: [[100,100,100,100,100], [75,5100/131,0,100,57.2], [37.5,2550/131,0,100,33.6]] },
  C: { age: 50, mean: 475 / 14, total: 1400, max: 600, scores: [[250/3,100,100,100,91.7], [100,840/19,0,100,71.1], [50,420/19,0,100,40.5]] },
  D: { age: 50, mean: 475 / 14, total: 1250, max: 600, scores: [[175/3,100,100,100,79.2], [100,840/19,0,100,71.1], [50,420/19,0,100,40.5]] },
  E: { age: 50, mean: 475 / 14, total: 1250, max: 600, order: ['baker','acme','cedar'], scores: [[175/3,100,100,0,69.2], [100,840/19,0,100,71.1], [50,420/19,0,100,40.5]] },
  F: { age: 370/7, mean: 595/16, total: 1450, max: 600, scores: [[275/3,100,100,0,85.8], [100,4800/119,0,100,70.1], [50,2400/119,0,100,40]] },
  G: { age: 53.75, mean: 655/17, total: 1550, max: 650, scores: [[100,100,100,0,90], [1200/13,5100/131,0,100,65.9], [600/13,2550/131,0,100,37.9]] },
  H: { age: 53.75, mean: 655/17, total: 900, max: 600, order: ['baker','cedar'], scores: [null, [100,5100/131,0,100,69.7], [50,2550/131,0,100,39.9]] },
  lower: { age: 490/9, mean: 715/18, total: 1800, max: 900, scores: [[100,100,100,100,100], [200/3,5400/143,0,100,52.8], [100/3,2700/143,0,100,31.4]] },
  overlap: { age: 10, mean: 23.5, maxAge: 30, count: 1, material: 0, total: 1000, max: 600, order: ['baker','cedar','acme'], scores: [[50/3,1000/47,0,100,23.7], [100,100,0,100,85], [50,1500/47,0,100,43]] },
  creditPartial: { age: 55, mean: 775/19, total: 1100, max: 600, order: ['baker','acme','cedar'], scores: [[100/3,100,100,100,66.7], [100,1140/31,0,100,69.2], [50,570/31,0,100,39.6]] },
  creditZero: { age: 55, mean: 775/19, total: 900, max: 600, order: ['baker','cedar'], scores: [null, [100,1140/31,0,100,69.2], [50,570/31,0,100,39.6]] },
  promise: { age: 370/7, mean: 595/16, total: 1600, max: 700, scores: [[100,100,100,100,100], [600/7,4800/119,0,100,62.9], [300/7,2400/119,0,100,36.5]] },
  promisePaid: { age: 370/7, mean: 595/16, total: 1600, max: 700, scores: [[100,100,100,0,90], [600/7,4800/119,0,100,62.9], [300/7,2400/119,0,100,36.5]] },
  terminalPaid: { age: 53.75, mean: 655/17, total: 1700, max: 800, scores: [[100,100,100,0,90], [75,5100/131,0,100,57.2], [37.5,2550/131,0,100,33.6]] },
  oldCoveredCredit: { age: 10, mean: 23.5, maxAge: 30, count: 1, material: 0, total: 950, max: 600, order: ['baker','cedar','acme'], scores: [[25/3,1000/47,0,100,19.5], [100,100,0,100,85], [50,1500/47,0,100,43]] },
}
const ids = ['acme', 'baker', 'cedar']
const money = state => moneyFields.map(field => state.customer[field])
const invoiceTuple = row => [row.invoiceSourceId, row.currentAmountDueNative, row.effectiveDisputedAmountNative, row.activePromisedCoverageAmountNative, row.toChaseAmountNative]
function assertState(state, amounts, old, key, overrides = {}) {
  const expected = golden[key]
  assert.deepEqual(money(state), amounts.map(String), `${key}: accounting`)
  assert.deepEqual(invoiceTuple(state.invoices.find(row => row.invoiceSourceId === 'old')), ['old', ...old.map(String)])
  assert.deepEqual(invoiceTuple(state.invoices.find(row => row.invoiceSourceId === 'young')), ['young','100','0','0','100'])
  close(state.customer.weighted_avg_overdue_days, expected.age, `${key}: age`)
  close(state.customer.relative_lateness_days, expected.age - 10, `${key}: relative age`)
  assert.equal(state.customer.actionable_overdue_invoices_count, expected.count ?? 2)
  assert.equal(state.customer.historical_paid_invoice_count, 3)
  assert.equal(state.customer.historical_normal_days_late, 10)
  for (const item of state.observed) {
    const c = item.context
    assert.deepEqual([c.totalOverdueOutstandingBase, c.maxOverdueOutstandingBase], [expected.total, expected.max])
    close(c.overallWeightedAvgOverdueDays, expected.mean, `${key}: mean`)
    close(c.maxWeightedAvgOverdueDays, expected.maxAge ?? expected.age, `${key}: max age`)
    assert.equal(c.relativeLateness.materialObservationCount, expected.material ?? 1)
  }
  for (const [i, id] of ids.entries()) {
    const item = state.observed.find(item => item.row.customer_source_id === id)
    const expectedScores = expected.scores[i]
    if (!expectedScores) { assert.equal(item, undefined); continue }
    assert.ok(item, `${id} must be scored`)
    scoreFields.slice(0, 4).forEach((field, j) => close(item.result[field], expectedScores[j], `${key}: ${id} ${field}`))
    assert.equal(item.result.base_score, expectedScores[4], `${key}: ${id} base`)
    assert.equal(item.result.final_score, overrides.final?.[id] ?? expectedScores[4], `${key}: ${id} final`)
    const visible = state.queue.rows.find(row => row.customer_source_id === id)
    if (visible) {
      scoreFields.forEach(field => assert.equal(visible[field], item.result[field]))
      assert.equal(visible.queue_eligibility_reason, overrides.never === id ? 'do_not_chase' : 'eligible')
    }
  }
  assert.deepEqual(state.active, overrides.order ?? expected.order ?? ids, `${key}: active order`)
  assert.equal(state.queue.portfolio.totalOverdueBase, expected.total)
}
const create = (app, amount = '300', id = 'old', promisedDate = '2026-10-08') => app.promiseCommand({ operation: 'create', invoiceSourceId: id, amount, promisedDate })
const cancel = (app, row) => app.promiseCommand({ operation: 'cancel', promiseId: row.id, expectedRevision: row.revision })

test('golden dispute lifecycle refreshes every customer benchmark and score without stale suppression', async () => {
  const app = interactionJourney()
  assertState(await app.read(), [1000,0,0,1000,0,1000], [900,0,0,900], 'A')
  await app.dispute('partial', '200')
  assertState(await app.read(), [1000,200,0,800,0,800], [900,200,0,700], 'B')
  await app.dispute('partial', '500')
  assertState(await app.read(), [1000,500,0,500,0,500], [900,500,0,400], 'C')
  await app.dispute('partial', '100')
  assertState(await app.read(), [1000,100,0,900,0,900], [900,100,0,800], 'lower')
  await app.dispute('resolve')
  assertState(await app.read(), [1000,0,0,1000,0,1000], [900,0,0,900], 'A')
  await app.dispute('reactivate')
  assertState(await app.read(), [1000,100,0,900,0,900], [900,100,0,800], 'lower')
  await app.dispute('full')
  assertState(await app.read(), [1000,900,0,100,0,100], [900,900,0,0], 'overlap')
  assert.equal(app.tables.invoice_disputes.length, 1)
  assert.equal(app.tables.invoice_disputes[0].revision, 6)
})

test('golden Promise lifecycle consumes qualifying payments, terminal history and subsequent commitment', async () => {
  const app = interactionJourney()
  assertState(await app.read(), [1000,0,0,1000,0,1000], [900,0,0,900], 'A')
  const p = create(app)
  assertState(await app.read(), [1000,0,300,700,0,700], [900,0,300,600], 'promise')
  app.pay('old', '700', '200')
  assert.equal(p.qualifying_paid_amount_native, '200')
  assert.equal(p.status, 'active')
  assertState(await app.read(), [800,0,100,700,0,700], [700,0,100,600], 'promisePaid')
  cancel(app, p)
  assertState(await app.read(), [800,0,0,800,0,800], [700,0,0,700], 'terminalPaid')
  const next = create(app, '100')
  assert.notEqual(next.id, p.id)
  assert.equal(next.payment_baseline.payment_ids.length, 1)
  app.reconcile(next)
  assert.equal(next.qualifying_paid_amount_native, '0', 'existing payment belongs to creation baseline')
  assertState(await app.read(), [800,0,100,700,0,700], [700,0,100,600], 'promisePaid')
  assert.equal(app.tables.invoice_promises.length, 2)
  const before = await app.read()
  p.note = 'Retained terminal history'; app.tables.invoice_promise_events.push({ promise_id: p.id, event_type: 'historical' })
  assert.deepEqual((await app.read()).observed, before.observed)
})

test('golden customer credit crosses zero and returns without changing age or deterioration reference', async () => {
  const app = interactionJourney()
  assertState(await app.read(), [1000,0,0,1000,0,1000], [900,0,0,900], 'A')
  app.credit('800')
  assertState(await app.read(), [1000,0,0,1000,800,200], [900,0,0,900], 'creditPartial')
  app.credit('1000')
  const exact = await app.read()
  assertState(exact, [1000,0,0,1000,1000,0], [900,0,0,900], 'creditZero')
  app.credit('1000000')
  const excess = await app.read()
  assertState(excess, [1000,0,0,1000,1000000,0], [900,0,0,900], 'creditZero')
  assert.deepEqual(excess.observed, exact.observed)
  app.credit('800')
  assertState(await app.read(), [1000,0,0,1000,800,200], [900,0,0,900], 'creditPartial')
  app.credit()
  assertState(await app.read(), [1000,0,0,1000,0,1000], [900,0,0,900], 'A')
})

test('golden combined dispute + Promise + credit + payment A–H journey and repeated reads', async () => {
  const app = interactionJourney()
  const check = async (key, amounts, old) => {
    const state = await app.read(); assertState(state, amounts, old, key)
    const stored = structuredClone(app.tables)
    for (let n = 0; n < 3; n++) assert.deepEqual(await app.read(), state, `${key}: repeat ${n}`)
    assert.deepEqual(app.tables, stored, `${key}: reads must never consume coverage`)
  }
  await check('A', [1000,0,0,1000,0,1000], [900,0,0,900])
  await app.dispute('partial', '200')
  await check('B', [1000,200,0,800,0,800], [900,200,0,700])
  const p = create(app)
  await check('C', [1000,200,300,500,0,500], [900,200,300,400])
  app.credit('150')
  await check('D', [1000,200,300,500,150,350], [900,200,300,400])
  app.pay('old', '700', '200', '150')
  await check('E', [800,200,100,500,150,350], [700,200,100,400])
  await app.dispute('resolve')
  await check('F', [800,0,100,700,150,550], [700,0,100,600])
  cancel(app, p)
  await check('G', [800,0,0,800,150,650], [700,0,0,700])
  app.credit('800')
  await check('H', [800,0,0,800,800,0], [700,0,0,700])
})

test('overlapping dispute and Promise re-cap through resolution and cancellation; credit stays customer-level', async () => {
  const app = interactionJourney()
  await app.dispute('partial', '500')
  const p = create(app, '700') // commitment allowed up to gross due, coverage only post-dispute
  assertState(await app.read(), [1000,500,400,100,0,100], [900,500,400,0], 'overlap')
  await app.dispute('resolve')
  // Restored debt lets the same commitment cover 700, leaving 200 old + 100 young.
  const restored = await app.read()
  assert.deepEqual(money(restored), ['1000','0','700','300','0','300'])
  close(restored.customer.weighted_avg_overdue_days, 130/3)
  assert.deepEqual(invoiceTuple(restored.invoices.find(r => r.invoiceSourceId === 'old')), ['old','900','0','700','200'])
  assert.equal(restored.observed.find(r => r.row.customer_source_id === 'acme').result.base_score, 75)
  assert.deepEqual(restored.active, ['acme','baker','cedar']) // 75 > Baker 72.7
  await app.dispute('reactivate')
  cancel(app, p)
  assertState(await app.read(), [1000,500,0,500,0,500], [900,500,0,400], 'C')
  app.credit('150')
  assertState(await app.read(), [1000,500,0,500,150,350], [900,500,0,400], 'D')
  await app.dispute('full'); app.credit('50')
  assertState(await app.read(), [1000,900,0,100,50,50], [900,900,0,0], 'oldCoveredCredit')
  app.credit('100')
  assert.equal((await app.read()).active.includes('acme'), false)
  await app.dispute('resolve'); app.credit('800')
  assertState(await app.read(), [1000,0,0,1000,800,200], [900,0,0,900], 'creditPartial')
})

test('Promise plus credit: fully covered invoice, covered customer remainder and terminal restoration', async () => {
  const app = interactionJourney(), p = create(app, '900')
  app.credit('50')
  assertState(await app.read(), [1000,0,900,100,50,50], [900,0,900,0], 'oldCoveredCredit')
  app.credit('100')
  const covered = await app.read()
  assert.deepEqual(money(covered), ['1000','0','900','100','100','0'])
  assert.deepEqual(covered.active, ['baker','cedar'])
  assert.equal(covered.customer.weighted_avg_overdue_days, 10)
  cancel(app, p)
  const terminal = await app.read()
  assert.deepEqual(money(terminal), ['1000','0','0','1000','100','900'])
  assert.equal(terminal.customer.weighted_avg_overdue_days, 55)
  assert.equal(terminal.observed.find(r => r.row.customer_source_id === 'acme').result.base_score, 100)
  app.credit('800')
  assertState(await app.read(), [1000,0,0,1000,800,200], [900,0,0,900], 'creditPartial')
})

test('payment below recorded coverage re-caps each combination and does not get deducted twice', async t => {
  for (const [name, d, p, credit, disputed, promised, net] of [
    ['dispute', 600, 0, 0, 100, 0, 100],
    ['Promise', 0, 700, 0, 0, 100, 100],
    ['both', 600, 700, 0, 100, 0, 100],
    ['credit', 0, 0, 150, 0, 0, 50],
    ['all', 600, 700, 150, 100, 0, 0],
  ]) await t.test(name, async () => {
    const app = interactionJourney()
    if (d) await app.dispute('partial', String(d))
    const commitment = p ? create(app, String(p)) : null
    app.credit(String(credit))
    // Newly observed provider payment predates the commitment. It changes
    // authoritative AmountDue/recency but cannot satisfy this later Promise.
    app.pay('old', '100', '800', String(credit), '2026-09-30')
    if (commitment) { assert.equal(commitment.status, 'active'); assert.equal(commitment.qualifying_paid_amount_native, '0') }
    const state = await app.read()
    assert.deepEqual(money(state), [200,disputed,promised,200-disputed-promised,credit,net].map(String))
    assert.deepEqual(invoiceTuple(state.invoices.find(r => r.invoiceSourceId === 'old')),
      ['old','100',String(disputed),String(promised),String(100-disputed-promised)])
    assert.equal(state.customer.last_payment_days_ago, 1)
    assert.equal(state.customer.weighted_avg_overdue_days, name === 'credit' ? 35 : 10)
    assert.equal(state.customer.actionable_overdue_invoices_count, name === 'credit' ? 2 : 1)
    assert.equal(state.customer.customer_credit_applied_base_decimal, String(Math.min(credit, 200-disputed-promised)))
    const scored = state.observed.find(r => r.row.customer_source_id === 'acme')
    if (net) {
      assert.equal(scored.result.payment_recency_score, 10)
      assert.equal(scored.result.base_score, name === 'credit' ? 42.4 : 14.7)
      assert.deepEqual(state.active, name === 'credit' ? ['baker','acme','cedar'] : ['baker','cedar','acme'])
    } else { assert.equal(scored, undefined); assert.deepEqual(state.active, ['baker','cedar']) }
    const before = structuredClone(app.tables)
    assert.deepEqual(await app.read(), state)
    assert.deepEqual(app.tables, before)
  })
})

test('Promise date alone stays active; certified evidence resolves Missed and qualifying payment resolves Kept', async () => {
  const app = interactionJourney()
  const p = create(app, '300', 'old', '2026-10-01')
  mock.timers.setTime(new Date('2026-10-02T12:00:00Z').valueOf())
  const elapsed = await app.read()
  assert.equal(p.status, 'active')
  assert.deepEqual(money(elapsed), ['1000','0','300','700','0','700'])
  assert.equal(app.reconcile(p).decision, 'missed')
  assert.deepEqual(money(await app.read()), ['1000','0','0','1000','0','1000'])
  assert.throws(() => cancel(app, p), /conflict/)
  mock.timers.setTime(new Date('2026-10-01T12:00:00Z').valueOf())
  const paid = interactionJourney(), kept = create(paid)
  paid.pay('old', '600', '300')
  assert.equal(kept.status, 'kept')
  assert.equal(kept.qualifying_paid_amount_native, '300')
  assertState(await paid.read(), [700,0,0,700,0,700], [600,0,0,600], 'promisePaid')
})

test('multi-invoice golden weights selected invoices, three-invoice bonus and paid history correctly', async () => {
  const app = interactionJourney([invoice('old','acme','600',60), invoice('medium','acme','300',30),
    invoice('young','acme','100',10), invoice('b','baker','600',30), invoice('c','cedar','300',15), ...paidHistory('acme')])
  await app.dispute('partial','200')
  const p = create(app,'200','medium'); app.credit('150')
  const state = await app.read()
  assert.deepEqual(money(state), ['1000','200','200','600','150','450'])
  assert.deepEqual(state.invoices.filter(r => ['old','medium','young'].includes(r.invoiceSourceId)).map(invoiceTuple).sort(),
    [['medium','300','0','200','100'],['old','600','200','0','400'],['young','100','0','0','100']])
  close(state.customer.weighted_avg_overdue_days,140/3)
  assert.equal(state.customer.actionable_overdue_invoices_count,3)
  assert.equal(state.customer.historical_paid_invoice_count,3)
  assert.equal(state.customer.last_payment_date,null,'paid-invoice history does not manufacture canonical payment records')
  const a = state.observed.find(r => r.row.customer_source_id === 'acme')
  close(a.context.overallWeightedAvgOverdueDays,101/3)
  assert.deepEqual(scoreFields.map(f => a.result[f]),[75,100,100,100,87.5,87.5])
  assert.deepEqual(state.active,ids)
  app.promiseCommand({ operation:'edit',promiseId:p.id,expectedRevision:p.revision,amount:'300' })
  const full = await app.read()
  assert.deepEqual(money(full),['1000','200','300','500','150','350'])
  assert.equal(full.customer.actionable_overdue_invoices_count,2)
  assert.equal(full.customer.weighted_avg_overdue_days,50)
  const b = full.observed.find(r=>r.row.customer_source_id==='acme')
  assert.equal(b.result.base_score,79.2)
  assert.deepEqual(full.active,ids)
})

test('golden portfolio transition preserves credit-covered reference, changes five-to-four anchors, then restores and defers', async () => {
  const app=interactionJourney([25,30,35,40,45].flatMap((age,i)=>[invoice(`i${i}`,`c${i}`,'100',age),...paidHistory(`c${i}`,0)]))
  const initial=await app.read('c0')
  const context=initial.observed[0].context
  assert.deepEqual(context.relativeLateness,{mode:'portfolio-relative',materialObservationCount:5,
    midpointAnchorDays:35,highAnchorDays:48.5,materialP50Days:35,materialP90Days:43})
  assert.equal(context.overallWeightedAvgOverdueDays,35)
  assert.equal(initial.observed.find(r=>r.row.customer_source_id==='c0').result.base_score,74.1)
  app.credit('100','c4')
  const covered=await app.read('c0')
  assert.deepEqual(covered.observed[0].context.relativeLateness,context.relativeLateness)
  assert.equal(covered.observed[0].context.overallWeightedAvgOverdueDays,35)
  assert.equal(covered.observed[0].context.totalOverdueOutstandingBase,400)
  assert.deepEqual(covered.active,['c3','c2','c1','c0'])
  const p=create(app,'100','i4')
  const invoiceCovered=await app.read('c0')
  const changed=invoiceCovered.observed[0].context
  assert.equal(changed.relativeLateness.materialObservationCount,4)
  assert.equal(changed.relativeLateness.midpointAnchorDays,16.5)
  assert.equal(changed.relativeLateness.highAnchorDays,30)
  assert.equal(changed.overallWeightedAvgOverdueDays,32.5)
  assert.equal(changed.maxWeightedAvgOverdueDays,40)
  const c0=invoiceCovered.observed.find(r=>r.row.customer_source_id==='c0').result
  close(c0.urgency_score,500/13);close(c0.relative_lateness_score,2200/27)
  assert.equal(c0.base_score,81.8)
  assert.deepEqual(invoiceCovered.queue.rows.map(r=>[r.customer_source_id,r.base_score]),[['c3',100],['c2',91.7],['c1',86.5],['c0',81.8]])
  cancel(app,p)
  const restored=await app.read('c0')
  assert.deepEqual(restored.observed,covered.observed)
  await app.actionHistory.createActionHistory({action_id:'00000000-0000-4000-8000-000000000041',
    tenant_id:TENANT_ID,source_system:'xero',customer_source_id:'c3',outcome:'no_response',next_action_date:'2026-10-02'})
  const deferred=await app.read('c0')
  assert.deepEqual(deferred.observed,covered.observed)
  assert.deepEqual(deferred.active,['c2','c1','c0'])
})

test('actionable invoice count changes urgency below its cap while paid history stays historical', async () => {
  const app=interactionJourney([invoice('old','acme','600',60),invoice('medium','acme','300',30),invoice('young','acme','100',10),
    invoice('b','baker','600',100),invoice('c','cedar','300',15),...paidHistory('acme')])
  await app.dispute('partial','200');const p=create(app,'200','medium');app.credit('150')
  const before=await app.read()
  const a=before.observed.find(r=>r.row.customer_source_id==='acme')
  // Acme age 140/3; portfolio mean 185/3; U=(140/185)*50+10=1770/37.
  close(a.context.overallWeightedAvgOverdueDays,185/3)
  assert.equal(a.row.overdue_invoices_count,3)
  close(a.result.urgency_score,1770/37)
  assert.equal(a.result.base_score,74.5)
  app.promiseCommand({operation:'edit',promiseId:p.id,expectedRevision:p.revision,amount:'300'})
  const after=await app.read(),b=after.observed.find(r=>r.row.customer_source_id==='acme')
  // Two actionable invoices, age 50; mean=89500/1400; U=7000/179+5.
  assert.equal(b.row.overdue_invoices_count,2)
  close(b.context.overallWeightedAvgOverdueDays,895/14)
  close(b.result.urgency_score,7895/179)
  assert.equal(b.result.base_score,65.2)
  assert.deepEqual(after.active,['baker','acme','cedar'])
})

test('Safe, Priority and Do not chase continue recalculating through all suppression and payment changes', async t => {
  for (const [level, finals, order] of [
    ['safe',[40,36.7,31.7,27.7],['baker','cedar','acme']],
    ['priority',[160,146.7,126.7,110.7],ids],
    ['do_not_chase',[0,0,0,0],['baker','cedar']],
  ]) await t.test(level,async()=>{
    const app=interactionJourney(); app.override('acme',level)
    const check=async(key,amounts,old,index)=>assertState(await app.read(),amounts,old,key,
      {final:{acme:finals[index]},order:level==='safe'&&index===0?['baker','acme','cedar']:order,never:level==='do_not_chase'?'acme':null})
    await check('A',[1000,0,0,1000,0,1000],[900,0,0,900],0)
    await app.dispute('partial','200');create(app)
    await check('C',[1000,200,300,500,0,500],[900,200,300,400],1)
    app.credit('150')
    await check('D',[1000,200,300,500,150,350],[900,200,300,400],2)
    app.pay('old','700','200','150')
    await check('E',[800,200,100,500,150,350],[700,200,100,400],3)
  })
})

test('positive to zero and back via dispute, Promise, credit and payment; tiny money remains actionable', async t=>{
  for(const cause of ['dispute','Promise','credit','payment','tiny-credit']) await t.test(cause,async()=>{
    const amount=cause==='tiny-credit'?'0.000000000000000001':'100'
    const app=interactionJourney([invoice('old','acme',amount,30),invoice('b','baker','100',20)])
    const initial=await app.read()
    assert.equal(initial.customer.customer_to_chase_overdue_base_decimal,amount)
    assert.ok(initial.active.includes('acme'))
    let p
    if(cause==='dispute')await app.dispute('full')
    if(cause==='Promise')p=create(app,amount)
    if(cause.includes('credit'))app.credit(amount)
    if(cause==='payment')app.pay('old','0','100')
    const zero=await app.read()
    assert.equal(zero.customer.customer_to_chase_overdue_base_decimal,'0')
    assert.deepEqual(zero.active,['baker'])
    assert.equal(zero.observed.some(r=>r.row.customer_source_id==='acme'),false)
    assert.equal(zero.observed[0].context.maxWeightedAvgOverdueDays,cause.includes('credit')?30:20)
    if(cause==='dispute')await app.dispute('resolve')
    if(cause==='Promise')cancel(app,p)
    if(cause.includes('credit'))app.credit()
    if(cause==='payment') {
      // Provider-authoritative reversal/reopening, not local payment subtraction.
      app.promote({old:{status:'AUTHORISED',amount_due_native:'100',amount_due_base:'100',amount_paid_native:'0',fully_paid_date:null}})
      app.credit()
    }
    const restored=await app.read()
    assert.equal(restored.customer.customer_to_chase_overdue_base_decimal,amount)
    assert.ok(restored.active.includes('acme'))
    if(cause!=='payment')assert.deepEqual(restored.observed,initial.observed)
    for(const item of restored.observed)for(const field of scoreFields)assert.ok(Number.isFinite(item.result[field])&&item.result[field]>=0)
    assert.deepEqual(await app.read(),restored)
  })
})

test('combined states ignore colliding foreign owner, tenant, provider and retained generation records', async () => {
  const app=interactionJourney()
  await app.dispute('partial','200');const p=create(app);app.credit('150')
  app.pay('old','700','200','150')
  const before=await app.read()
  const tables=['canonical_organisations','canonical_customers','canonical_invoices','canonical_payments',
    'invoice_disputes','invoice_promises','canonical_customer_credit_evidence_exact']
  for(const scope of [{user_id:'foreign-owner'},{tenant_id:'foreign-tenant'},{source_system:'foreign-provider'}]) {
    for(const table of tables) {
      const source=app.tables[table].find(r=>r.user_id===owner.user_id&&r.tenant_id===owner.tenant_id&&r.source_system==='xero'&&(!r.sync_run_id||r.sync_run_id===app.generation()))
      app.tables[table].push({...structuredClone(source),...scope})
    }
    app.tables.collection_actions.push({...owner,...scope,id:'collision',customer_source_id:'acme',action_type:'outcome',
      outcome:'message_sent',action_timestamp:'2026-10-01T12:00:00Z',next_action_date:'2026-10-08'})
    app.tables.invoice_promise_events.push({...owner,...scope,promise_id:p.id,event_type:'missed'})
  }
  assert.deepEqual(await app.read(),before)
  // Mutating the owned dispute cannot alter any foreign colliding record.
  const foreign=structuredClone(app.tables.invoice_disputes.slice(1))
  await app.dispute('resolve')
  assert.deepEqual(app.tables.invoice_disputes.slice(1),foreign)
  assertState(await app.read(),[800,0,100,700,150,550],[700,0,100,600],'F')
  // Another customer's genuine combined state may affect benchmarks, but never
  // Acme's economics. Use its own invoice to make identity scoping explicit.
  const acme=money(await app.read())
  await app.dispute('partial','100','b');create(app,'200','b')
  const changed=await app.read()
  assert.deepEqual(money(changed),acme)
  const baker=changed.customers.find(r=>r.customer_source_id==='baker')
  assert.equal(baker.customer_to_chase_overdue_base_decimal,'300')
})

test('golden Action History workflow changes eligibility only; expiry restores the same current-day score', async () => {
  // Cross midnight by two minutes and compare at the same evaluation time.
  mock.timers.setTime(new Date('2026-10-01T23:59:00Z').valueOf())
  const app = interactionJourney()
  await app.dispute('partial', '200'); create(app); app.credit('150')
  const before = await app.read()
  assertState(before, [1000,200,300,500,150,350], [900,200,300,400], 'D')
  mock.timers.setTime(new Date('2026-09-30T12:00:00Z').valueOf())
  await app.actionHistory.createActionHistory({ action_id: '00000000-0000-4000-8000-000000000032',
    tenant_id: TENANT_ID, source_system: 'xero', customer_source_id: 'acme',
    outcome: 'reviewed_no_chase', next_action_date: '2026-10-01' })
  mock.timers.setTime(new Date('2026-10-01T23:59:00Z').valueOf())
  assert.deepEqual((await app.read()).observed, before.observed)
  assert.deepEqual((await app.read()).active, before.active)
  const input = { action_id: '00000000-0000-4000-8000-000000000031', tenant_id: TENANT_ID, source_system: 'xero',
    customer_source_id: 'acme', outcome: 'message_sent', note: 'Synthetic follow-up', next_action_date: '2026-10-02' }
  const saved = await app.actionHistory.createActionHistory(input)
  assert.equal(saved.replayed, false)
  assert.equal(saved.action.nextActionDate, '2026-10-02')
  assert.equal((await app.actionHistory.createActionHistory(input)).replayed, true)
  assert.equal(app.tables.collection_actions.length, 2)
  assert.equal((await app.actionHistory.readLatestActionHistory(input)).id, input.action_id)
  const deferred = await app.read()
  assertState(deferred, [1000,200,300,500,150,350], [900,200,300,400], 'D', { order: ['baker','cedar'] })
  assert.deepEqual(deferred.observed, before.observed)
  assert.deepEqual(deferred.customer, before.customer)
  assert.deepEqual(deferred.queue.portfolio, before.queue.portfolio)
  mock.timers.setTime(new Date('2026-10-02T00:01:00Z').valueOf())
  const returned = await app.read()
  // Invoice overdue age is date-based and advances at UTC midnight. Capture the
  // natural new-day result, then compare against the same time without the event.
  const savedRows = app.tables.collection_actions.splice(0)
  const noEvent = await app.read()
  assert.deepEqual(returned.observed, noEvent.observed)
  assert.deepEqual(returned.active, noEvent.active)
  assert.deepEqual(money(returned), money(before))
  app.tables.collection_actions.push(...savedRows)
  assert.deepEqual((await app.read()).observed, noEvent.observed)
  assert.deepEqual((await app.read()).active, noEvent.active)
  mock.timers.setTime(new Date('2026-10-01T12:00:00Z').valueOf())
})
