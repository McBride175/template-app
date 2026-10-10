import { test as base, expect } from '@playwright/test'
import { baseURL, supabaseOrigin } from './environment'

export const test = base.extend<{ safeNetwork: void }>({
  safeNetwork: [async ({ context }, use) => {
    const unexpected: string[] = []
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url())
      // Product activity can request Xero refresh automatically. Read-only smoke
      // never sends refresh intent, OAuth, billing, email or financial mutations.
      if (url.origin === baseURL && /\/api\/(accounting\/refresh|xero\/(sync|auto-sync|connect))/.test(url.pathname)) {
        await route.abort('blockedbyclient')
      } else if (url.origin === baseURL && ['GET', 'HEAD'].includes(request.method())) {
        await route.continue()
      } else if (url.origin === supabaseOrigin && request.method() === 'GET' && url.pathname === '/auth/v1/user') {
        await route.continue()
      } else {
        // External fonts/Turnstile/telemetry are unnecessary for these journeys.
        if (url.origin === baseURL || url.hostname.endsWith('.supabase.co')) unexpected.push(`${request.method()} ${url.origin}${url.pathname}`)
        await route.abort('blockedbyclient')
      }
    })
    await use()
    expect(unexpected, 'Unexpected application writes or non-Test Supabase access').toEqual([])
  }, { auto: true }],
})

export { expect }
