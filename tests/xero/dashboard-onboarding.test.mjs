import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const projectFile = (path) => new URL(`../../${path}`, import.meta.url)

test('Dashboard derives connection, reconnect, error, and ready surfaces from server status', async () => {
  const source = await readFile(
    projectFile('app/dashboard/DashboardOnboardingClient.tsx'),
    'utf8'
  )

  assert.match(source, /fetchXeroConnectionStatus\(tenantId\)/)
  assert.match(source, /resolveXeroAccountStatusView/)
  assert.match(source, /xeroViewState === 'disconnected'/)
  assert.match(source, /state="disconnected"/)
  assert.match(source, /xeroViewState === 'reconnect_required'/)
  assert.match(source, /state="reconnect_required"/)
  assert.match(source, /xeroViewState === 'error'/)
  assert.match(source, /Try again/)
  assert.match(source, /xeroViewState === 'connected' \|\| xeroViewState === 'temporary_issue'/)
  assert.match(source, /<CollectionActionsClient embedded showTable=\{false\}/)
})

test('Dashboard connection cards provide one direct, customer-facing Xero action', async () => {
  const source = await readFile(
    projectFile('app/dashboard/DashboardXeroConnectionCard.tsx'),
    'utf8'
  )

  assert.match(source, /Connect Xero to see who to chase first/)
  assert.match(source, /secure, read-only access/)
  assert.match(source, /Reconnect Xero to refresh your priorities/)
  assert.match(source, /previously imported information has not been removed/)
  assert.match(source, /buildXeroConnectPath\(returnTo\)/)
  assert.doesNotMatch(source, /tenant ID|canonical|OAuth grant|Sync Now/i)
})

test('collections missing-tenant race and not-ready data render intentional recovery states', async () => {
  const source = await readFile(
    projectFile('app/collections/actions/CollectionActionsClient.tsx'),
    'utf8'
  )

  assert.match(source, /payload\?\.code === 'NO_XERO_TENANT'/)
  assert.match(source, /setXeroConnectionMissing\(true\)/)
  assert.match(source, /<DashboardXeroConnectionCard state="disconnected"/)
  assert.match(source, /queueInfo\?\.status === 'no_mapped_data'/)
  assert.match(source, /Preparing your collection priorities/)
  assert.match(source, /Check again/)
  assert.doesNotMatch(source, /Sync Xero to load and map customer and invoice data/)
})

test('Dashboard keeps existing auto-sync entry behavior and does not add sync orchestration', async () => {
  const source = await readFile(
    projectFile('app/dashboard/DashboardOnboardingClient.tsx'),
    'utf8'
  )

  assert.match(source, /triggerXeroAutoSyncOnEntry\(\{/)
  assert.match(source, /surface: 'dashboard'/)
  assert.doesNotMatch(source, /api\/xero\/sync/)
  assert.doesNotMatch(source, /setInterval/)
})

test('Checkout return banner polls server state and never treats the query as entitlement', async () => {
  const [dashboardSource, subscriptionSource, subscriptionRouteSource] = await Promise.all([
    readFile(projectFile('app/dashboard/DashboardOnboardingClient.tsx'), 'utf8'),
    readFile(projectFile('app/components/SubscriptionStatus.tsx'), 'utf8'),
    readFile(projectFile('app/api/subscription/route.ts'), 'utf8'),
  ])

  assert.match(dashboardSource, /<SubscriptionStatus checkoutOnly loginNextPath="\/dashboard"/)
  assert.match(subscriptionSource, /fetch\('\/api\/subscription'/)
  assert.match(subscriptionSource, /const maxPolls = 8/)
  assert.match(subscriptionSource, /if \(subscription\?\.hasActive\)/)
  assert.match(subscriptionSource, /We are confirming your plan/)
  assert.match(subscriptionSource, /Your plan is active/)
  assert.doesNotMatch(subscriptionSource, /setSubscription\([^)]*checkoutSuccess/)
  assert.match(subscriptionRouteSource, /isSubscriptionPaid\(\{/)
  assert.doesNotMatch(subscriptionRouteSource, /checkout=success|searchParams\.get\('checkout'\)/)
})

test('cancelled Checkout is non-blocking and leaves a route back to Pricing', async () => {
  const source = await readFile(projectFile('app/components/SubscriptionStatus.tsx'), 'utf8')

  assert.match(source, /checkoutCancelled/)
  assert.match(source, /You were not charged and your plan was not changed/)
  assert.match(source, /href="\/pricing"/)
  assert.match(source, /if \(checkoutOnly && checkoutCancelled\)/)
  assert.match(source, /url\.searchParams\.delete\('checkout'\)/)
})

test('Account retains manual sync and its Xero connections return to Account', async () => {
  const source = await readFile(projectFile('app/account/page.tsx'), 'utf8')

  assert.match(source, /Sync now/)
  assert.match(source, /api\/xero\/sync/)
  assert.match(source, /\/api\/xero\/connect\?returnTo=%2Faccount/)
  assert.match(source, /getXeroCallbackNotice/)
})
