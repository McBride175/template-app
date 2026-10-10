import { test, expect } from '@playwright/test'
// Fictional controlled stories only; browser cannot contact real financial services.
test.beforeEach(async ({ context }) => {
  await context.route('**/*', route => new URL(route.request().url()).origin === 'http://127.0.0.1:6006' && ['GET','HEAD'].includes(route.request().method()) ? route.continue() : route.abort('blockedbyclient'))
})
const story = (name: string) => `/iframe.html?id=yuohme-customerworkspace--${name}&viewMode=story`
for (const width of [320,390,768,1440]) {
  test(`customer discovery and supplied amounts at ${width}px`, async ({ page }) => {
    await page.setViewportSize({width,height:844})
    const requests: string[]=[]
    page.on('request',r=>{if(new URL(r.url()).pathname.startsWith('/api/'))requests.push(r.url())})
    await page.goto(story('selected-customer'))
    const overview=page.getByRole('region',{name:'Customer financial overview'})
    await expect(overview.getByRole('heading',{name:'Northbridge Supplies'})).toBeVisible()
    await expect(overview.getByText('£6,842.50',{exact:true})).toBeVisible()
    await expect(overview.getByText('£14,120.00',{exact:true})).toBeVisible()
    await expect(page.getByRole('link',{name:'Back to Priorities'})).toHaveAttribute('href','/dashboard?tenantId=synthetic#collection-actions')
    await expect(overview.getByRole('link',{name:'View history'})).toHaveAttribute('href','/customers/synthetic-1/history?tenantId=synthetic')
    await page.getByRole('link',{name:'Promises',exact:true}).click()
    const commitments=page.getByRole('region',{name:'Customer promises'})
    await expect(commitments).toBeVisible()
    await commitments.getByRole('listitem').filter({hasText:'Invoice INV-1048'}).getByRole('link',{name:'Manage promise with invoice'}).click()
    await expect(page.getByRole('article',{name:'Invoice INV-1048'})).toBeVisible()
    if(width<1024){
      const toggle=page.getByRole('button',{name:/^Change customer/})
      await expect(page.getByRole('searchbox')).toBeHidden()
      await toggle.focus();await page.keyboard.press('Enter')
      await expect(toggle).toHaveAttribute('aria-expanded','true')
      const box=(await toggle.boundingBox())!;expect(box.height).toBeGreaterThanOrEqual(44)
    }
    await page.getByRole('searchbox',{name:'Find a customer'}).fill('cedar')
    const account=page.getByRole('button',{name:/^Cedar & Finch Studio/})
    await account.focus();await page.keyboard.press('Enter')
    await expect(overview.getByRole('heading',{name:'Cedar & Finch Studio'})).toBeVisible()
    await expect(overview.locator('p').filter({hasText:/^£2,140\.00$/})).toBeVisible()
    if(width<1024)await page.getByRole('button',{name:/^Change customer/}).click()
    await expect(page.getByRole('searchbox')).toHaveValue('cedar')
    await page.locator('summary').filter({hasText:'Sort & filters'}).click()
    await page.getByLabel('Sort',{exact:true}).selectOption('customer_name:asc')
    await page.getByLabel('Overdue only',{exact:true}).check()
    await expect(page.getByLabel('Sort',{exact:true})).toHaveValue('customer_name:asc')
    expect(requests).toEqual([])
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
  })
  test(`invoice promise controls, warnings and long financial values at ${width}px`, async ({ page }) => {
    await page.setViewportSize({width,height:844})
    await page.goto(story('selected-customer'))
    const invoice=page.getByRole('article',{name:'Invoice INV-1048'})
    await expect(invoice.getByRole('definition').filter({hasText:'£5,000.00'})).toBeVisible()
    await expect(invoice.getByText(/£1,000.00 promised by/)).toBeVisible()
    await invoice.getByRole('button',{name:'Edit promise',exact:true}).click()
    await expect(invoice.getByLabel('Promise amount (GBP)')).toBeFocused()
    await invoice.getByLabel('Promise amount (GBP)').fill('0')
    await expect(invoice.getByRole('button',{name:'Cancel promise',exact:true})).toBeVisible()
    await expect(invoice.getByLabel('Promised date')).toHaveCount(0)
    await invoice.getByRole('button',{name:'Cancel promise',exact:true}).click()
    await expect(invoice.getByText(/Promise cancelled/)).toBeVisible()
    await expect(invoice.getByRole('button',{name:'Edit promise',exact:true})).toHaveCount(0)
    const kept=page.getByRole('article',{name:'Invoice INV-1060'})
    await expect(kept.getByText(/Promise kept/)).toBeVisible()
    await expect(kept.getByRole('button',{name:'Edit promise',exact:true})).toHaveCount(0)
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
  })
  for(const [group, states] of [
    ['financial values', ['long-customer-name','large-amounts','multi-currency','no-overdue-to-chase']],
    ['loading and unavailable states', ['currency-unavailable','loading','empty','error','empty-invoices']],
    ['invoice and activity context', ['invoice-states','terminal-promises','activity-history']],
  ] as const) test(`${group} at ${width}px remain accessible without overflow`, async ({page})=>{
    await page.setViewportSize({width,height:844})
    for(const state of states){
      await page.goto(story(state));await expect(page.locator('main')).toBeVisible()
      if(state==='currency-unavailable')await expect(page.getByRole('status').filter({hasText:/Currency evidence/})).toBeVisible()
      if(state==='no-overdue-to-chase')await expect(page.getByText(/Outstanding debt may still remain/)).toBeVisible()
      if(state==='invoice-states')await expect(page.getByText(/Balance changed since/)).toBeVisible()
      if(state==='terminal-promises'){
        await expect(page.getByRole('button',{name:'Edit promise',exact:true})).toHaveCount(0)
        await expect(page.getByRole('region',{name:'Customer invoice workspace'}).getByText(/Promise outcome unclear/)).toBeVisible()
        await expect(page.getByRole('region',{name:'Customer invoice workspace'}).getByText(/Promise missed/)).toBeVisible()
      }
      if(state==='activity-history'){
        await expect(page.getByRole('list',{name:'Customer collection history'})).toBeVisible()
        await expect(page.getByRole('button',{name:'Delete',exact:true})).toHaveCount(1)
        await page.getByRole('button',{name:'Load more history'}).click()
        await expect(page.getByText('Synthetic pagination callback.')).toBeVisible()
      }
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),state).toBe(true)
    }

  })
}
