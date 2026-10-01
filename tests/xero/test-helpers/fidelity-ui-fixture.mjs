import assert from 'node:assert/strict'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import * as jsx from 'react/jsx-runtime'
import { JSDOM } from 'jsdom'
import { loadTypeScriptModule } from './ts-module-loader.mjs'
import { TENANT_ID } from './disputes-journey-fixture.mjs'

const Link = ({ children, href, ...props }) => React.createElement('a', { href, ...props }, children)
const router = { replace() {}, push() {} }
const { default: ResultView } = loadTypeScriptModule('app/start/result/FirstValueResultView.tsx', {
  mocks: { react: React, 'react/jsx-runtime': jsx, 'next/link': Link },
})
export const resultText = data => {
  const dom = new JSDOM(renderToStaticMarkup(React.createElement(ResultView,
    { data, tenantId: TENANT_ID, organisationName: 'Fixture', lastSyncedAt: null })))
  const text = dom.window.document.body.textContent
  dom.window.close()
  return text
}

export function fidelityUI(app) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/', pretendToBeVisual: true })
  const keys = ['window','document','HTMLElement','MouseEvent','Event','CustomEvent','IS_REACT_ACT_ENVIRONMENT','fetch']
  const previous = Object.fromEntries(keys.map(key => [key, globalThis[key]]))
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement,
    MouseEvent: dom.window.MouseEvent, Event: dom.window.Event, CustomEvent: dom.window.CustomEvent, IS_REACT_ACT_ENVIRONMENT: true })
  let held = null
  let requests = 0
  globalThis.fetch = async url => {
    assert.ok(String(url).startsWith('/api/collections/actions?'))
    requests++
    const gate = held; held = null
    const result = await app.actions(new URL(String(url),'http://localhost').searchParams.toString())
    if (gate) { gate.captured(); await gate.wait }
    return new Response(JSON.stringify(result.body), { status: result.status })
  }
  const Card = ({ children }) => React.createElement('div', null, children)
  const Button = ({ children, variant, size, ...props }) => {
    void variant; void size
    return React.createElement('button', { type: 'button', ...props }, children)
  }
  const { default: Client } = loadTypeScriptModule('app/collections/actions/CollectionActionsClient.tsx', { mocks: {
    react: React, 'react/jsx-runtime': jsx, 'next/navigation': { useRouter: () => router }, 'next/link': Link,
    '@/app/components/ui/Card': Card, '@/app/components/ui/Button': Button,
    '@/app/collections/MultiCurrencyPlanGate': () => null, '@/app/dashboard/DashboardXeroConnectionCard': () => null,
    '@/app/collections/FounderContextControl': () => null,
  } })
  const container = document.getElementById('root'), root = createRoot(container)
  const settle = async () => { for(let n=0;n<4;n++) await new Promise(resolve=>setImmediate(resolve)) }
  const signal = () => window.dispatchEvent(new CustomEvent('yuohme:promise-actionability-changed', { detail: TENANT_ID }))
  return { container, requests: () => requests,
    render: () => act(async () => { root.render(React.createElement(Client, { tenantId: TENANT_ID,
      showQueue: true, showTable: true, showHeader: false, showFilters: false })); await settle() }),
    refresh: () => act(async () => { signal(); await settle() }),
    holdNext() {
      let release, captured
      const wait = new Promise(resolve => { release = resolve })
      const ready = new Promise(resolve => { captured = resolve })
      held = { wait, captured }
      return { start: () => act(async () => { signal(); await ready; await settle() }),
        release: () => act(async () => { release(); await settle() }) }
    },
    async expand(id) {
      const tr = [...container.querySelectorAll('tbody tr')].find(row=>row.textContent.includes(`${id} Ltd`))
      const button = [...tr.querySelectorAll('button')].find(b=>b.textContent==='View reason')
      if(button) await act(async()=>button.dispatchEvent(new MouseEvent('click',{bubbles:true})))
    },
    async cleanup() { await act(async()=>root.unmount()); dom.window.close(); Object.assign(globalThis,previous) },
  }
}
