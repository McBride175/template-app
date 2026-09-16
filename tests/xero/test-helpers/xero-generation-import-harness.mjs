import assert from 'node:assert/strict'

export function emptyMetadata() {
  return {
    minimumMinuteRemaining: null,
    minimumDayRemaining: null,
    minimumAppMinuteRemaining: null,
    latestMinuteRemaining: null,
    latestDayRemaining: null,
    latestAppMinuteRemaining: null,
    maximumRetryAfterSeconds: null,
    rateLimitProblems: [],
    correlationIds: [],
  }
}

export function pageResult(records, overrides = {}) {
  return {
    records,
    recordCount: records.length,
    populatedPageCount: records.length ? 1 : 0,
    pageRequestCount: records.length ? 2 : 1,
    httpAttemptCount: records.length ? 2 : 1,
    metadata: emptyMetadata(),
    ...overrides,
  }
}

export function organisationResult(tenantId, overrides = {}) {
  return {
    records: [{
      OrganisationID: tenantId,
      Name: `Organisation ${tenantId}`,
      BaseCurrency: 'GBP',
      ...overrides,
    }],
    attemptCount: 1,
    metadata: emptyMetadata(),
  }
}

export function contact(id, updated = '2026-09-15T10:00:00.000Z', overrides = {}) {
  return {
    ContactID: id,
    Name: `Contact ${id}`,
    ContactStatus: 'ACTIVE',
    UpdatedDateUTC: updated,
    ...overrides,
  }
}

export function invoice(
  id,
  contactId,
  status,
  updated = '2026-09-15T10:00:00.000Z',
  overrides = {}
) {
  return {
    InvoiceID: id,
    Contact: { ContactID: contactId },
    Type: 'ACCREC',
    Status: status,
    DateString: '2026-08-01',
    DueDateString: '2026-08-31',
    CurrencyCode: 'GBP',
    CurrencyRate: '1',
    Total: 100,
    AmountDue: status === 'PAID' ? 0 : 100,
    AmountPaid: status === 'PAID' ? 100 : 0,
    AmountCredited: 0,
    FullyPaidOnDate: status === 'PAID' ? '2026-09-05' : undefined,
    UpdatedDateUTC: updated,
    ...overrides,
  }
}

export function payment(
  id,
  invoiceId,
  status = 'AUTHORISED',
  updated = '2026-09-15T10:00:00.000Z',
  overrides = {}
) {
  return {
    PaymentID: id,
    Invoice: { InvoiceID: invoiceId },
    PaymentType: 'ACCRECPAYMENT',
    Status: status,
    Amount: 100,
    Date: '2026-09-05',
    UpdatedDateUTC: updated,
    ...overrides,
  }
}

export function createGenerationImportHarness(options = {}) {
  const tenantId = options.tenantId ?? 'tenant-a'
  const userId = options.userId ?? 'user-a'
  const grantId = options.grantId ?? 'grant-a'
  const leaseOwner = options.leaseOwner ?? 'owner-a'
  const runId = options.runId ?? `run-${tenantId}`
  const fence = options.fence ?? 1
  const steps = new Map([
    'organisation',
    'contacts',
    'authorised_accrec_invoices',
    'paid_accrec_invoices',
    'authorised_accrec_payments',
    'canonical_mapping',
    'validation',
  ].map((stepKey) => [stepKey, {
    stepKey,
    status: 'pending',
    recordCount: null,
    completedAt: null,
  }]))
  const events = []
  const persisted = new Map()
  const failures = []
  const leaseTimers = []
  const cancelledLeaseTimers = []
  const deadlineTimers = []
  const cancelledDeadlineTimers = []
  let heartbeatCount = 0
  let tokenLoads = 0
  let readinessRecords = 0

  const primary = {
    contacts: options.contacts ?? [contact('contact-a')],
    authorisedInvoices: options.authorisedInvoices ?? [
      invoice('invoice-open', 'contact-a', 'AUTHORISED'),
    ],
    paidInvoices: options.paidInvoices ?? [
      invoice('invoice-paid', 'contact-a', 'PAID'),
    ],
    payments: options.payments ?? [payment('payment-a', 'invoice-paid')],
  }
  const catchUp = {
    contacts: options.catchUpContacts ?? [],
    invoices: options.catchUpInvoices ?? [],
    payments: options.catchUpPayments ?? [],
  }

  const dependencies = {
    createSupabaseAdminClient() {
      return {}
    },
    async acquireRun(params) {
      events.push(`acquire:${params.tenantId}`)
      return options.acquisition ?? {
        acquired: true,
        resultCode: 'acquired',
        syncRunId: runId,
        fencingToken: fence,
        leaseExpiresAt: '2026-09-15T10:05:00.000Z',
      }
    },
    async heartbeatRun(params) {
      heartbeatCount += 1
      events.push(`heartbeat:${params.tenantId ?? tenantId}`)
      return options.heartbeatResult ?? {
        renewed: true,
        resultCode: 'renewed',
        leaseExpiresAt: '2026-09-15T10:10:00.000Z',
      }
    },
    async completeStep({ stepKey, recordCount }) {
      events.push(`step:${stepKey}`)
      const step = steps.get(stepKey)
      assert.ok(step, `unknown step ${stepKey}`)
      if (options.rejectStep === stepKey) {
        return { completed: false, resultCode: 'superseded' }
      }
      if (step.status === 'succeeded' && step.recordCount !== recordCount) {
        return { completed: false, resultCode: 'record_count_conflict' }
      }
      step.status = 'succeeded'
      step.recordCount = recordCount
      step.completedAt = '2026-09-15T10:01:00.000Z'
      return { completed: true, resultCode: 'completed' }
    },
    async failRun(params) {
      failures.push(params)
      events.push(`fail:${params.errorCode}`)
      return { failed: true, resultCode: 'failed' }
    },
    async loadManifest() {
      events.push('manifest')
      return [...steps.values()].map((step) => ({ ...step }))
    },
    async recordReadiness(params) {
      readinessRecords += 1
      events.push('readiness:record')
      if (options.readinessResult) return options.readinessResult(params)
      return {
        validated: true,
        resultCode: 'validated',
        validationId: 'validation-evidence-a',
        validatedAt: '2026-09-15T10:01:00.000Z',
        contractVersion: 'collections_readiness_v2',
        fencingToken: params.fencingToken,
        baseCurrencyCode: 'GBP',
        incompleteFxInvoiceCount: 0,
        fxViolationCount: 0,
      }
    },
    async loadAccessToken({ forceRefresh = false }) {
      tokenLoads += 1
      events.push(forceRefresh ? 'token:refresh' : 'token:load')
      if (options.tokenResult) return options.tokenResult(forceRefresh, tokenLoads)
      return {
        ok: true,
        accessToken: forceRefresh ? 'token-refreshed' : 'token-initial',
        tenantId,
        grantId,
        scopes: [
          'offline_access',
          'accounting.settings.read',
          'accounting.contacts.read',
          'accounting.transactions.read',
        ],
      }
    },
    async fetchOrganisation(request) {
      events.push('fetch:organisation')
      if (options.fetchOrganisation) return options.fetchOrganisation(request)
      return organisationResult(tenantId)
    },
    async fetchCollection(request) {
      const isCatchUp = Boolean(request.ifModifiedSince)
      const status = request.config.query.Statuses?.[0]
      let name
      let records
      if (request.config.resource === 'contacts') {
        name = isCatchUp ? 'catchup:contacts' : 'contacts'
        records = isCatchUp ? catchUp.contacts : primary.contacts
      } else if (request.config.resource === 'invoices') {
        if (isCatchUp) {
          name = 'catchup:invoices'
          records = catchUp.invoices
        } else if (status === 'AUTHORISED') {
          name = 'invoices:authorised'
          records = primary.authorisedInvoices
        } else {
          name = 'invoices:paid'
          records = primary.paidInvoices
        }
      } else {
        name = isCatchUp ? 'catchup:payments' : 'payments'
        records = isCatchUp ? catchUp.payments : primary.payments
      }
      events.push(`fetch:${name}`)
      if (options.fetchCollection) {
        return options.fetchCollection({ request, name, records, pageResult })
      }
      return pageResult(records)
    },
    async persistRaw({ resourceType, records }) {
      events.push(`persist:${resourceType}`)
      persisted.set(resourceType, records.map((record) => ({ ...record })))
      if (options.persistErrorResource === resourceType) throw new Error('sensitive persistence detail')
      return { inputCount: records.length, affectedCount: records.length, batchCount: records.length ? 1 : 0 }
    },
    async mapCanonical() {
      events.push('map')
      if (options.mappingError) throw options.mappingError
      const organisations = persisted.get('organisations')?.length ?? 0
      const contacts = persisted.get('contacts')?.length ?? 0
      const invoices = persisted.get('invoices')?.length ?? 0
      const payments = persisted.get('payments')?.length ?? 0
      return options.mappingResult ?? {
        counts: {
          organisations,
          customers: contacts,
          invoices,
          payments,
        },
        writes: {},
        validation: {
          organisationBaseCurrencyCode: 'GBP',
          incompleteFxInvoiceCount: 0,
          completeFxInvoiceCount: invoices,
        },
      }
    },
    now: options.now ?? (() => Date.parse('2026-09-15T10:00:00.000Z')),
    scheduleDeadline(callback, milliseconds) {
      const handle = { callback, milliseconds }
      deadlineTimers.push(handle)
      return handle
    },
    cancelDeadline(handle) {
      cancelledDeadlineTimers.push(handle)
    },
    leaseTimers: {
      schedule(callback, milliseconds) {
        const handle = { callback, milliseconds }
        leaseTimers.push(handle)
        return handle
      },
      cancel(handle) {
        cancelledLeaseTimers.push(handle)
      },
    },
  }

  return {
    params: {
      userId,
      tenantId,
      grantId,
      leaseOwner,
      supabaseAdmin: {},
      dependencies,
    },
    dependencies,
    events,
    persisted,
    failures,
    steps,
    leaseTimers,
    cancelledLeaseTimers,
    deadlineTimers,
    cancelledDeadlineTimers,
    get heartbeatCount() {
      return heartbeatCount
    },
    get tokenLoads() {
      return tokenLoads
    },
    get readinessRecords() {
      return readinessRecords
    },
  }
}
