import {test,expect} from '@playwright/test'
// Controlled presentation only. Financial writes stay in mocked-controller tests.
test.beforeEach(async({context})=>{await context.route('**/*',async route=>{const r=route.request();if(new URL(r.url()).origin==='http://127.0.0.1:6006'&&['GET','HEAD'].includes(r.method()))await route.continue();else await route.abort('blockedbyclient')})})
const story=(name:string)=>`/iframe.html?id=yuohme-disputes--${name}&viewMode=story`
for(const width of [320,390,768,1440])test(`compact disputes, filters, management and keyboard at ${width}px`,async({page},info)=>{
 await page.setViewportSize({width,height:900});await page.goto(story('active'))
 const list=page.getByRole('list',{name:'Disputes worklist'}),rows=list.getByRole('listitem');await expect(rows).toHaveCount(4)
 await expect(rows.first()).toContainText('Northbridge Supplies');await expect(rows.first()).toContainText('£5,000.00');await expect(rows.first()).toContainText('Effective disputed · GBP');await expect(rows.first()).not.toContainText('Open in accounting')
 const manage=rows.first().getByRole('button',{name:/Manage dispute/});expect((await manage.boundingBox())!.height).toBeGreaterThanOrEqual(44)
 const href=new URL((await rows.first().getByRole('link',{name:/View invoice/}).getAttribute('href'))!,'http://localhost');expect(href.searchParams.get('tenantId')).toBe('synthetic');expect(href.hash).toBe('#invoice-synthetic-invoice-1');expect(href.searchParams.get('disputesReturn')).toContain('/disputes?')
 expect((await rows.first().boundingBox())!.height).toBeLessThan(width<640?125:85)
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
 await info.attach(`disputes-${width}`,{body:await page.screenshot({fullPage:true}),contentType:'image/png'})
 await manage.focus();await page.keyboard.press('Enter');const dialog=page.getByRole('dialog');await expect(dialog).toBeVisible();await expect(dialog).toContainText('Effective disputed');await expect(dialog.getByRole('button',{name:'Edit dispute',exact:true})).toBeVisible();for(let i=0;i<6;i++){await page.keyboard.press('Tab');expect(await dialog.evaluate(el=>el.contains(document.activeElement))).toBe(true)}
 await page.keyboard.press('Escape');await expect(dialog).not.toBeVisible();await expect(manage).toBeFocused()
 const form=page.getByRole('form',{name:'Dispute filters'});if(width<640){await form.getByRole('button',{name:/Filters/}).click()}
 await form.getByLabel('Status',{exact:true}).selectOption('needs_review');if(width<640){await form.getByRole('button',{name:/Filters/}).click();await form.getByRole('button',{name:/Filters/}).click();await expect(form.getByLabel('Status',{exact:true})).toHaveValue('needs_review')}
 await form.getByRole('button',{name:/^Apply/}).click();await expect(rows).toHaveCount(1);await expect(rows.first()).toContainText('Balance changed')
 await rows.first().getByRole('button',{name:/Manage dispute/}).click();await expect(dialog.getByRole('button',{name:'Keep as is',exact:true})).toBeVisible()
 await info.attach(`review-${width}`,{body:await page.screenshot(),contentType:'image/png'})
})
for(const width of [390,1440])test(`measured before/after dispute density at ${width}px`,async({page},info)=>{
 await page.setViewportSize({width,height:900});await page.goto(story('earlier-presentation'));const before=page.locator('[data-before-dispute]').first();await expect(before).toBeVisible();const beforeHeight=(await before.boundingBox())!.height
 await info.attach(`before-${width}`,{body:await page.screenshot({fullPage:true}),contentType:'image/png'})
 await page.goto(story('active'));const after=page.getByRole('list',{name:'Disputes worklist'}).getByRole('listitem').first();await expect(after).toBeVisible();const afterHeight=(await after.boundingBox())!.height
 expect(afterHeight).toBeLessThan(beforeHeight*.5)
 await info.attach(`density-${width}`,{body:Buffer.from(JSON.stringify({width,beforeHeight,afterHeight,reductionPercent:100*(1-afterHeight/beforeHeight)})),contentType:'application/json'})
})
test('partial editor, resolved eligibility, unavailable warnings, notes and states remain accessible',async({page},info)=>{
 await page.setViewportSize({width:390,height:844})
 for(const name of ['partial-editor','review-management','resolved-management','unavailable-management']){
  await page.goto(story(name));const dialog=page.getByRole('dialog');await expect(dialog).toBeVisible()
  if(name==='partial-editor'){
   await dialog.getByLabel('Partial disputed amount (GBP)').fill('1100');await dialog.getByLabel('Optional note').fill('Updated details')
   await dialog.getByRole('button',{name:'Save dispute',exact:true}).click();await expect(dialog).toContainText('No request was made and no dispute was saved')
  }
  if(name==='review-management')await expect(dialog.getByRole('button',{name:'Keep as is',exact:true})).toBeVisible()
  if(name==='resolved-management'){await expect(dialog.getByRole('button',{name:'Reactivate dispute',exact:true})).toBeVisible();await expect(dialog.getByRole('button',{name:'Edit dispute',exact:true})).toHaveCount(0)}
  if(name==='unavailable-management'){await expect(dialog).toContainText('Current accounting values unavailable');await expect(dialog.getByRole('button',{name:'Resolve dispute'})).toBeVisible();await expect(dialog.getByRole('button',{name:'Edit dispute',exact:true})).toHaveCount(0)}
  expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true)
  await info.attach(name,{body:await page.screenshot(),contentType:'image/png'})
 }
 await page.goto(story('promise-and-dispute'));await page.getByRole('button',{name:/Manage dispute/}).click();const promiseDialog=page.getByRole('dialog');await promiseDialog.locator('summary').filter({hasText:'Invoice context'}).click();await expect(promiseDialog).toContainText('Promise coverage: £750.00');await expect(promiseDialog).toContainText('£3,050.00');await info.attach('promise-dispute-context',{body:await page.screenshot(),contentType:'image/png'})
 for(const name of ['long-values','mixed-currencies','all-states','loading','empty','error']){
  await page.goto(story(name));if(name==='loading')await expect(page.getByRole('status')).toContainText('Loading disputes');if(name==='error')await expect(page.getByRole('alert')).toBeVisible();if(name==='empty')await expect(page.getByText('No disputes match this view')).toBeVisible();if(name==='mixed-currencies'){await expect(page.getByRole('list')).toContainText('Base-currency equivalent unavailable');await expect(page.getByRole('list')).toContainText('USD')}if(name==='all-states')await expect(page.getByRole('list')).toContainText('Settled in accounting · dispute remains unresolved')
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
  await info.attach(name,{body:await page.screenshot({fullPage:true}),contentType:'image/png'})
 }
})
