import { test, expect } from '@playwright/test'

// Fictional component evidence only: no auth/session/financial API or writes.
test.beforeEach(async ({ context }) => {
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url())
    if (url.origin === 'http://127.0.0.1:6006' && ['GET', 'HEAD'].includes(request.method())) await route.continue()
    else await route.abort('blockedbyclient')
  })
})
const story = (name: string) => `/iframe.html?id=yuohme-collectionqueue--${name}&viewMode=story`
for (const width of [320,390,768,1440]) test(`invoice context at ${width}px supports the conversation and keeps actions usable`, async ({page}) => {
  await page.setViewportSize({width,height:844})
  await page.goto(story('priority-invoices'))
  const section=page.getByRole('region',{name:'Invoices requiring attention'})
  await expect(page.getByRole('heading',{name:'Northbridge Supplies'})).toBeVisible()
  await expect(page.getByRole('article').getByText('£6,842.50',{exact:true})).toBeVisible()
  const toggle=section.getByRole('button',{name:/Invoices requiring attention/})
  await expect(toggle).toHaveAttribute('aria-expanded',width<640?'false':'true')
  if(width<640){
    const first=page.getByRole('button',{name:'No response',exact:true})
    expect((await first.boundingBox())!.y).toBeLessThan(740)
    await toggle.focus();await page.keyboard.press('Enter')
  }
  await expect(section.getByRole('listitem')).toHaveCount(2)
  await expect(section.getByText('INV-1048',{exact:true})).toBeVisible()
  await expect(section).toContainText('£750.00 currently covered')
  const link=section.getByRole('link',{name:'View all invoices'})
  const href=new URL((await link.getAttribute('href'))!,'http://localhost')
  expect(href.hash).toBe('#customer-invoices')
  expect(href.searchParams.get('customerSourceId')).toBe('synthetic-1')
  expect(href.searchParams.get('queueCustomerSourceId')).toBe('synthetic-1')
  for(const button of await page.getByRole('group',{name:'Record outcome',exact:true}).getByRole('button').all()){
    await expect(button).toBeEnabled();expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44)
  }
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
  await page.getByRole('button',{name:'Next',exact:true}).click()
  await expect(page.getByRole('heading',{name:'Cedar & Finch Studio'})).toBeVisible()
  await page.getByRole('button',{name:'Back to #1',exact:true}).click()
  await expect(page.getByRole('heading',{name:'Northbridge Supplies'})).toBeVisible()
})
test('three-row bound, coverage semantics and long exact multicurrency values',async({page})=>{
  await page.setViewportSize({width:320,height:844})
  for(const name of ['many-invoices','invoice-coverage','invoice-long-values']){
    await page.goto(story(name))
    const section=page.getByRole('region',{name:'Invoices requiring attention'})
    await section.getByRole('button',{name:/Invoices requiring attention/}).click()
    expect(await section.getByRole('listitem').count()).toBeLessThanOrEqual(3)
    if(name==='many-invoices')await expect(section).toContainText('first 3 of 6')
    if(name==='invoice-coverage'){
      await expect(section).toContainText('Full dispute · £5,000.00 disputed')
      await expect(section).toContainText('£5,000.00 currently covered')
    }
    if(name==='invoice-long-values')await expect(section).toContainText('$9,999,999,999,999,999.99')
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
  }
})
test('loading/error/empty/unavailable preserve actions and material warnings outside disclosure',async({page})=>{
  await page.setViewportSize({width:390,height:844})
  for(const name of ['invoice-loading','invoice-error','no-overdue-invoices','invoice-unavailable']){
    await page.goto(story(name))
    const section=page.getByRole('region',{name:'Invoices requiring attention'})
    await expect(page.getByRole('button',{name:'No response',exact:true})).toBeEnabled()
    if(name==='invoice-loading')await expect(section.getByText('Loading invoice context…')).toBeVisible()
    if(name==='invoice-error'){
      await expect(section.getByRole('alert')).toBeVisible()
      await section.getByRole('button',{name:'Retry invoices'}).click()
      await expect(page.getByTestId('preview-event')).toContainText('invoice retry')
    }
    if(name==='invoice-unavailable'){
      await expect(section.getByText(/unavailable accounting/)).toBeVisible()
      await expect(section.getByText(/dispute balance.*need review/)).toBeVisible()
    }
    await section.getByRole('button',{name:/Invoices requiring attention/}).click()
    if(name==='no-overdue-invoices')await expect(section).toContainText('Other debt or commitments may remain')
  }
})
