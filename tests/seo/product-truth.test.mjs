import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const HOME_PAGE_PATH = new URL('../../app/page.tsx', import.meta.url)
const PRICING_CLIENT_PATH = new URL('../../app/pricing/PricingClient.tsx', import.meta.url)
const ACTIONS_CLIENT_PATH = new URL(
  '../../app/collections/actions/CollectionActionsClient.tsx',
  import.meta.url
)
const SEO_CONTENT_PATH = new URL('../../content/seo-pages.ts', import.meta.url)

test('homepage positioning promises prioritisation rather than expected cash return', async () => {
  const source = await readFile(HOME_PAGE_PATH, 'utf8')

  assert.match(source, /Know which overdue customer to chase first/)
  assert.match(source, /overdue exposure, urgency, changes from each customer(?:&apos;|')s normal payment\s+pattern and payment recency/)
  assert.doesNotMatch(source, /cash per effort/i)
  assert.doesNotMatch(source, /highest-return/i)
  assert.doesNotMatch(source, /expected to return the most cash/i)
})

test('pricing advertises only product capabilities evidenced in the released app', async () => {
  const source = await readFile(PRICING_CLIENT_PATH, 'utf8')

  assert.match(source, /Overdue action queue with priority scoring/)
  assert.match(source, /Score-based priority prompts and reason visibility/)
  assert.match(source, /Xero sync and canonical data mapping/)
  assert.doesNotMatch(source, /Collections performance trend reports/)
  assert.doesNotMatch(source, /Team workflows and role-based access/)
  assert.doesNotMatch(source, /Advanced exports and API access/)
  assert.doesNotMatch(source, /Priority support and onboarding/)
})

test('scoring UI presents threshold outputs as prompts and keeps treatment with the user', async () => {
  const source = await readFile(ACTIONS_CLIENT_PATH, 'utf8')

  assert.match(source, /Score-based prompts indicate review urgency/)
  assert.match(source, /you decide the appropriate contact or treatment/)
  assert.match(source, />Score-based prompt</)
  assert.doesNotMatch(source, /Call immediately/)
  assert.doesNotMatch(source, /Email reminder/)
})

test('targeted SEO product bridges do not claim prediction or free-text interpretation', async () => {
  const source = await readFile(SEO_CONTENT_PATH, 'utf8')

  assert.doesNotMatch(source, /human contact could change the near-term outcome/)
  assert.doesNotMatch(source, /The product brings those inputs into customer priority/)
  assert.match(source, /lets your chosen priority adjustment reflect that context/)
  assert.match(source, /uses current exposure, overdue age, deterioration from recent normal payment timing and payment recency/)
})
