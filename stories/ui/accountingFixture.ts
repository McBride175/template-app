import type { ProductAccountingStatus } from '@/lib/accounting/product-refresh'

// Display fixture only; no observer, accounting client or financial service.
export const accountingFixture: ProductAccountingStatus = {
  connection: { provider: 'xero', providerOrganisationId: 'synthetic', health: 'healthy', displayName: 'Xero' },
  accounting: { state: 'valid', mode: 'generation', activeGenerationId: 'synthetic',
    lastSuccessfulRefreshAt: '2026-10-10T13:00:00Z', accountingObservedAt: '2026-10-10T13:00:00Z',
    ageSeconds: 600, freshness: 'fresh', derivatives: { state: 'ready', generationId: 'synthetic',
      financialEpoch: '1', evaluationDate: '2026-10-10' } },
  work: { phase: 'complete', stage: null, activity: 'updated', jobId: 'synthetic',
    trigger: 'manual', requestedAt: null, startedAt: null, completedAt: '2026-10-10T13:00:00Z' },
  failure: null,
}
