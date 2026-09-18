import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { loadTypeScriptModule } from './test-helpers/ts-module-loader.mjs'

const founderContext = loadTypeScriptModule('lib/collections/founder-context.ts')
const prioritization = loadTypeScriptModule('lib/collections/prioritization.ts')
const projectFile = (path) => new URL(`../../${path}`, import.meta.url)

function queueRow(id, overrides = {}) {
  return {
    customer_source_id: id,
    customer_name: `Customer ${id}`,
    override_level: 'normal',
    recommended_action: 'Review now',
    ...overrides,
  }
}

test('founder context preserves the established four states and zero-configuration default', () => {
  assert.equal(founderContext.DEFAULT_FOUNDER_CONTEXT_LEVEL, 'normal')
  assert.deepEqual(
    founderContext.FOUNDER_CONTEXT_OPTIONS.map((option) => option.value),
    ['priority', 'normal', 'safe', 'do_not_chase']
  )
  assert.deepEqual(prioritization.OVERRIDE_MULTIPLIERS, {
    safe: 0.4,
    normal: 1,
    priority: 1.6,
    do_not_chase: 0,
  })
})

test('actionable queue excludes durable do-not-chase, no-action, and actioned customers', () => {
  const selected = founderContext.selectActionableFounderContextRows(
    [
      queueRow('live'),
      queueRow('do-not', { override_level: 'do_not_chase' }),
      queueRow('no-action', { recommended_action: 'No action' }),
      queueRow('actioned'),
    ],
    { actioned: { type: 'called' } }
  )

  assert.deepEqual(selected.map((row) => row.customer_source_id), ['live'])
})

test('authoritative reranking keeps context except when the current first priority moves down', () => {
  assert.equal(
    founderContext.resolveFounderContextQueueIndex({
      customerSourceId: 'adjusted',
      previousIndex: 2,
      nextQueueRows: [queueRow('first'), queueRow('adjusted'), queueRow('third')],
    }),
    1
  )

  assert.equal(
    founderContext.resolveFounderContextQueueIndex({
      customerSourceId: 'adjusted',
      previousIndex: 0,
      nextQueueRows: [queueRow('new-first'), queueRow('adjusted')],
    }),
    0
  )

  assert.equal(
    founderContext.resolveFounderContextQueueIndex({
      customerSourceId: 'removed',
      previousIndex: 1,
      nextQueueRows: [queueRow('first'), queueRow('next')],
    }),
    1
  )
})

test('ranking consequence copy is based on the refreshed authoritative positions', () => {
  assert.equal(
    founderContext.buildFounderContextConsequence({
      customerName: 'Acme',
      level: 'priority',
      previousPosition: 4,
      nextPosition: 1,
    }),
    'Marked Priority — Acme is now your first priority.'
  )
  assert.match(
    founderContext.buildFounderContextConsequence({
      customerName: 'Acme',
      level: 'safe',
      previousPosition: 1,
      nextPosition: 4,
    }),
    /moved from #1 to #4/
  )
  assert.match(
    founderContext.buildFounderContextConsequence({
      customerName: 'Acme',
      level: 'normal',
      previousPosition: 2,
      nextPosition: 2,
    }),
    /accounting data alone/
  )
  assert.match(
    founderContext.buildFounderContextConsequence({
      customerName: 'Acme',
      level: 'do_not_chase',
      previousPosition: 1,
      nextPosition: null,
    }),
    /removed from the chase queue until you change this setting/
  )
  assert.match(
    founderContext.buildFounderContextConsequence({
      customerName: 'Acme',
      level: 'safe',
      previousPosition: 2,
      nextPosition: 2,
    }),
    /saved for Acme/
  )
})

test('first value remains independent and founder context starts in the operational queue', async () => {
  const [firstValueView, firstValueClient, actionsClient, founderControl] = await Promise.all([
    readFile(projectFile('app/start/result/FirstValueResultView.tsx'), 'utf8'),
    readFile(projectFile('app/start/result/FirstValueResultClient.tsx'), 'utf8'),
    readFile(projectFile('app/collections/actions/CollectionActionsClient.tsx'), 'utf8'),
    readFile(projectFile('app/collections/FounderContextControl.tsx'), 'utf8'),
  ])

  assert.doesNotMatch(firstValueView, /FounderContextControl|Know something Yuohme/)
  assert.doesNotMatch(firstValueClient, /first.?value.?viewed|founder.?education/i)
  assert.match(actionsClient, /FounderContextControl/)
  assert.match(actionsClient, /const refreshed = await loadRows\(true\)/)
  assert.match(actionsClient, /resolveFounderContextQueueIndex/)
  assert.match(actionsClient, /overrideRequestsInFlight/)
  assert.match(founderControl, /Know something Yuohme doesn&apos;t\?/)
  assert.match(founderControl, /Optionally add durable context/)
  assert.match(founderControl, /Use Postpone or a payment promise/)
  assert.match(founderControl, /aria-pressed=/)
  assert.match(founderControl, /min-h-11/)
  assert.match(founderControl, /grid-cols-2 gap-2 sm:grid-cols-4/)
  assert.doesNotMatch(founderControl, /1\.6|1\.0|0\.4|multiplier/i)
})

test('Customers provides an optional scoped path using the same authoritative mutation API', async () => {
  const [route, client, mutationRoute] = await Promise.all([
    readFile(projectFile('app/api/collections/customers/route.ts'), 'utf8'),
    readFile(projectFile('app/collections/customers/CustomerCollectionsClient.tsx'), 'utf8'),
    readFile(projectFile('app/api/collections/override/route.ts'), 'utf8'),
  ])

  assert.match(route, /\.from\('customer_overrides'\)/)
  assert.match(route, /\.eq\('user_id', user\.id\)/)
  assert.match(route, /\.eq\('tenant_id', tenantId\)/)
  assert.match(client, /Find a customer/)
  assert.match(client, /fetch\('\/api\/collections\/override'/)
  assert.match(client, /Customer context stays in place until you change it/)
  assert.match(client, /Normal is\s+the default and needs no action/)
  assert.match(client, /contextRequestsInFlight/)
  assert.match(mutationRoute, /if \(overrideLevel === 'normal'\)/)
  assert.match(mutationRoute, /\.from\('customer_overrides'\)\s*\.delete\(\)/)
  assert.match(mutationRoute, /onConflict: 'user_id,tenant_id,customer_source_id'/)
})
