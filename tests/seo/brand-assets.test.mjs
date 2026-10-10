import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import test from 'node:test'
import React, { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { JSDOM } from 'jsdom'
import { tsImport } from 'tsx/esm/api'
import { loadTypeScriptModule } from '../xero/test-helpers/ts-module-loader.mjs'

const imported = await tsImport('../../app/components/ui/Logo.tsx', import.meta.url)
const Logo = imported.default.default ?? imported.default
const dom = html => new JSDOM(html).window.document
const render = props => dom(renderToStaticMarkup(createElement(Logo, props)))
const variants = [
  [{}, 'logo-horizontal.svg'],
  [{ variant: 'stacked' }, 'logo-stacked.svg'],
  [{ colour: 'monochrome' }, 'logo-horizontal-monochrome.svg'],
  [{ variant: 'stacked', colour: 'monochrome' }, 'logo-stacked-monochrome.svg'],
  [{ colour: 'white' }, 'logo-horizontal-white.svg'],
  [{ variant: 'stacked', colour: 'white' }, 'logo-stacked-white.svg'],
  [{ variant: 'square' }, 'logo-square.svg'],
  [{ variant: 'micro' }, 'mark-yo.svg'],
]

test('Logo resolves every semantic variant to an existing canonical SVG and preserves its ratio', async () => {
  for (const [props, name] of variants) {
    const image = render(props).querySelector('img')
    assert.equal(image.getAttribute('src'), `/brand/${name}`)
    const svg = await readFile(new URL(`../../public/brand/${name}`, import.meta.url), 'utf8')
    const [, , width, height] = svg.match(/viewBox="([^"]+)"/)[1].split(' ').map(Number)
    assert.ok(Math.abs(parseFloat(image.style.width) / parseFloat(image.style.height) - width / height) < 1e-8)
    assert.ok(Number(image.getAttribute('width')) > 0 && Number(image.getAttribute('height')) > 0)
    assert.equal(image.getAttribute('alt'), 'Yuohme')
    assert.ok(!image.getAttribute('src').includes('_next/image'))
  }
})

test('Logo supports explicit naming and decorative placement inside an already named link', () => {
  assert.equal(render({ label: 'Yuohme brand' }).querySelector('img').alt, 'Yuohme brand')
  const decorative = render({ decorative: true })
  assert.equal(decorative.querySelector('img').alt, '')
  assert.equal(decorative.querySelector('span').getAttribute('aria-hidden'), 'true')
  for (const width of [0, -1, Infinity, NaN]) assert.throws(() => render({ width }), RangeError)
})

test('H3 reserves the entire descender and the usage guide clear space before the image loads', () => {
  const document = render({ width: 160 })
  const image = document.querySelector('img');const box = document.querySelector('span')
  const scale = 160 / 292
  assert.ok(259.704 * scale >= 140, 'Default H3 stays above the inspected minimum ink width')
  const top = parseFloat(box.style.paddingTop) + 9.01 * scale
  const bottom = parseFloat(box.style.paddingBottom) + (90 - 78.44) * scale
  assert.ok(Math.abs(top - 39.9 * scale) < 1e-8)
  assert.ok(Math.abs(bottom - 39.9 * scale) < 1e-8)
  const fullHeight = parseFloat(box.style.paddingTop) + parseFloat(image.style.height) + parseFloat(box.style.paddingBottom)
  assert.ok(fullHeight > 80 && fullHeight < 83)
  assert.ok(!box.className.includes('overflow-hidden'))
})

function surface(name, pathname, user) {
  const states = name === 'Nav' ? [false, user, false, null] : [user]
  let state = 0
  const loaded = loadTypeScriptModule(`app/components/${name}.tsx`, { mocks: {
    react: { ...React, useState: () => [states[state++], () => {}], useEffect: () => {} },
    'next/navigation': { usePathname: () => pathname },
    '@/lib/supabase': { supabase: {} },
  } })
  return dom(renderToStaticMarkup(createElement(loaded.default)))
}

test('navigation preserves signed-out and signed-in destinations and sign-out control', () => {
  const publicNav = surface('Nav', '/', null)
  const publicLinks = [...publicNav.querySelectorAll('a')].map(a => a.getAttribute('href'))
  assert.deepEqual(publicLinks, ['/', '/', '/pricing', '/blog', '/contact', '/login', '/start'])
  assert.equal(publicNav.querySelector('a[aria-label="Yuohme home"] img').alt, '')
  const signedIn = surface('Nav', '/', { email: 'preview@example.invalid' })
  assert.deepEqual([...signedIn.querySelectorAll('a')].map(a => a.getAttribute('href')),
    ['/', '/', '/pricing', '/dashboard', '/customers', '/disputes', '/account', '/blog', '/contact'])
  assert.equal(signedIn.querySelector('button').textContent, 'Sign out')
  const start = surface('Nav', '/start/result', null)
  assert.ok(start.querySelector('header img[src="/brand/logo-horizontal.svg"]'))
  assert.equal(start.querySelector('nav'), null)
  assert.equal(start.querySelector('button'), null)
})

test('footer keeps existing links and remains absent during start/onboarding', () => {
  assert.equal(surface('Footer', '/start', null).querySelector('footer'), null)
  const footer = surface('Footer', '/', { email: 'preview@example.invalid' })
  assert.deepEqual([...footer.querySelectorAll('a')].map(a => a.getAttribute('href')),
    ['/', '/', '/pricing', '/blog', '/contact', '/legal/terms', '/legal/privacy', '/legal/cookies', '/sitemap', '/account'])
})

test('active filesystem favicon is the approved ICO and metadata does not declare a conflicting favicon', async () => {
  const active = await readFile(new URL('../../app/favicon.ico', import.meta.url))
  const approved = await readFile(new URL('../../public/brand/icons/favicon-yo.ico', import.meta.url))
  assert.equal(createHash('sha256').update(active).digest('hex'), createHash('sha256').update(approved).digest('hex'))
  const layout = await readFile(new URL('../../app/layout.tsx', import.meta.url), 'utf8')
  assert.match(layout, /apple: \[\{ url: '\/brand\/icons\/logo-square-180\.png'/)
  assert.doesNotMatch(layout, /(?:shortcut|icon):\s*(?:\[|['"])/)
  assert.doesNotMatch(layout, /images:\s*.*logo-square/)
})
