import { test, expect } from '@playwright/test'

// Real production component in Storybook with declared fictional props.
// This does not simulate a Supabase session or certify authenticated pages.
test.beforeEach(async ({ context }) => {
  await context.route('**/*', async route => {
    const r=route.request(),u=new URL(r.url())
    if(u.origin==='http://127.0.0.1:6006'&&['GET','HEAD'].includes(r.method()))await route.continue()
    else await route.abort('blockedbyclient')
  })
})

const story='/iframe.html?id=yuohme-productshell--desktop-priorities&viewMode=story'

test('desktop rail preserves active links, wide content and single main landmark', async ({ page }) => {
  await page.setViewportSize({width:1440,height:900})
  await page.goto(story)
  const rail=page.getByRole('complementary',{name:'Workspace navigation'})
  await expect(rail).toBeVisible()
  await expect(rail.getByRole('link',{name:'Priorities',exact:true})).toHaveAttribute('aria-current','page')
  await expect(rail.getByRole('link',{name:'Customers',exact:true})).toHaveAttribute('href','/customers')
  await expect(page.getByRole('button',{name:'Open navigation'})).toBeHidden()
  await expect(page.getByRole('main')).toHaveCount(1)
  const sizes=await page.evaluate(()=>({rail:document.querySelector('aside')!.getBoundingClientRect().width,main:document.querySelector('main')!.getBoundingClientRect().width,overflow:document.documentElement.scrollWidth>innerWidth}))
  expect(sizes.rail).toBe(240)
  expect(sizes.main).toBeGreaterThan(1100)
  expect(sizes.overflow).toBe(false)
  await page.keyboard.press('Tab')
  await expect(page.getByRole('link',{name:'Skip to workspace'})).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.locator('#workspace-content')).toBeFocused()
})

for(const width of [320,390,768])test.describe(`touch viewport ${width}px`,()=>{
  test.use({hasTouch:true})
  test('full H3, compact closed chrome and accessible modal',async({page})=>{
  await page.setViewportSize({width,height:900})
  await page.goto(story)
  const open=page.getByRole('button',{name:'Open navigation'})
  await expect(open).toBeVisible()
  await expect(open).toHaveAttribute('aria-expanded','false')
  const h3=page.locator('header img[src="/brand/logo-horizontal.svg"]')
  await expect(h3).toBeVisible()
  const size=await h3.boundingBox();expect(size!.width).toBe(160)
  expect((await page.locator('header').boundingBox())!.height).toBeLessThan(85)
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
  await open.tap()
  const dialog=page.getByRole('dialog',{name:'Navigation'})
  await expect(dialog).toBeVisible()
  const close=dialog.getByRole('button',{name:'Close navigation'})
  await expect(close).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect(dialog.getByRole('button',{name:'Sign out',exact:true})).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(close).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(open).toBeFocused()
  await expect(open).toHaveAttribute('aria-expanded','false')
  await open.click()
  await dialog.getByRole('link',{name:'Customers',exact:true}).click({modifiers:['Control']})
  await expect(dialog).toBeVisible()
  await dialog.getByRole('link',{name:'Customers',exact:true}).click()
  await expect(dialog).toBeHidden()
  await expect(open).toBeFocused()
  })
})

test('desktop resize dismisses an open mobile menu and restores focus to the active rail link',async({page})=>{
  await page.setViewportSize({width:390,height:900});await page.goto(story)
  await page.getByRole('button',{name:'Open navigation'}).click()
  await expect(page.getByRole('dialog',{name:'Navigation'})).toBeVisible()
  await page.setViewportSize({width:1440,height:900})
  await expect(page.getByRole('dialog',{name:'Navigation'})).toBeHidden()
  await expect(page.getByRole('complementary',{name:'Workspace navigation'}).getByRole('link',{name:'Priorities',exact:true})).toBeFocused()
})

test('delayed logo images do not change closed mobile header dimensions',async({page})=>{
  await page.setViewportSize({width:390,height:900})
  let release!:()=>void
  const pending=new Promise<void>(resolve=>{release=resolve})
  await page.route('**/brand/*.svg',async route=>{await pending;await route.continue()})
  try {
    await page.goto(story,{waitUntil:'domcontentloaded'})
    await expect(page.getByRole('button',{name:'Open navigation'})).toBeVisible()
    await page.evaluate(()=>document.fonts.ready)
    const header=page.locator('header'),before=await header.boundingBox()
    const image=header.locator('img')
    expect(await image.evaluate((node:HTMLImageElement)=>node.complete)).toBe(false)
    release()
    await expect.poll(()=>image.evaluate((node:HTMLImageElement)=>node.complete&&node.naturalWidth>0)).toBe(true)
    expect(await header.boundingBox()).toEqual(before)
  } finally {release()}
})

test('browser history navigation dismisses the mobile menu even within the same route',async({page})=>{
  await page.setViewportSize({width:390,height:900});await page.goto(story)
  const open=page.getByRole('button',{name:'Open navigation'})
  await open.click()
  await expect(page.getByRole('dialog',{name:'Navigation'})).toBeVisible()
  await page.evaluate(()=>window.dispatchEvent(new PopStateEvent('popstate')))
  await expect(page.getByRole('dialog',{name:'Navigation'})).toBeHidden()
  await expect(open).toBeFocused()
})
