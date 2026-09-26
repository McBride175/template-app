import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTypeScriptModule } from './test-helpers/ts-module-loader.mjs'

const invoices = [
  { user_id: 'user-a', tenant_id: 'tenant-a', sync_run_id: 'run-1',
    source_system: 'xero', source_id: 'invoice-a', customer_source_id: 'customer-a',
    type: 'ACCREC', status: 'AUTHORISED', amount_due_native: '10000',
    amount_due_base: '10000', transaction_currency_code: 'GBP',
    organisation_base_currency_code: 'GBP', xero_currency_rate: null },
  { user_id: 'user-a', tenant_id: 'tenant-a', sync_run_id: 'run-2',
    source_system: 'xero', source_id: 'invoice-a', customer_source_id: 'customer-a',
    type: 'ACCREC', status: 'AUTHORISED', amount_due_native: '8000',
    amount_due_base: '8000', transaction_currency_code: 'GBP',
    organisation_base_currency_code: 'GBP', xero_currency_rate: null },
  { user_id: 'user-b', tenant_id: 'tenant-b', sync_run_id: 'run-2',
    source_system: 'xero', source_id: 'invoice-a', customer_source_id: 'customer-b',
    type: 'ACCREC', status: 'AUTHORISED', amount_due_native: '9000',
    amount_due_base: '9000', transaction_currency_code: 'GBP',
    organisation_base_currency_code: 'GBP', xero_currency_rate: null },
]
const disputes = []
let currentUser = 'user-a'
let currentRun = 'run-1'

function query(table) {
  const state = { filters: [], action: 'select', payload: null, range: null }
  const builder = {
    select() { return this },
    eq(column, value) { state.filters.push([column, value]); return this },
    order() { return this },
    range(from, to) { state.range = [from, to]; return this },
    update(payload) { state.action = 'update'; state.payload = payload; return this },
    insert(payload) { state.action = 'insert'; state.payload = payload; return this },
    upsert(payload) { state.action = 'upsert'; state.payload = payload; return this },
    async maybeSingle() {
      try { return { data: execute()[0] ?? null, error: null } }
      catch (error) { return { data: null, error } }
    },
    async single() {
      try {
        const result = execute()
        return { data: result[0] ?? null, error: result.length === 1 ? null : new Error('missing') }
      } catch (error) { return { data: null, error } }
    },
    then(resolve, reject) { return Promise.resolve({ data: execute(), error: null }).then(resolve, reject) },
  }
  function execute() {
    const rows = table === 'canonical_invoices' ? invoices : disputes
    if (state.action === 'insert') {
      const payload = state.payload
      const identity = ['user_id', 'tenant_id', 'source_system', 'invoice_source_id']
      if (disputes.some((row) => identity.every((key) => row[key] === payload[key]))) {
        throw Object.assign(new Error('duplicate'), { code: '23505' })
      }
      const created = { id: `dispute-${disputes.length + 1}`, revision: 1,
        created_at: '2026-09-24T00:00:00Z', updated_at: '2026-09-24T00:00:00Z', ...payload }
      disputes.push(created)
      return [created]
    }
    if (state.action === 'upsert') {
      const identity = ['user_id', 'tenant_id', 'source_system', 'invoice_source_id']
      return (Array.isArray(state.payload) ? state.payload : [state.payload]).map((payload) => {
        const existing = disputes.find((row) => identity.every((key) => row[key] === payload[key]))
        if (existing) Object.assign(existing, payload)
        else disputes.push({
          id: `dispute-${disputes.length + 1}`, created_at: '2026-09-24T00:00:00Z',
          updated_at: '2026-09-24T00:00:00Z', ...payload,
        })
        return existing ?? disputes.at(-1)
      })
    }
    let matched = rows.filter((row) => state.filters.every(([key, value]) =>
      key === 'revision' ? String(row[key]) === String(value) : row[key] === value))
    if (state.action === 'update') {
      for (const row of matched) { Object.assign(row, state.payload); row.revision += 1 }
    }
    if (state.range) matched = matched.slice(state.range[0], state.range[1] + 1)
    return matched
  }
  return builder
}

const admin = { from: query, async rpc(name, args) {
  assert.equal(name, 'apply_invoice_disputes_bulk_full')
  const { p_user_id, p_tenant_id, p_source_system, p_rows } = args
  for (const entry of p_rows) {
    const existing = disputes.find((row) => row.user_id === p_user_id &&
      row.tenant_id === p_tenant_id && row.source_system === p_source_system &&
      row.invoice_source_id === entry.invoice_source_id)
    if (existing ? (!existing.is_active || String(existing.revision) !== entry.expected_revision) :
      entry.expected_revision !== null) {
      return { data: null, error: { message: 'invoice_disputes_revision_conflict' } }
    }
  }
  const result = p_rows.map((entry) => {
    const existing = disputes.find((row) => row.user_id === p_user_id &&
      row.tenant_id === p_tenant_id && row.source_system === p_source_system &&
      row.invoice_source_id === entry.invoice_source_id)
    if (existing) {
      Object.assign(existing, { dispute_mode: 'full',
        recorded_disputed_amount_native: entry.amount_due_native,
        amount_due_at_last_review_native: entry.amount_due_native })
      existing.revision += 1
      return existing
    }
    const created = { id: `dispute-${disputes.length + 1}`, revision: 1,
      user_id: p_user_id, tenant_id: p_tenant_id, source_system: p_source_system,
      invoice_source_id: entry.invoice_source_id, dispute_mode: 'full',
      recorded_disputed_amount_native: entry.amount_due_native,
      amount_due_at_last_review_native: entry.amount_due_native, note: null,
      is_active: true, resolved_at: null,
      created_at: '2026-09-24T00:00:00Z', updated_at: '2026-09-24T00:00:00Z' }
    disputes.push(created)
    return created
  })
  return { data: result, error: null }
} }
const server = loadTypeScriptModule('lib/collections/invoice-disputes-server.ts', {
  mocks: {
    '@/lib/supabase-server': {
      createServerSupabaseClient: async () => ({
        auth: { getUser: async () => ({ data: { user: currentUser ? { id: currentUser } : null }, error: null }) },
      }),
    },
    '@/lib/supabase-admin': { createSupabaseAdminClient: () => admin },
    '@/lib/billing/entitlements': {
      claimActionsEntitlementStatus: async ({ userId, preferredTenantId }) => ({
        tenantId: userId === 'user-a' && preferredTenantId === 'tenant-a'
          ? 'tenant-a' : userId === 'user-b' && preferredTenantId === 'tenant-b'
            ? 'tenant-b' : 'another-owned-tenant',
        hasActionsAccess: true,
      }),
    },
    '@/lib/billing/collections-access': {
      resolveCollectionsCurrencyAccess: () => ({ allowed: true }),
    },
    '@/lib/collections/currency-context-server': {
      loadCollectionsCurrencyContext: async () => ({ mode: 'single_currency' }),
    },
    '@/lib/xero/authoritative-snapshot': {
      resolveXeroAuthoritativeSnapshot: async ({ userId, tenantId }) => ({
        userId, tenantId, mode: 'generation', syncRunId: currentRun,
      }),
      assertXeroSnapshotIdentity: (snapshot, identity) => {
        if (snapshot.userId !== identity.userId || snapshot.tenantId !== identity.tenantId) {
          throw new Error('snapshot identity mismatch')
        }
      },
      applyXeroAuthoritativeSnapshot: (builder, snapshot) => builder.eq('sync_run_id', snapshot.syncRunId),
    },
  },
})
const { deriveInvoiceDispute } = loadTypeScriptModule('lib/collections/invoice-disputes.ts')

test('one provider-keyed dispute survives generation promotion and deliberate review/reactivation', async () => {
  const created = await server.setFullInvoiceDispute({ tenantId: 'tenant-a', invoiceSourceId: 'invoice-a', note: 'Check goods' })
  assert.equal(created.recorded_disputed_amount_native, '10000')
  assert.equal(disputes.length, 1)

  currentRun = 'run-2'
  const currentInvoice = await server.loadAuthoritativeDisputeInvoice({
    admin, userId: 'user-a', tenantId: 'tenant-a',
    snapshot: { userId: 'user-a', tenantId: 'tenant-a', mode: 'generation', syncRunId: currentRun },
    invoiceSourceId: 'invoice-a',
  })
  assert.equal(deriveInvoiceDispute(currentInvoice, created).needsReview, true)
  const confirmed = await server.confirmInvoiceDisputeReview({ tenantId: 'tenant-a', disputeId: created.id,
    expectedRevision: String(disputes[0].revision) })
  assert.equal(confirmed.recorded_disputed_amount_native, '10000')
  assert.equal(confirmed.note, 'Check goods')
  assert.equal(confirmed.amount_due_at_last_review_native, '8000')
  assert.equal(deriveInvoiceDispute(currentInvoice, confirmed).needsReview, false)

  const resolved = await server.resolveInvoiceDispute({ tenantId: 'tenant-a', disputeId: created.id,
    expectedRevision: String(disputes[0].revision) })
  assert.equal(resolved.is_active, false)
  assert.ok(resolved.resolved_at)
  const reactivated = await server.reactivateInvoiceDispute({ tenantId: 'tenant-a', disputeId: created.id,
    expectedRevision: String(disputes[0].revision) })
  assert.equal(reactivated.id, created.id)
  assert.equal(reactivated.is_active, true)
  assert.equal(reactivated.resolved_at, null)
  assert.equal(reactivated.amount_due_at_last_review_native, '8000')
  assert.equal(disputes.length, 1)
  assert.equal(deriveInvoiceDispute(currentInvoice, reactivated).effectiveDisputedAmountNative, '8000')
  assert.equal(deriveInvoiceDispute({ ...currentInvoice, source_id: 'future-invoice' }, null).collectibleAmountNative, '8000')
})

test('new partial amount and current authoritative invoice are validated on the server', async () => {
  await assert.rejects(
    server.setPartialInvoiceDispute({ tenantId: 'tenant-a', invoiceSourceId: 'invoice-a', disputedAmountNative: '9000' }),
    /invalid_amount/
  )
  await assert.rejects(
    server.setFullInvoiceDispute({ tenantId: 'tenant-a', invoiceSourceId: 'missing-invoice' }),
    /not_found/
  )
  const created = await server.setPartialInvoiceDispute({ tenantId: 'tenant-a', invoiceSourceId: 'invoice-a',
    disputedAmountNative: '3000', expectedRevision: String(disputes[0].revision) })
  assert.equal(created.recorded_disputed_amount_native, '3000')
  assert.equal(deriveInvoiceDispute(invoices[1], created).collectibleAmountNative, '5000')
})

test('submission uses the newly promoted balance after a form saw an older generation', async () => {
  currentRun = 'run-1'
  const displayed = await server.loadCustomerInvoiceDisputes({
    tenantId: 'tenant-a', customerSourceId: 'customer-a',
  })
  assert.equal(displayed[0].currentAmountDueNative, '10000')
  currentRun = 'run-2'
  await assert.rejects(
    server.setPartialInvoiceDispute({
      tenantId: 'tenant-a', invoiceSourceId: 'invoice-a', disputedAmountNative: '9000',
      expectedRevision: String(disputes[0].revision),
    }), /invalid_amount/
  )
  const full = await server.setFullInvoiceDispute({
    tenantId: 'tenant-a', invoiceSourceId: 'invoice-a', expectedRevision: String(disputes[0].revision),
  })
  assert.equal(full.recorded_disputed_amount_native, '8000')
  assert.equal(deriveInvoiceDispute(invoices[1], full).collectibleAmountNative, '0')
  await server.setPartialInvoiceDispute({
    tenantId: 'tenant-a', invoiceSourceId: 'invoice-a', disputedAmountNative: '3000',
    expectedRevision: String(disputes[0].revision),
  })
})

test('customer invoice view joins current provider invoices and bulk validates every selected identity', async () => {
  const template = invoices[1]
  invoices.push(
    { ...template, source_id: 'invoice-b', invoice_number: 'INV-B', amount_due_native: '5000', amount_due_base: '5000' },
    { ...template, source_id: 'invoice-other', customer_source_id: 'customer-other' },
  )
  const before = await server.loadCustomerInvoiceDisputes({
    tenantId: 'tenant-a', customerSourceId: 'customer-a',
  })
  assert.deepEqual(before.map((invoice) => invoice.invoiceSourceId), ['invoice-a', 'invoice-b'])
  assert.equal(before[0].disputeMode, 'partial')
  assert.equal(before[1].disputeId, null)

  await assert.rejects(
    server.setFullCustomerInvoiceDisputes({
      tenantId: 'tenant-a', customerSourceId: 'customer-a',
      invoiceSourceIds: ['invoice-b', 'invoice-other'],
      expectedRevisions: [],
    }), /not_found/
  )
  assert.equal(disputes.some((row) => row.invoice_source_id === 'invoice-b'), false)

  const changed = await server.setFullCustomerInvoiceDisputes({
    tenantId: 'tenant-a', customerSourceId: 'customer-a',
    invoiceSourceIds: ['invoice-a', 'invoice-b'],
    expectedRevisions: [{ invoiceSourceId: 'invoice-a', revision: String(disputes[0].revision) }],
  })
  assert.equal(changed.length, 2)
  assert.deepEqual(changed.map((row) => row.recorded_disputed_amount_native), ['8000', '5000'])
  assert.equal(changed[0].id, disputes[0].id)
  assert.equal(changed[0].note, 'Check goods')
  assert.equal(disputes.some((row) => row.invoice_source_id === 'invoice-other'), false)

  invoices.push({ ...template, source_id: 'future-invoice' })
  invoices.push({ ...template, source_id: 'paid-invoice', status: 'PAID', amount_due_native: '0', amount_due_base: '0' })
  await assert.rejects(
    server.setFullCustomerInvoiceDisputes({
      tenantId: 'tenant-a', customerSourceId: 'customer-a', invoiceSourceIds: ['paid-invoice'],
      expectedRevisions: [],
    }), /invalid_invoice/
  )
  const after = await server.loadCustomerInvoiceDisputes({
    tenantId: 'tenant-a', customerSourceId: 'customer-a',
  })
  assert.equal(after.find((invoice) => invoice.invoiceSourceId === 'future-invoice').disputeId, null)
  assert.equal(after.find((invoice) => invoice.invoiceSourceId === 'invoice-b').collectibleAmountNative, '0')
  const allCurrent = await server.setFullCustomerInvoiceDisputes({
    tenantId: 'tenant-a', customerSourceId: 'customer-a',
    expectedRevisions: [
      { invoiceSourceId: 'invoice-a', revision: String(disputes[0].revision) },
      { invoiceSourceId: 'invoice-b', revision: String(disputes[1].revision) },
    ],
  })
  assert.equal(allCurrent.length, 3)
  assert.equal(disputes.some((row) => row.invoice_source_id === 'invoice-other'), false)
  assert.equal(disputes.some((row) => row.invoice_source_id === 'paid-invoice'), false)
  await assert.rejects(
    server.setFullCustomerInvoiceDisputes({
      tenantId: 'tenant-b', customerSourceId: 'customer-a',
      expectedRevisions: [],
    }), /forbidden/
  )
  invoices.splice(3)
  disputes.splice(1)
  const restored = await server.setPartialInvoiceDispute({
    tenantId: 'tenant-a', invoiceSourceId: 'invoice-a', disputedAmountNative: '3000',
    expectedRevision: String(disputes[0].revision),
  })
  assert.equal(restored.id, changed[0].id)
  assert.equal(restored.amount_due_at_last_review_native, '8000')
})

test('customer invoice view shows review changes and accounting settlement without user resolution', async () => {
  const current = invoices[1]
  current.amount_due_native = '2000'
  current.amount_due_base = '2000'
  try {
    const changed = await server.loadCustomerInvoiceDisputes({
      tenantId: 'tenant-a', customerSourceId: 'customer-a',
    })
    assert.equal(changed[0].needsReview, true)
    assert.equal(changed[0].recordedDisputedAmountNative, '3000')
    assert.equal(changed[0].effectiveDisputedAmountNative, '2000')
    assert.equal(changed[0].collectibleAmountNative, '0')
    await server.confirmInvoiceDisputeReview({ tenantId: 'tenant-a', disputeId: disputes[0].id,
      expectedRevision: String(disputes[0].revision) })
    const confirmed = await server.loadCustomerInvoiceDisputes({
      tenantId: 'tenant-a', customerSourceId: 'customer-a',
    })
    assert.equal(confirmed[0].needsReview, false)
    assert.equal(confirmed[0].recordedDisputedAmountNative, '3000')

    invoices.push({ ...current, sync_run_id: 'run-paid', status: 'PAID', amount_due_native: '0', amount_due_base: '0' })
    currentRun = 'run-paid'
    const settled = await server.loadCustomerInvoiceDisputes({
      tenantId: 'tenant-a', customerSourceId: 'customer-a',
    })
    assert.equal(settled[0].invoiceState, 'settled')
    assert.equal(settled[0].isActive, true)
    assert.equal(settled[0].isResolved, false)
    assert.equal(settled[0].effectiveDisputedAmountNative, '0')
  } finally {
    currentRun = 'run-2'
    invoices.pop()
    current.amount_due_native = '8000'
    current.amount_due_base = '8000'
    await server.confirmInvoiceDisputeReview({ tenantId: 'tenant-a', disputeId: disputes[0].id,
      expectedRevision: String(disputes[0].revision) })
  }
})

test('an absent invoice stays unavailable while its owned note and explicit resolution remain editable', async () => {
  currentRun = 'run-without-invoice'
  const id = disputes[0].id
  const edited = await server.editInvoiceDisputeNote({
    tenantId: 'tenant-a', disputeId: id, note: 'Still investigating',
    expectedRevision: String(disputes[0].revision),
  })
  assert.equal(edited.note, 'Still investigating')
  assert.equal(edited.dispute_mode, 'partial')
  assert.equal(edited.recorded_disputed_amount_native, '3000')
  assert.equal(deriveInvoiceDispute(null, edited).invoiceState, 'unavailable')
  const resolved = await server.resolveInvoiceDispute({ tenantId: 'tenant-a', disputeId: id,
    expectedRevision: String(disputes[0].revision) })
  assert.equal(resolved.is_active, false)
  currentRun = 'run-2'
})

test('tenant and user boundaries reject guessed invoice and dispute identities', async () => {
  await assert.rejects(
    server.setFullInvoiceDispute({ tenantId: 'tenant-b', invoiceSourceId: 'invoice-a' }),
    /forbidden/
  )
  const ownedId = disputes[0].id
  currentUser = 'user-b'
  await assert.rejects(
    server.resolveInvoiceDispute({ tenantId: 'tenant-b', disputeId: ownedId, expectedRevision: '1' }),
    /not_found/
  )
  await assert.rejects(
    server.confirmInvoiceDisputeReview({ tenantId: 'tenant-b', disputeId: ownedId, expectedRevision: '1' }),
    /not_found/
  )
  const otherTenantRows = await server.loadInvoiceDisputesForSnapshot({
    admin, userId: 'user-b', tenantId: 'tenant-b',
    snapshot: { userId: 'user-b', tenantId: 'tenant-b', mode: 'generation', syncRunId: currentRun },
  })
  assert.equal(otherTenantRows.length, 0)
  currentUser = null
  await assert.rejects(
    server.setFullInvoiceDispute({ tenantId: 'tenant-b', invoiceSourceId: 'invoice-a' }),
    /unauthorized/
  )
})

test('revisions reject stale edits and state changes without implicit reactivation', async () => {
  currentUser = 'user-a'
  currentRun = 'run-2'
  disputes.length = 0
  invoices.splice(3)
  const created = await server.setPartialInvoiceDispute({
    tenantId: 'tenant-a', invoiceSourceId: 'invoice-a', disputedAmountNative: '3000', note: 'Old',
  })
  assert.equal(created.revision, 1)
  const firstRevision = String(disputes[0].revision)
  const noted = await server.editInvoiceDisputeNote({ tenantId: 'tenant-a', disputeId: created.id,
    expectedRevision: firstRevision, note: 'New' })
  assert.equal(noted.revision, 2)
  await assert.rejects(server.editInvoiceDisputeNote({ tenantId: 'tenant-a', disputeId: created.id,
    expectedRevision: firstRevision, note: 'Stale' }), /conflict/)
  await assert.rejects(server.setFullInvoiceDispute({ tenantId: 'tenant-a', invoiceSourceId: 'invoice-a',
    expectedRevision: firstRevision }), /conflict/)
  assert.equal(disputes[0].note, 'New')

  const resolved = await server.resolveInvoiceDispute({ tenantId: 'tenant-a', disputeId: created.id,
    expectedRevision: String(noted.revision) })
  assert.equal(resolved.revision, 3)
  await assert.rejects(server.setPartialInvoiceDispute({ tenantId: 'tenant-a', invoiceSourceId: 'invoice-a',
    disputedAmountNative: '4000', expectedRevision: '2' }), /conflict/)
  await assert.rejects(server.resolveInvoiceDispute({ tenantId: 'tenant-a', disputeId: created.id,
    expectedRevision: '2' }), /conflict/)
  assert.equal(disputes[0].is_active, false)
  assert.equal(disputes[0].revision, 3)

  const reactivated = await server.reactivateInvoiceDispute({ tenantId: 'tenant-a',
    disputeId: created.id, expectedRevision: '3' })
  assert.equal(reactivated.id, created.id)
  assert.equal(reactivated.revision, 4)
  assert.equal(reactivated.amount_due_at_last_review_native, '8000')
  await assert.rejects(server.reactivateInvoiceDispute({ tenantId: 'tenant-a',
    disputeId: created.id, expectedRevision: '3' }), /conflict/)

  invoices.push({ ...invoices[1], sync_run_id: 'run-review', amount_due_native: '6000',
    amount_due_base: '6000' })
  currentRun = 'run-review'
  const noteOnly = await server.editInvoiceDisputeNote({ tenantId: 'tenant-a', disputeId: created.id,
    expectedRevision: '4', note: 'Review amount' })
  assert.equal(noteOnly.revision, 5)
  assert.equal(noteOnly.amount_due_at_last_review_native, '8000')
  assert.equal(deriveInvoiceDispute(invoices.at(-1), noteOnly).needsReview, true)
  await assert.rejects(server.confirmInvoiceDisputeReview({ tenantId: 'tenant-a',
    disputeId: created.id, expectedRevision: '4' }), /conflict/)
  assert.equal(disputes[0].amount_due_at_last_review_native, '8000')
  const confirmed = await server.confirmInvoiceDisputeReview({ tenantId: 'tenant-a',
    disputeId: created.id, expectedRevision: '5' })
  assert.equal(confirmed.revision, 6)
  assert.equal(deriveInvoiceDispute(invoices.at(-1), confirmed).needsReview, false)
})

test('bulk full checks the whole selection and preserves current database notes', async () => {
  currentUser = 'user-a'
  currentRun = 'run-2'
  disputes.length = 0
  invoices.splice(3)
  invoices.push({ ...invoices[1], source_id: 'invoice-b', amount_due_native: '5000',
    amount_due_base: '5000' })
  const existing = await server.setPartialInvoiceDispute({ tenantId: 'tenant-a',
    invoiceSourceId: 'invoice-a', disputedAmountNative: '2000', note: 'Old' })
  await server.editInvoiceDisputeNote({ tenantId: 'tenant-a', disputeId: existing.id,
    expectedRevision: '1', note: 'New' })
  const before = { ...disputes[0] }
  await assert.rejects(server.setFullCustomerInvoiceDisputes({ tenantId: 'tenant-a',
    customerSourceId: 'customer-a', invoiceSourceIds: ['invoice-a', 'invoice-b'],
    expectedRevisions: [{ invoiceSourceId: 'invoice-a', revision: '1' }],
  }), /conflict/)
  assert.equal(disputes.length, 1)
  assert.deepEqual(disputes[0], before)

  const result = await server.setFullCustomerInvoiceDisputes({ tenantId: 'tenant-a',
    customerSourceId: 'customer-a', invoiceSourceIds: ['invoice-a', 'invoice-b'],
    expectedRevisions: [{ invoiceSourceId: 'invoice-a', revision: '2' }],
  })
  assert.equal(result.length, 2)
  assert.equal(disputes[0].revision, 3)
  assert.equal(disputes[0].note, 'New')
  assert.equal(disputes[1].revision, 1)
  assert.equal(disputes[1].dispute_mode, 'full')

  const resolved = await server.resolveInvoiceDispute({ tenantId: 'tenant-a',
    disputeId: disputes[0].id, expectedRevision: '3' })
  assert.equal(resolved.revision, 4)
  const unchanged = { ...disputes[1] }
  await assert.rejects(server.setFullCustomerInvoiceDisputes({ tenantId: 'tenant-a',
    customerSourceId: 'customer-a', invoiceSourceIds: ['invoice-a', 'invoice-b'],
    expectedRevisions: [
      { invoiceSourceId: 'invoice-a', revision: '4' },
      { invoiceSourceId: 'invoice-b', revision: '1' },
    ],
  }), /conflict/)
  assert.equal(disputes[0].is_active, false)
  assert.deepEqual(disputes[1], unchanged)
})

test('customer invoice DTO retains native amounts and revision without unvalidated base fields', async () => {
  currentUser = 'user-a'
  currentRun = 'run-2'
  invoices.splice(3)
  disputes.length = 0
  const current = invoices[1]
  const original = { ...current }
  try {
    current.transaction_currency_code = 'USD'
    current.organisation_base_currency_code = 'EUR'
    current.xero_currency_rate = null
    current.amount_due_base = '8000'
    const dispute = await server.setPartialInvoiceDispute({ tenantId: 'tenant-a',
      invoiceSourceId: 'invoice-a', disputedAmountNative: '3000' })
    const [row] = await server.loadCustomerInvoiceDisputes({ tenantId: 'tenant-a',
      customerSourceId: 'customer-a' })
    assert.equal(row.revision, String(dispute.revision))
    assert.equal(row.currentAmountDueNative, '8000')
    assert.equal(row.recordedDisputedAmountNative, '3000')
    assert.equal(row.effectiveDisputedAmountNative, '3000')
    assert.equal(row.collectibleAmountNative, '5000')
    assert.equal('grossOpenAmountBase' in row, false)
    assert.equal('effectiveDisputedAmountBase' in row, false)
    assert.equal('collectibleAmountBase' in row, false)
    assert.equal('user_id' in row, false)
  } finally {
    Object.assign(current, original)
  }
})
