export function promise(overrides = {}) {
  return {
    id: 'promise-1', revision: 1, user_id: 'user-1', tenant_id: 'tenant-1', source_system: 'xero',
    invoice_source_id: 'invoice-1', customer_source_id: 'customer-1', currency_code: 'GBP',
    promised_amount_native: '4000', qualifying_paid_amount_native: '0', status: 'active',
    promised_date: '2026-09-30', created_at: '2026-09-27T09:00:00Z', creation_sync_run_id: 'creation-run',
    payment_baseline: { version: 1, payment_ids: ['old-payment'],
      observation_started_at: '2026-09-27T08:00:00Z', observation_completed_at: '2026-09-27T08:59:00Z' },
    ...overrides,
  }
}
const scope = { user_id: 'user-1', tenant_id: 'tenant-1', source_system: 'xero', sync_run_id: 'run-1' }
export function payment(overrides = {}) {
  return { ...scope, source_id: 'payment-1', invoice_source_id: 'invoice-1', customer_source_id: 'customer-1',
    amount_native: '1000', currency_code: 'GBP', payment_date: '2026-09-28',
    payment_type: 'ACCRECPAYMENT', payment_status: 'AUTHORISED', source_updated_at: '2026-09-28T12:00:00Z', ...overrides }
}
export function cash(overrides = {}) {
  return { ...scope, source_kind: 'overpayment', source_id: 'cash-1', customer_source_id: 'customer-1',
    provider_type: 'RECEIVE-OVERPAYMENT', remaining_credit_native: '3500', currency_code: 'GBP',
    accounting_date: '2026-09-29', status: 'AUTHORISED', source_updated_at: null,
    organisation_base_currency_code: 'GBP', xero_currency_rate: null, remaining_credit_base: '3500',
    currency_conversion_status: 'identity', currency_conversion_failure_reason: null, ...overrides }
}
export function valuation(overrides = {}) {
  return { ...scope, invoice_source_id: 'invoice-1', currency_code: 'GBP',
    organisation_base_currency_code: 'GBP', xero_currency_rate: null, currency_conversion_status: 'identity', ...overrides }
}
export function observation(payments = [], cashRows = [], overrides = {}) {
  const started = overrides.started ?? '2026-10-01T00:00:00Z'
  const completed = overrides.completed ?? '2026-10-01T00:01:00Z'
  const rest = { ...overrides }
  delete rest.started
  delete rest.completed
  return { ...scope, contract_version: 'promise_accounting_evidence_v1', status: 'succeeded',
    authoritative: true, ready: true, timezone_iana: 'Europe/London', organisation_base_currency_code: 'GBP',
    resources: ['payments', 'overpayments', 'prepayments'].map(resource => {
      const count = resource === 'payments' ? payments.length : cashRows.filter(row => row.source_kind === (resource === 'overpayments' ? 'overpayment' : 'prepayment')).length
      return { resource, started_at: started, completed_at: completed, complete: true,
        source_count: count, mapped_count: count, page_requests: count ? 2 : 1, populated_pages: count ? 1 : 0 }
    }), ...rest }
}
