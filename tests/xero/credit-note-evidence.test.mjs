import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTypeScriptModule } from './test-helpers/ts-module-loader.mjs'
import { createGenerationImportHarness, contact, invoice } from './test-helpers/xero-generation-import-harness.mjs'

const client = loadTypeScriptModule('lib/xero/accounting-api-client.ts')
const evidence = loadTypeScriptModule('lib/xero/credit-note-evidence.ts')
const mapper = loadTypeScriptModule('lib/xero/canonical-mapper.ts')
const importer = loadTypeScriptModule('lib/xero/generation-importer.ts')
const contacts = [contact('c1')]
const organisation = { BaseCurrency: 'GBP' }
const note = (overrides = {}) => ({ CreditNoteID: 'cn1', Type: 'ACCRECCREDIT', Contact: { ContactID: 'c1' },
  Status: 'AUTHORISED', RemainingCredit: '12345678901234567890.123456789012345678901', CurrencyCode: 'GBP',
  CurrencyRate: '1', UpdatedDateUTC: '2026-09-29T10:00:00Z', ...overrides })
const requestDeps = fetch => ({ fetch, async sleep() {}, random: () => 0.5,
  scheduleTimeout: () => 0, cancelTimeout() {}, now: () => Date.parse('2026-09-29T12:00:00Z') })

async function fetchPages(config, pages) {
  let index = 0
  const calls = []
  const result = await client.fetchXeroPaginatedCollection({ accessToken: 'synthetic', tenantId: 'tenant-a', config,
    requestMaxAttempts: 1, dependencies: requestDeps(async input => {
      calls.push(new URL(String(input)))
      const value = pages[index++]
      if (value instanceof Error) throw value
      return new Response(typeof value === 'string' ? value : JSON.stringify({ [config.responseKey]: value }))
    }) })
  return { result, calls }
}

test('credit-note endpoint traverses all pages, preserves exact residuals, and does not status-filter', async () => {
  const config = client.createXeroCreditNotesCollectionConfig()
  const payload = '{"CreditNotes":[{"CreditNoteID":"cn1","Type":"ACCRECCREDIT","Contact":{"ContactID":"c1"},"Status":"AUTHORISED","RemainingCredit":12345678901234567890.123456789012345678901,"CurrencyCode":"GBP","CurrencyRate":1.000000000000000001,"UpdatedDateUTC":"2026-09-29T10:00:00Z"}]}'
  const { result, calls } = await fetchPages(config, [payload, [note({ CreditNoteID: 'cn2', Status: 'PAID', RemainingCredit: '0' })], []])
  assert.equal(config.path, '/CreditNotes')
  assert.equal(config.query.Statuses, undefined)
  assert.equal(config.query.where, 'Type=="ACCRECCREDIT"')
  assert.equal(result.recordCount, 2)
  assert.equal(result.pageRequestCount, 3)
  assert.deepEqual(calls.map(call => call.searchParams.get('page')), ['1', '2', '3'])
  const rows = evidence.mapXeroCreditNoteEvidence(result.records, contacts, organisation)
  assert.equal(rows[0].remaining_credit_native, '12345678901234567890.123456789012345678901')
  assert.equal(rows[0].xero_currency_rate, '1.000000000000000001')
  assert.deepEqual(rows.map(row => row.residual_state), ['qualifying', 'zero'])
})

test('completed empty traversal differs from failed or duplicate pages', async () => {
  const config = client.createXeroCreditNotesCollectionConfig()
  const { result } = await fetchPages(config, [[]])
  assert.equal(result.recordCount, 0)
  assert.equal(result.pageRequestCount, 1)
  await assert.rejects(fetchPages(config, [[note()], new Error('unavailable')]))
  await assert.rejects(fetchPages(config, [[note()], [note()], []]))
})

test('credit-note lifecycle retains unknown and contradictory states as invalid evidence', () => {
  for (const [status, remaining, expected] of [
    ['AUTHORISED', '0', 'zero'], ['PAID', '0', 'zero'], ['PAID', '1', 'invalid'],
    ['DRAFT', null, 'excluded'], ['SUBMITTED', null, 'excluded'],
    ['VOIDED', '1', 'excluded'], ['DELETED', '0', 'excluded'], ['UNKNOWN', '1', 'invalid'],
    ['AUTHORISED', null, 'invalid'],
  ]) {
    assert.equal(evidence.mapXeroCreditNoteEvidence([note({ Status: status, RemainingCredit: remaining })], contacts, organisation)[0].residual_state, expected)
  }
  assert.deepEqual(evidence.mapXeroCreditNoteEvidence([note({ Type: 'ACCPAYCREDIT' })], contacts, organisation), [])
  const invalidRate = evidence.mapXeroCreditNoteEvidence([note({ CurrencyRate: '0' })], contacts, organisation)[0]
  assert.equal(invalidRate.residual_state, 'invalid')
  assert.equal(invalidRate.xero_currency_rate, null)
  for (const change of [
    { Contact: { ContactID: 'wrong' } }, { Contact: {} }, { RemainingCredit: 'bogus' },
    { RemainingCredit: 0.1 }, { Type: 'UNKNOWN' }, { UpdatedDateUTC: 'bad' }, { Status: 'X'.repeat(33) },
  ]) assert.throws(() => evidence.mapXeroCreditNoteEvidence([note(change)], contacts, organisation))
  assert.throws(() => evidence.mapXeroCreditNoteEvidence([note(), note()], contacts, organisation))
})

test('invoice HTTP tokens reach canonical native/base fields without binary-number rounding', async () => {
  const payload = '{"Invoices":[{"InvoiceID":"i1","Contact":{"ContactID":"c1"},"Type":"ACCREC","Status":"AUTHORISED","CurrencyCode":"GBP","CurrencyRate":1.000000000000000001,"Total":12345678901234567890.123456789012345678901,"AmountDue":12345678901234567890.123456789012345678901,"AmountPaid":0.000000000000000001,"AmountCredited":0.000000000000000002,"DateString":"2026-09-01","DueDateString":"2026-09-15"}]}'
  const { result } = await fetchPages(client.createXeroInvoicesCollectionConfig(), [payload, []])
  assert.equal(result.records[0].AmountDue, '12345678901234567890.123456789012345678901')
  assert.equal(result.records[0].CurrencyRate, '1.000000000000000001')
  const raw = (source_id, raw_json) => ({ source_id, raw_json, fetched_at: '2026-09-29T12:00:00Z' })
  const rows = mapper.buildXeroCanonicalRows({ userId: 'u', tenantId: 't',
    organisationRows: [raw('t', { OrganisationID: 't', BaseCurrency: 'GBP' })], organisationActionRows: [],
    contactRows: [raw('c1', { ContactID: 'c1' })], invoiceRows: [raw('i1', result.records[0])], paymentSource: 'resource' })
  assert.equal(rows.invoices[0].amount_due_native, '12345678901234567890.123456789012345678901')
  assert.equal(rows.invoices[0].amount_due_base, '12345678901234567890.123456789012345678901')
  assert.equal(rows.invoices[0].amount_paid_native, '0.000000000000000001')
  assert.equal(rows.invoices[0].amount_credited_native, '0.000000000000000002')
})

test('import persists credit notes separately while Promise retains three unchanged evidence streams', async () => {
  const promiseRows = []
  const creditRows = []
  const harness = createGenerationImportHarness({ contacts: [contact('c1')],
    authorisedInvoices: [invoice('i1', 'c1', 'AUTHORISED')], paidInvoices: [], payments: [],
    creditnotes: [note()], persistEvidence: value => promiseRows.push(value),
    persistCreditNoteEvidence: value => creditRows.push(value) })
  const result = await importer.importXeroGeneration(harness.params)
  assert.equal(result.status, 'ready_for_promotion')
  assert.deepEqual(promiseRows.map(value => value.observation.resource), ['payments', 'overpayments', 'prepayments'])
  assert.equal(creditRows.length, 1)
  assert.equal(creditRows[0].observation.complete, true)
  assert.equal(creditRows[0].observation.source_count, 1)
  assert.equal(creditRows[0].rows[0].remaining_credit_native, note().RemainingCredit)
  assert.equal(creditRows[0].userId, 'user-a')
  assert.equal(creditRows[0].tenantId, 'tenant-a')
})

test('malformed credit notes are unavailable without changing ordinary generation readiness', async () => {
  const creditRows = []
  const harness = createGenerationImportHarness({ creditnotes: [note({ Contact: { ContactID: 'missing' } })],
    persistCreditNoteEvidence: value => creditRows.push(value) })
  assert.equal((await importer.importXeroGeneration(harness.params)).status, 'ready_for_promotion')
  assert.equal(creditRows[0].observation.complete, false)
  assert.deepEqual(creditRows[0].rows, [])
})

test('credit-note transport failure and exhausted optional budget do not fail ordinary collections readiness', async () => {
  const failed = []
  const transport = createGenerationImportHarness({ persistCreditNoteEvidence: value => failed.push(value),
    fetchCollection: ({ request, records, pageResult }) => {
      if (request.config.resource === 'creditnotes') throw new Error('provider unavailable')
      return pageResult(records)
    } })
  assert.equal((await importer.importXeroGeneration(transport.params)).status, 'ready_for_promotion')
  assert.equal(failed[0].observation.complete, false)
  let clock = Date.parse('2026-09-29T10:00:00Z')
  const skipped = []
  const budget = createGenerationImportHarness({ now: () => clock,
    persistCreditNoteEvidence: value => skipped.push(value),
    fetchCollection: ({ request, records, pageResult }) => {
      if (request.config.resource === 'prepayments' && request.ifModifiedSince) clock += 225_000
      if (request.config.resource === 'creditnotes') throw new Error('credit-note fetch exceeded reserved budget')
      return pageResult(records)
    } })
  assert.equal((await importer.importXeroGeneration(budget.params)).status, 'ready_for_promotion')
  assert.equal(skipped[0].observation.complete, false)
})

test('credit-note persistence chunks exact data and cannot swallow a failed fenced write', async () => {
  const calls = []
  const params = { syncRunId: 'run', userId: 'u', tenantId: 't', leaseOwner: 'owner', fencingToken: 2,
    observation: { resource: 'creditnotes', started_at: '2026-09-29T10:00:00Z', completed_at: '2026-09-29T10:01:00Z',
      page_requests: 2, populated_pages: 1, source_count: 501, complete: true },
    rows: Array.from({ length: 501 }, (_, index) => ({ ...note({ CreditNoteID: `cn${index}` }), remaining_credit_native: note().RemainingCredit })),
    supabaseAdmin: { async rpc(name, args) { calls.push({ name, args }); return { error: null } } } }
  await evidence.persistXeroCreditNoteEvidence(params)
  assert.deepEqual(calls.map(call => [call.args.p_rows.length, call.args.p_observation.complete]), [[500, false], [1, true]])
  assert.equal(calls[0].name, 'persist_xero_credit_note_evidence')
  await assert.rejects(evidence.persistXeroCreditNoteEvidence({ ...params, rows: [],
    supabaseAdmin: { async rpc() { return { error: { code: 'failed' } } } } }))
})
