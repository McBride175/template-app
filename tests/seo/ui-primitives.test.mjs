import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { tsImport } from 'tsx/esm/api'
import { compile } from 'tailwindcss'

async function load(name, directory = 'ui/') {
  const loaded = await tsImport(`../../app/components/${directory}${name}.tsx`, import.meta.url)
  return loaded.default.default ?? loaded.default
}

async function recipe(name) {
  const loaded = await tsImport(`../../app/components/ui/${name}.ts`, import.meta.url)
  return loaded.default ?? loaded
}

const [Button, Input, Card, Badge, Alert, Textarea, Select, Checkbox, Field, Spinner, EmptyState, XeroConnectButton, AuthSocialButton] = await Promise.all(
  [...['Button', 'Input', 'Card', 'Badge', 'Alert', 'Textarea', 'Select', 'Checkbox', 'Field', 'Spinner', 'EmptyState'].map((name) => load(name)),
    load('XeroConnectButton', ''), load('AuthSocialButton', '')]
)
const { actionStyles } = await recipe('actionStyles')
const { fieldStyles } = await recipe('fieldStyles')
const render = (component, props, children = 'Example') => renderToStaticMarkup(createElement(component, props, children))
const classes = (html) => html.match(/class="([^"]*)"/)[1].replaceAll('&amp;', '&')

test('Button preserves native action semantics and shares appearance with real links', () => {
  const onClick = () => {}
  assert.equal(Button({ children: 'Save', onClick }).props.onClick, onClick)
  assert.match(render(Button, {}), /type="button"/)
  const html = render(Button, { type: 'submit', disabled: true, 'aria-describedby': 'help', name: 'save' })
  assert.match(html, /type="submit"/)
  assert.match(html, /disabled=""/)
  assert.match(html, /aria-describedby="help"/)
  assert.match(html, /name="save"/)

  for (const variant of ['primary', 'secondary', 'ghost', 'destructive']) {
    const button = render(Button, { variant })
    const anchor = render('a', { href: '/example', className: actionStyles({ variant }) })
    assert.equal(classes(button), classes(anchor))
    assert.match(anchor, /^<a href="\/example"/)
    assert.doesNotMatch(anchor, /role="button"/)
    assert.match(classes(button), /focus-visible:ring-focus/)
    assert.match(classes(button), /disabled:pointer-events-none/)
    assert.match(classes(button), /hover:bg-/)
    assert.match(classes(button), /active:bg-/)
  }
  assert.match(render(Button, { variant: 'destructive' }), /bg-action-destructive /)
  assert.doesNotMatch(render(Button, { variant: 'destructive' }), /bg-feedback-error/)
  assert.match(render(XeroConnectButton, {}), /href="\/api\/xero\/connect\?returnTo=%2Fdashboard"/)
  assert.equal(classes(render(XeroConnectButton, {})), actionStyles({ variant: 'secondary' }))
})

test('native fields share focus, invalid and disabled presentation without taking over validation', () => {
  const onChange = () => {}
  assert.equal(Input({ onChange }).props.onChange, onChange)
  const input = renderToStaticMarkup(createElement(Input, {
    id: 'email', name: 'email', type: 'email', required: true, disabled: true,
    'aria-invalid': true, 'aria-describedby': 'email-error', defaultValue: 'example@example.com',
  }))
  assert.match(input, /id="email"/)
  assert.match(input, /type="email"/)
  assert.match(input, /required=""/)
  assert.match(input, /disabled=""/)
  assert.match(input, /aria-invalid="true"/)
  assert.match(input, /aria-describedby="email-error"/)
  assert.match(input, /value="example@example.com"/)
  assert.equal(classes(input), fieldStyles())
  for (const control of [Select, Textarea]) {
    const markup = render(control, { disabled: true, required: true, 'aria-invalid': true, 'aria-describedby': 'help' }, null)
    assert.equal(classes(markup), classes(input))
    assert.match(markup, /aria-invalid="true"/)
    assert.match(markup, /aria-describedby="help"/)
    assert.match(markup, /disabled=""/)
    assert.match(markup, /required=""/)
    assert.equal(control({ onChange }).props.onChange, onChange)
    assert.match(classes(render(control, { className: 'px-5' }, null)), /px-5/)
  }
  assert.match(render(Textarea, { rows: 8, maxLength: 4000, defaultValue: 'Message' }, null), /rows="8".*maxLength="4000".*>Message<\/textarea>/)
  assert.match(render(Select, { defaultValue: 'two', name: 'choice' }, [
    createElement('option', { key: 'one', value: 'one' }, 'One'),
    createElement('option', { key: 'two', value: 'two' }, 'Two'),
  ]), /<option value="two" selected="">Two<\/option>/)
  assert.match(classes(input), /aria-invalid:focus:ring-feedback-error/)
  assert.match(classes(input), /focus:ring-focus/)
  assert.match(classes(input), /disabled:cursor-not-allowed/)
  assert.doesNotMatch(renderToStaticMarkup(createElement(Input)), /aria-invalid="true"/)
})

test('surface and feedback primitives preserve content and caller accessibility attributes', () => {
  assert.match(render(Card, { variant: 'subtle', 'aria-labelledby': 'heading' }), /bg-surface-subtle/)
  assert.match(render(Card, { 'aria-labelledby': 'heading' }), /aria-labelledby="heading"/)
  assert.match(render(Badge, { variant: 'warning', 'aria-label': 'Requires attention' }), /^<span /)
  assert.match(render(Badge, { variant: 'warning', 'aria-label': 'Requires attention' }), /aria-label="Requires attention"/)
  assert.doesNotMatch(render(Badge, {}), /role="(?:alert|status)"/)
  assert.match(render(Alert, { variant: 'error' }), /role="alert"/)
  for (const variant of ['info', 'success', 'warning']) {
    assert.match(render(Alert, { variant }), /role="status"/)
  }
  const feedback = render(Alert, { variant: 'error', role: 'status', 'aria-live': 'polite' }, createElement('p', null, 'Try again'))
  assert.match(feedback, /role="status"/)
  assert.match(feedback, /aria-live="polite"/)
  assert.match(feedback, /<p>Try again<\/p>/)
  assert.match(classes(feedback), /\[&_p\]:text-inherit/)
  const social = render(AuthSocialButton, { label: 'Continue', icon: 'Icon', disabled: true, 'aria-describedby': 'help' })
  assert.match(social, /disabled=""/)
  assert.match(social, /aria-describedby="help"/)
  assert.match(social, /Continue/)
})

test('caller overrides compose through the existing class merger', () => {
  const html = render(Button, { className: 'px-8 bg-surface text-text-muted', size: 'sm' })
  assert.match(classes(html), /px-8/)
  for (const overridden of ['px-3', 'bg-action-primary', 'text-on-action-primary']) {
    assert.ok(!classes(html).split(' ').includes(overridden))
  }
  assert.match(classes(html), /text-sm/)
  assert.match(classes(html), /text-text-muted/)
  assert.match(fieldStyles('rounded-surface px-5'), /rounded-surface/)
  assert.doesNotMatch(fieldStyles('rounded-surface px-5'), /rounded-control|\bpx-3\b/)
})

test('generic primitives depend on semantic roles, never legacy or raw palette colours', async () => {
  for (const name of ['Button.tsx', 'Input.tsx', 'Card.tsx', 'Badge.tsx', 'Alert.tsx', 'Textarea.tsx', 'Select.tsx', 'Checkbox.tsx', 'Field.tsx', 'Spinner.tsx', 'EmptyState.tsx', 'actionStyles.ts', 'fieldStyles.ts', 'feedbackStyles.ts', '../AuthSocialButton.tsx', '../XeroConnectButton.tsx']) {
    const source = await readFile(path.join('app/components/ui', name), 'utf8')
    assert.doesNotMatch(source, /(?:bg|text|border|ring)-(?:gray|neutral|blue|red|green|amber|sky)-\d+|(?:bg|text|border|ring)-(?:white|black)\b|\[#|--(?:gray|font-size|line-height|letter-spacing)-/)
    assert.doesNotMatch(source, /createContext|useContext|useState|useEffect|localStorage/)
    if (!name.startsWith('../')) {
      assert.doesNotMatch(source, /overdue|dispute|xero|billing|collections|onboarding/i)
    }
  }
})

test('Checkbox keeps browser semantics, caller state, labels and keyboard focus', () => {
  const onChange = () => {}
  assert.equal(Checkbox({ onChange }).props.onChange, onChange)
  // The element type is fixed even for a caller bypassing the TypeScript API.
  assert.equal(Checkbox({ type: 'radio' }).props.type, 'checkbox')
  const html = renderToStaticMarkup(createElement(Checkbox, {
    id: 'consent', name: 'consent', defaultChecked: true, disabled: true, 'aria-label': 'Consent',
  }))
  assert.match(html, /type="checkbox"/)
  assert.match(html, /checked=""/)
  assert.match(html, /disabled=""/)
  assert.match(html, /aria-label="Consent"/)
  assert.doesNotMatch(html, /tabindex="-1"|role="checkbox"/)
  assert.match(classes(html), /focus-visible:ring-focus/)
  assert.doesNotMatch(renderToStaticMarkup(createElement(Checkbox, { defaultChecked: false })), /checked=""/)
})

test('Field associates label, hint, error and external descriptions with its native control', () => {
  const html = render(Field, {
    id: 'email', label: 'Email', required: true, hint: 'Work address', error: 'Check your email', describedBy: 'form-help',
  }, (props) => createElement(Input, { ...props, type: 'email' }))
  assert.match(html, /<label for="email"/)
  assert.match(html, /id="email"/)
  assert.match(html, /required=""/)
  assert.match(html, /aria-invalid="true"/)
  assert.match(html, /aria-describedby="form-help email-hint email-error"/)
  assert.match(html, /id="email-hint"/)
  assert.match(html, /id="email-error"/)
  const simple = render(Field, { id: 'message', label: 'Message' }, (props) => createElement(Textarea, props))
  assert.match(simple, /<textarea[^>]+id="message"/)
  assert.doesNotMatch(simple, /aria-invalid="|aria-describedby="|id="message-(?:hint|error)"|required=""/)
  assert.doesNotMatch(html, /role="alert"/)
})

test('Spinner announces loading or stays decorative and honours reduced motion', () => {
  const named = render(Spinner, { label: 'Saving changes' }, null)
  assert.match(named, /role="status"/)
  assert.match(named, /Saving changes/)
  assert.match(named, /<svg[^>]+aria-hidden="true"[^>]+focusable="false"/)
  assert.match(named, /motion-reduce:animate-none/)
  const decorative = render(Spinner, { label: null }, null)
  assert.match(decorative, /^<span aria-hidden="true"/)
  assert.doesNotMatch(decorative, /role="status"|sr-only/)
})

test('EmptyState accepts feature content and real actions without domain variants or live announcements', () => {
  const html = render(EmptyState, { title: 'Nothing here', description: 'Try adding an item', 'aria-labelledby': 'empty-title' },
    createElement('a', { href: '/example' }, 'Add an item'))
  assert.match(html, /Nothing here/)
  assert.match(html, /Try adding an item/)
  assert.match(html, /href="\/example"/)
  assert.doesNotMatch(html, /role="(?:alert|status)"/)
  assert.match(render(EmptyState, { title: createElement('span', { id: 'empty-title' }, 'Empty') }, null), /id="empty-title"/)
})

test('Tailwind compiles every shared recipe including focus and invalid states', async () => {
  const require = createRequire(import.meta.url)
  const base = path.resolve('app')
  const compiler = await compile(await readFile('app/globals.css', 'utf8'), {
    base,
    loadStylesheet: async (id, directory) => {
      const file = id === 'tailwindcss' ? require.resolve('tailwindcss/index.css') : path.resolve(directory, id)
      return { path: file, base: path.dirname(file), content: await readFile(file, 'utf8') }
    },
  })
  const html = [
    ...['primary', 'secondary', 'ghost', 'destructive'].map((variant) => render(Button, { variant })),
    renderToStaticMarkup(createElement(Input)), render(Card, {}), render(Card, { variant: 'subtle' }),
    render(Textarea, {}, null), render(Select, {}, null), renderToStaticMarkup(createElement(Checkbox)), render(Spinner, {}, null),
    render(Field, { id: 'example', label: 'Example', hint: 'Hint', error: 'Error' }, (props) => createElement(Input, props)),
    render(EmptyState, { title: 'Empty', description: 'Description' }, createElement('a', { href: '/' }, 'Go')),
    ...['neutral', 'info', 'success', 'warning', 'error'].map((variant) => render(Badge, { variant })),
    ...['info', 'success', 'warning', 'error'].map((variant) => render(Alert, { variant })),
  ]
  const candidates = [...new Set(html.flatMap((markup) => [...markup.matchAll(/class="([^"]*)"/g)]
    .flatMap((match) => match[1].replaceAll('&amp;', '&').split(' '))))]
  const css = compiler.build(candidates)
  for (const candidate of candidates) {
    const escaped = candidate.replace(/[^a-zA-Z0-9_-]/g, (character) => `\\${character}`)
    assert.ok(css.includes(`.${escaped} {`), `unrecognised primitive utility: ${candidate}`)
  }
  assert.match(css, /\[aria-invalid="true"\]/)
  assert.match(css, /var\(--brand-primary-600\)/)
  assert.match(css, /var\(--feedback-error-800\)/)
})
