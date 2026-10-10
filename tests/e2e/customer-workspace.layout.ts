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
    if(width>=1024){
      const browser=(await page.getByRole('complementary',{name:'Find and select customers'}).boundingBox())!
      const account=(await overview.boundingBox())!
      expect(browser.x).toBeGreaterThanOrEqual(account.x+account.width)
    }else{
      const switcher=(await page.getByRole('button',{name:/^Change customer/}).boundingBox())!
      expect(switcher.y+switcher.height).toBeLessThanOrEqual((await overview.boundingBox())!.y)
    }
    await expect(overview.getByText('£6,842.50',{exact:true})).toBeVisible()
    await expect(overview.getByText('£14,120.00',{exact:true})).toBeVisible()
    await expect(page.getByRole('link',{name:'Back to Priorities'})).toHaveAttribute('href','/dashboard?tenantId=synthetic#collection-actions')
    await expect(overview.getByRole('link',{name:'View history'})).toHaveAttribute('href','/customers/synthetic-1/history?tenantId=synthetic')
    await page.getByRole('navigation',{name:'Customer views'}).getByRole('link',{name:'Promises',exact:true}).click()
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
    await expect(invoice.getByText('£5,000.00',{exact:true}).first()).toBeVisible()
    await invoice.getByRole('button',{name:'Manage invoice INV-1048',exact:true}).click()
    await expect(invoice.getByText(/Promise £1,000.00 by/)).toBeVisible()
    await invoice.locator('summary').filter({hasText:'Commitment details & note'}).click()
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
    await kept.getByRole('button',{name:'Manage invoice INV-1060',exact:true}).click()
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
        for(let index=0;index<4;index++)await page.getByRole('article',{name:`Invoice INV-HISTORY-${index}`,exact:true}).getByRole('button',{name:`Manage invoice INV-HISTORY-${index}`,exact:true}).click()
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

for (const width of [320,390,768,1440]) {
  test(`compact invoice density, disclosure and retained draft at ${width}px`, async ({page}) => {
    await page.setViewportSize({width,height:900})
    const requests: string[]=[]
    page.on('request',r=>{if(new URL(r.url()).pathname.startsWith('/api/'))requests.push(r.url())})
    await page.goto(story('invoice-density'))
    const ordinary=page.getByRole('article',{name:'Invoice INV-OPEN',exact:true})
    await expect(ordinary.getByText('£4,792.50',{exact:true}).first()).toBeVisible()
    expect((await ordinary.boundingBox())!.height).toBeLessThanOrEqual(80)
    await expect(ordinary.getByText('Open in accounting')).toHaveCount(0)
    await expect(ordinary.getByText('No dispute')).toHaveCount(0)
    await expect(ordinary.getByRole('button',{name:'Mark disputed',exact:true})).toBeHidden()
    const control=ordinary.getByRole('button',{name:'Manage invoice INV-OPEN',exact:true})
    const box=(await control.boundingBox())!;expect(box.height).toBeGreaterThanOrEqual(44);expect(box.width).toBeGreaterThanOrEqual(44)
    await control.focus();await page.keyboard.press('Enter')
    await expect(ordinary.getByRole('button',{name:'Mark disputed',exact:true})).toBeVisible()
    await expect(ordinary.getByRole('button',{name:'Record promise',exact:true})).toBeVisible()
    await ordinary.getByRole('button',{name:'Record promise',exact:true}).click()
    await ordinary.getByLabel('Promise amount (GBP)').fill('123.45')
    await ordinary.getByLabel('Promised date').fill('2026-10-20')
    await ordinary.getByLabel('Optional promise note').fill('Retained fictional draft')
    await ordinary.getByRole('button',{name:'Close invoice INV-OPEN',exact:true}).click()
    await expect(ordinary.getByLabel('Promise amount (GBP)')).toBeHidden()
    await ordinary.getByRole('button',{name:'Manage invoice INV-OPEN',exact:true}).click()
    await expect(ordinary.getByLabel('Promise amount (GBP)')).toHaveValue('123.45')
    await expect(ordinary.getByLabel('Optional promise note')).toHaveValue('Retained fictional draft')
    await ordinary.getByRole('button',{name:'Close invoice details',exact:true}).click()
    await expect(ordinary.getByRole('button',{name:'Manage invoice INV-OPEN',exact:true})).toBeFocused()
    await expect(page.getByRole('article',{name:'Invoice INV-REVIEW'}).getByText(/Balance changed since/)).toBeVisible()
    await expect(page.getByRole('article',{name:'Invoice INV-UNAVAILABLE'}).getByText('Unavailable in current accounting data')).toBeVisible()
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
    expect(requests).toEqual([])
    await page.goto(story('ten-invoices'))
    await expect(page.getByRole('article')).toHaveCount(10)
    const heights=await page.getByRole('article').evaluateAll(rows=>rows.map(row=>row.getBoundingClientRect().height))
    expect(heights.every(height=>height<=80)).toBe(true)
  })
}
