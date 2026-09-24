import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { loadTypeScriptModule } from './test-helpers/ts-module-loader.mjs'

const currentDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(currentDir, '../..')

const guidance = await loadTypeScriptModule(
  path.join(repoRoot, 'lib/collections/progressive-guidance.ts')
)

test('first-action guidance is derived from authoritative operational activity', () => {
  assert.equal(
    guidance.shouldShowFirstActionGuidance({ hasPriorCollectionActivity: false }),
    true
  )
  assert.equal(
    guidance.shouldShowFirstActionGuidance({ hasPriorCollectionActivity: true }),
    false
  )
  assert.equal(guidance.shouldShowFirstActionGuidance(null), false)
})

test('commercial guidance stays hidden until the free allowance boundary', () => {
  const base = {
    isPaid: false,
    hasActionsAccess: true,
    freeUsageDaysLimit: 5,
  }

  assert.equal(
    guidance.resolveFreeUsageGuidance({ ...base, usageDaysRemaining: 4 }),
    null
  )
  assert.deepEqual(
    guidance.resolveFreeUsageGuidance({ ...base, usageDaysRemaining: 1 }),
    {
      message: 'One free collection day remains after today.',
      actionLabel: 'View plans',
    }
  )
  assert.match(
    guidance.resolveFreeUsageGuidance({ ...base, usageDaysRemaining: 0 }).message,
    /Today remains available; your 5 free collection days are now used/
  )
})

test('commercial guidance does not compete with paid or gated states', () => {
  assert.equal(
    guidance.resolveFreeUsageGuidance({
      isPaid: true,
      hasActionsAccess: true,
      usageDaysRemaining: null,
      freeUsageDaysLimit: 5,
    }),
    null
  )
  assert.equal(
    guidance.resolveFreeUsageGuidance({
      isPaid: false,
      hasActionsAccess: false,
      usageDaysRemaining: 0,
      freeUsageDaysLimit: 5,
    }),
    null
  )
})

test('operational UI stays contextual and avoids a dedicated onboarding checklist', () => {
  const client = fs.readFileSync(
    path.join(repoRoot, 'app/collections/actions/CollectionActionsClient.tsx'),
    'utf8'
  )
  const nav = fs.readFileSync(path.join(repoRoot, 'app/components/Nav.tsx'), 'utf8')

  assert.match(client, /Work the priority, then record what happened/)
  assert.match(client, /Postponed customers and\s+payment promises return on the date you choose/)
  assert.match(client, /You&apos;re done for today/)
  assert.match(client, /Browse customers/)
  assert.match(client, /setExperience\(\{ hasPriorCollectionActivity: true \}\)/)
  assert.match(client, /showManualQueueRefresh/)
  assert.match(client, /Resume preparation/)
  assert.doesNotMatch(client, /Review disputes section/)
  assert.doesNotMatch(client, /Check again/)
  assert.doesNotMatch(client, /Free collection days used:/)
  assert.doesNotMatch(nav, /href="\/admin"/)
})

test('golden path and founder context remain outside any mandatory setup flow', () => {
  const result = fs.readFileSync(
    path.join(repoRoot, 'app/start/result/FirstValueResultView.tsx'),
    'utf8'
  )
  const founder = fs.readFileSync(
    path.join(repoRoot, 'app/collections/FounderContextControl.tsx'),
    'utf8'
  )

  assert.match(result, /Open today’s queue/)
  assert.doesNotMatch(result, /onboarding|checklist|complete your setup/i)
  assert.match(founder, /Optionally add durable context/)
})
