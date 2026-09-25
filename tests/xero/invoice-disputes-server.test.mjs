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
    upsert(payload) { state.action = 'upsert'; state.payload = payload; return this },
    async maybeSingle() {
      const result = execute()
      return { data: result[0] ?? null, error: null }
    },
    async single() {
      const result = execute()
      return { data: result[0] ?? null, error: result.length === 1 ? null : new Error('missing') }
    },
    then(resolve, reject) { return Promise.resolve({ data: execute(), error: null }).then(resolve, reject) },
  }
  function execute() {
    const rows = table === 'canonical_invoices' ? invoices : disputes
    if (state.action === 'upsert') {
      const identity = ['user_id', 'tenant_id', 'source_system', 'invoice_source_id']
      const existing = disputes.find((row) => identity.every((key) => row[key] === state.payload[key]))
      if (existing) Object.assign(existing, state.payload)
      else disputes.push({
        id: `dispute-${disputes.length + 1}`, created_at: '2026-09-24T00:00:00Z',
        updated_at: '2026-09-24T00:00:00Z', ...state.payload,
      })
      return [existing ?? disputes.at(-1)]
    }
    let matched = rows.filter((row) => state.filters.every(([key, value]) => row[key] === value))
    if (state.action === 'update') {
      for (const row of matched) Object.assign(row, state.payload)
    }
    if (state.range) matched = matched.slice(state.range[0], state.range[1] + 1)
    return matched
  }
  return builder
}

const admin = { from: query }
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
  const confirmed = await server.confirmInvoiceDisputeReview({ tenantId: 'tenant-a', disputeId: created.id })
  assert.equal(confirmed.recorded_disputed_amount_native, '10000')
  assert.equal(confirmed.note, 'Check goods')
  assert.equal(confirmed.amount_due_at_last_review_native, '8000')
  assert.equal(deriveInvoiceDispute(currentInvoice, confirmed).needsReview, false)

  const resolved = await server.resolveInvoiceDispute({ tenantId: 'tenant-a', disputeId: created.id })
  assert.equal(resolved.is_active, false)
  assert.ok(resolved.resolved_at)
  const reactivated = await server.reactivateInvoiceDispute({ tenantId: 'tenant-a', disputeId: created.id })
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
  const created = await server.setPartialInvoiceDispute({ tenantId: 'tenant-a', invoiceSourceId: 'invoice-a', disputedAmountNative: '3000' })
  assert.equal(created.recorded_disputed_amount_native, '3000')
  assert.equal(deriveInvoiceDispute(invoices[1], created).collectibleAmountNative, '5000')
})

test('an absent invoice stays unavailable while its owned note and explicit resolution remain editable', async () => {
  currentRun = 'run-without-invoice'
  const id = disputes[0].id
  const edited = await server.editInvoiceDisputeNote({
    tenantId: 'tenant-a', disputeId: id, note: 'Still investigating',
  })
  assert.equal(edited.note, 'Still investigating')
  assert.equal(edited.dispute_mode, 'partial')
  assert.equal(edited.recorded_disputed_amount_native, '3000')
  assert.equal(deriveInvoiceDispute(null, edited).invoiceState, 'unavailable')
  const resolved = await server.resolveInvoiceDispute({ tenantId: 'tenant-a', disputeId: id })
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
    server.resolveInvoiceDispute({ tenantId: 'tenant-b', disputeId: ownedId }),
    /not_found/
  )
  await assert.rejects(
    server.confirmInvoiceDisputeReview({ tenantId: 'tenant-b', disputeId: ownedId }),
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
