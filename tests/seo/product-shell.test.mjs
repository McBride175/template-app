import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { JSDOM } from 'jsdom'
import { loadTypeScriptModule } from '../xero/test-helpers/ts-module-loader.mjs'

const nav = loadTypeScriptModule('app/components/shell/navigation.ts')
const Shell = loadTypeScriptModule('app/components/shell/ProductShell.tsx').default
const render = (props = {}, children = createElement('h1', null, 'Example workspace')) =>
  new JSDOM(renderToStaticMarkup(createElement(Shell, { pathname: '/dashboard', ...props }, children))).window.document

test('workspace presentation follows existing protected prefixes without capturing public journeys', () => {
  for (const path of ['/dashboard', '/customers', '/customers/example/history', '/disputes', '/account', '/settings/integrations', '/collections/actions', '/admin', '/xero/raw']) assert.equal(nav.isWorkspacePath(path), true, path)
  for (const path of ['/', '/pricing', '/blog', '/guides/example', '/contact', '/login', '/signup', '/start', '/start/result', '/reset-password', '/legal/privacy', '/dashboard-help']) assert.equal(nav.isWorkspacePath(path), false, path)
  assert.deepEqual(nav.workspaceLinks.map(x => [x.label, x.href]), [['Priorities','/dashboard'],['Customers','/customers'],['Disputes','/disputes']])
  assert.equal(nav.pageProvidesMain('/customers/example/history'), true)
  assert.equal(nav.pageProvidesMain('/customers'), false)
})

test('rail navigation has one active section, real destinations and named decorative branding', () => {
  for (const [pathname, href] of [['/dashboard','/dashboard'],['/collections/actions','/dashboard'],['/customers/example/history','/customers'],['/disputes','/disputes'],['/settings/integrations','/settings/integrations']]) {
    const document=render({ pathname }), rail=document.querySelector('aside')
    assert.equal(rail.querySelectorAll('[aria-current="page"]').length,1)
    assert.equal(rail.querySelector('[aria-current="page"]').getAttribute('href'),href)
    assert.equal(rail.querySelector('a[aria-label="Yuohme workspace"]').getAttribute('href'),'/dashboard')
    assert.equal(rail.querySelector('img').alt,'')
  }
})

test('mobile controls are connected to a closed native dialog and content has a skip target', () => {
  const document=render(), button=document.querySelector('button[aria-label="Open navigation"]')
  const dialog=document.getElementById(button.getAttribute('aria-controls'))
  assert.equal(dialog.tagName,'DIALOG')
  assert.equal(dialog.hasAttribute('open'),false)
  assert.equal(button.getAttribute('aria-expanded'),'false')
  assert.equal(document.getElementById(dialog.getAttribute('aria-labelledby')).textContent,'Navigation')
  assert.equal(document.querySelector('a[href="#workspace-content"]').textContent,'Skip to workspace')
  assert.equal(document.querySelector('#workspace-content').tagName,'MAIN')
  assert.equal(document.querySelector('#workspace-content').getAttribute('tabindex'),'-1')
})

test('legacy feature landmarks and loading/error states are composed without replacing feature content', () => {
  const document=render({ pageHasMain:true, sessionLoading:true, onSignOut:()=>{}, signOutError:'Example failure' },createElement('main',null,'Existing feature'))
  assert.equal(document.querySelectorAll('main').length,1)
  assert.equal(document.querySelector('#workspace-content').tagName,'DIV')
  assert.match(document.body.textContent,/Existing feature/)
  assert.match(document.body.textContent,/Checking account/)
  assert.equal(document.querySelector('aside button').disabled,true)
  assert.equal(document.querySelector('aside [role="alert"]').textContent,'Example failure')
})

test('application frame chooses product/public layouts without invoking route authorisation or moving children', () => {
  for (const pathname of ['/dashboard','/login','/start','/pricing','/customers']) {
    const Frame=loadTypeScriptModule('app/components/shell/ApplicationFrame.tsx',{mocks:{
      'next/navigation':{usePathname:()=>pathname},
      '../Nav':()=>createElement('nav',null,'Public navigation'),
      '../Footer':()=>createElement('footer',null,'Public footer'),
      './ProductWorkspace':({children})=>createElement('main',{'data-workspace':true},children),
    }}).default
    const document=new JSDOM(renderToStaticMarkup(createElement(Frame,null,createElement('p',null,'Existing page')))).window.document
    assert.equal(Boolean(document.querySelector('[data-workspace]')),nav.isWorkspacePath(pathname))
    assert.equal(Boolean(document.querySelector('footer')),!nav.isWorkspacePath(pathname))
    assert.match(document.body.textContent,/Existing page/)
  }
})

test('shared sign-out retains success hard redirect and failure feedback without redirecting', async () => {
  for (const failed of [false,true]) {
    const states=[];let index=0;let redirected=null
    const previous=globalThis.window
    globalThis.window={location:{replace:path=>{redirected=path}}}
    try {
      const hook=loadTypeScriptModule('app/components/useNavigationSession.ts',{mocks:{
        react:{useState:initial=>{const i=index++;states[i]=initial;return[initial,v=>{states[i]=v}]},useEffect:()=>{}},
        '@/lib/supabase':{supabase:{auth:{signOut:async()=>({error:failed?{message:'Example'}:null})}}},
      }}).default
      await hook().signOut()
      assert.equal(redirected,failed?null:'/login?status=signed_out')
      assert.equal(states[2],false)
      assert.equal(Boolean(states[3]),failed)
    } finally {globalThis.window=previous}
  }
})
