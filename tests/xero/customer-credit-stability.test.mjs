import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTypeScriptModule } from './test-helpers/ts-module-loader.mjs'
import { createGenerationImportHarness, contact, invoice, pageResult } from './test-helpers/xero-generation-import-harness.mjs'

const { importXeroGeneration } = loadTypeScriptModule('lib/xero/generation-importer.ts')
const { signatureForAuthorisedInvoices, signatureForCreditRows } = loadTypeScriptModule('lib/xero/customer-credit-stability.ts')
const { validateCustomerCreditStability } = loadTypeScriptModule('lib/xero/customer-credit-validation.ts')
const note = (overrides = {}) => ({ CreditNoteID: 'cn1', Type: 'ACCRECCREDIT', Contact: { ContactID: 'c1' },
  Status: 'AUTHORISED', RemainingCredit: '300.000', CurrencyCode: 'GBP', CurrencyRate: '1',
  UpdatedDateUTC: '2026-09-15T10:00:00Z', ...overrides })
const cash = (resource, overrides = {}) => ({
  [resource === 'overpayments' ? 'OverpaymentID' : 'PrepaymentID']: `${resource}-1`,
  Type: resource === 'overpayments' ? 'RECEIVE-OVERPAYMENT' : 'RECEIVE-PREPAYMENT',
  Contact: { ContactID: 'c1' }, Status: 'AUTHORISED', RemainingCredit: '100.00',
  CurrencyCode: 'GBP', CurrencyRate: '1', Date: '2026-09-12',
  UpdatedDateUTC: '2026-09-15T10:00:00Z', ...overrides,
})
const baseOptions = () => ({ contacts: [contact('c1')],
  authorisedInvoices: [invoice('i1', 'c1', 'AUTHORISED', undefined, { AmountDue: '1000.00' })],
  paidInvoices: [], payments: [],
  overpayments: [cash('overpayments')], prepayments: [cash('prepayments')], creditnotes: [note()] })

async function run(overrides = {}, mutate = () => null) {
  const counts = new Map()
  const harness = createGenerationImportHarness({ ...baseOptions(), ...overrides,
    fetchCollection({ request, name, records }) {
      const count = (counts.get(name) ?? 0) + 1
      counts.set(name, count)
      const changed = mutate({ request, name, records, count })
      return changed ?? pageResult(records)
    },
  })
  const result = await importXeroGeneration(harness.params)
  assert.equal(result.status, 'ready_for_promotion')
  assert.equal(harness.creditValidations.length, 1)
  return { validation: harness.creditValidations[0].validation, events: harness.events, counts }
}

test('ordered complete I0/C0 → I1 → C1 observations certify once, including empty and zero credit', async () => {
  const stable = await run()
  assert.equal(stable.validation.readiness_state, 'ready')
  assert.equal(stable.validation.consistency_result, 'matched')
  assert.equal(stable.counts.get('invoices:authorised'), 2)
  for (const resource of ['overpayments', 'prepayments', 'creditnotes']) assert.equal(stable.counts.get(resource), 2)
  const events = stable.events
  assert.ok(events.indexOf('creditnotes:true') < events.lastIndexOf('fetch:invoices:authorised'))
  assert.ok(events.lastIndexOf('fetch:invoices:authorised') < events.lastIndexOf('fetch:creditnotes'))
  const empty = await run({ overpayments: [], prepayments: [], creditnotes: [] })
  assert.equal(empty.validation.readiness_state, 'ready')
  assert.equal(empty.validation.resource_observations.initial.creditnotes.count, 0)
  const consumed = await run({ overpayments: [cash('overpayments', { Status: 'PAID', RemainingCredit: '0' })],
    prepayments: [cash('prepayments', { Status: 'PAID', RemainingCredit: '0' })],
    creditnotes: [note({ Status: 'PAID', RemainingCredit: '0' })] })
  assert.equal(consumed.validation.readiness_state, 'ready')
})

for (const [field, value] of [
  ['AmountDue', '800'], ['Status', 'PAID'], ['Contact', { ContactID: 'other' }],
  ['CurrencyCode', 'USD'], ['DueDateString', '2026-09-30'],
]) {
  test(`invoice ${field} instability makes generation credit unavailable`, async () => {
    const { validation } = await run({}, ({ name, count, records }) =>
      name === 'invoices:authorised' && count === 2 ? pageResult(records.map(record => ({ ...record, [field]: value }))) : null)
    assert.equal(validation.readiness_state, 'unavailable')
    assert.equal(validation.reason_code, field === 'Status' ? 'invalid_invoice_state' : 'invoice_state_changed')
  })
}
for (const records of [[], [invoice('i1','c1','AUTHORISED'), invoice('i2','c1','AUTHORISED')]]) {
  test(`invoice membership change (${records.length}) withholds credit`, async () => {
    const { validation } = await run({}, ({ name, count }) => name === 'invoices:authorised' && count === 2 ? pageResult(records) : null)
    assert.equal(validation.reason_code, 'invoice_state_changed')
  })
}
for (const [resource, field, value] of [
  ['overpayments','RemainingCredit','80'], ['prepayments','RemainingCredit','120'],
  ['creditnotes','RemainingCredit','0'], ['creditnotes','Status','PAID'],
  ['creditnotes','Contact',{ContactID:'other'}], ['creditnotes','CurrencyCode','USD'],
]) {
  test(`${resource} ${field} instability withholds credit`, async () => {
    const { validation } = await run({}, ({ name, count, records }) =>
      name === resource && count === 2 ? pageResult(records.map(record => ({ ...record, [field]: value }))) : null)
    assert.equal(validation.readiness_state, 'unavailable')
    assert.equal(validation.reason_code, field === 'Contact' ? 'credit_verification_incomplete'
      : field === 'Status' ? 'invalid_credit_state' : 'credit_state_changed')
  })
}
for (const records of [[], [note(), note({ CreditNoteID: 'cn2' })]]) {
  test(`credit membership change (${records.length}) withholds credit`, async () => {
    const { validation } = await run({}, ({ name, count }) => name === 'creditnotes' && count === 2 ? pageResult(records) : null)
    assert.equal(validation.reason_code, 'credit_state_changed')
  })
}

test('incomplete verification and missing provider version cannot certify; ordinary sync succeeds', async () => {
  const partial = await run({}, ({ name, count }) => {
    if (name === 'creditnotes' && count === 2) throw new Error('page failure')
    return null
  })
  assert.equal(partial.validation.reason_code, 'credit_verification_incomplete')
  const missingVersion = await run({ creditnotes: [note({ UpdatedDateUTC: undefined })] })
  assert.equal(missingVersion.validation.reason_code, 'missing_version_evidence')
  assert.equal(missingVersion.counts.get('invoices:authorised'), 1)
  const incompleteInitial = await run({}, ({ name }) => {
    if (name === 'creditnotes') throw new Error('initial traversal failed')
    return null
  })
  assert.equal(incompleteInitial.validation.reason_code, 'credit_notes_incomplete')
  const unknown = await run({ creditnotes: [note({ Status: 'UNKNOWN' })] })
  assert.equal(unknown.validation.reason_code, 'invalid_credit_state')
  assert.equal(unknown.counts.get('invoices:authorised'), 1)
  const timedOut = await run({}, ({ name, count }) => {
    if (name === 'invoices:authorised' && count === 2) throw { kind: 'deadline' }
    return null
  })
  assert.equal(timedOut.validation.reason_code, 'validation_timeout')
  assert.equal(timedOut.counts.get('invoices:authorised'), 2)
  assert.equal(timedOut.counts.get('creditnotes'), 1)
})

test('signatures normalize decimal formatting but detect exact changes and duplicate identities', () => {
  const i = invoice('i1','c1','AUTHORISED', undefined, { AmountDue:'100.00', CurrencyRate:'1.000' })
  assert.equal(signatureForAuthorisedInvoices([i]).signature,
    signatureForAuthorisedInvoices([{ ...i, AmountDue:'100', CurrencyRate:'1' }]).signature)
  assert.notEqual(signatureForAuthorisedInvoices([i]).signature,
    signatureForAuthorisedInvoices([{ ...i, AmountDue:'100.000000000000000001' }]).signature)
  assert.throws(() => signatureForAuthorisedInvoices([i, i]))
  const r = { source_id:'n1', customer_source_id:'c1', provider_type:'ACCRECCREDIT', status:'AUTHORISED',
    residual_state:'qualifying', remaining_credit_native:'1.00', currency_code:'GBP', organisation_base_currency_code:'GBP',
    xero_currency_rate:'1', source_updated_at:'2026-09-15T10:00:00Z' }
  assert.equal(signatureForCreditRows('credit_note', [r]).signature,
    signatureForCreditRows('credit_note', [{ ...r, remaining_credit_native:'1.0' }]).signature)
  assert.throws(() => signatureForCreditRows('credit_note', [r, r]))
})

test('optional deadline yields one unavailable result without retrying toward convergence', async () => {
  const observation = { count:0, signature:'a'.repeat(64), started_at:'2026-09-15T10:00:00Z',
    completed_at:'2026-09-15T10:00:01Z', page_requests:1, populated_pages:0, complete:true }
  const initial = { invoices:observation, overpayments:observation, prepayments:observation, creditnotes:observation }
  let invoiceReads = 0
  let creditReads = 0
  const result = await validateCustomerCreditStability({ initial, now: () => Date.parse('2026-09-15T10:00:05Z'),
    deadlineAtMs:Date.parse('2026-09-15T10:00:04Z'),
    readInvoices:async () => { invoiceReads++; return observation },
    readCredit:async () => { creditReads++; return observation } })
  assert.equal(result.reason_code, 'validation_timeout')
  assert.equal(result.readiness_state, 'unavailable')
  assert.equal(invoiceReads, 0)
  assert.equal(creditReads, 0)
  const missingInitial = await validateCustomerCreditStability({ initial:{}, now:()=>Date.parse('2026-09-15T10:00:05Z'),
    deadlineAtMs:Date.parse('2026-09-15T10:00:10Z'),
    readInvoices:async()=>{ invoiceReads++; return observation }, readCredit:async()=>{ creditReads++; return observation } })
  assert.equal(missingInitial.reason_code, 'initial_invoice_incomplete')
  assert.equal(invoiceReads, 0)
})
