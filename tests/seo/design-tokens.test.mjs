import assert from 'node:assert/strict'
import { access, readFile, readdir } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import test from 'node:test'
import { compile } from 'tailwindcss'

const require = createRequire(import.meta.url)
const appDirectory = path.join(process.cwd(), 'app')
const globals = await readFile(path.join(appDirectory, 'globals.css'), 'utf8')
const tokens = await readFile(path.join(appDirectory, 'theme.css'), 'utf8')

async function compileTheme(candidates, tokenSource = tokens, entrySource = globals) {
  const compiler = await compile(entrySource, {
    base: appDirectory,
    loadStylesheet: async (id, base) => {
      const resolved = id === 'tailwindcss'
        ? require.resolve('tailwindcss/index.css')
        : path.resolve(base, id)

      return {
        path: resolved,
        base: path.dirname(resolved),
        content: resolved === path.join(appDirectory, 'theme.css')
          ? tokenSource
          : await readFile(resolved, 'utf8'),
      }
    },
  })

  return compiler.build(candidates)
}

function declarations(block) {
  return Object.fromEntries(
    [...block.matchAll(/^[ \t]*([\w-]+):\s*([^;]+);/gm)]
      .map((match) => [match[1], match[2].trim()])
  )
}

function rootValues(css) {
  return Object.assign({}, ...[...css.matchAll(/:root(?:,\s*:host)?\s*\{([^}]+)\}/g)]
    .map((match) => declarations(match[1])))
}

function resolveValue(value, variables, visiting = []) {
  return value.replace(/var\((--[\w-]+)\)/g, (_, name) => {
    assert.ok(!visiting.includes(name), `cyclic token: ${[...visiting, name].join(' -> ')}`)
    assert.ok(Object.hasOwn(variables, name), `missing emitted token: ${name}`)
    return resolveValue(variables[name], variables, [...visiting, name])
  })
}

function ruleValues(css, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const matches = [...css.matchAll(new RegExp(`${escaped} \\{([^}]+)\\}`, 'g'))]
  assert.ok(matches.length, `missing compiled rule: ${selector}`)
  return declarations(matches.at(-1)[1])
}

function resolvedRuleValue(css, selector, property) {
  const value = ruleValues(css, selector)[property]
  assert.ok(value, `missing ${property} in ${selector}`)
  return resolveValue(value, rootValues(css))
}

function changeTokens(values) {
  return Object.entries(values).reduce((source, [name, value]) => {
    const declaration = new RegExp(`(^\\s*${name}:\\s*)[^;]+;`, 'm')
    assert.match(source, declaration, `missing editable token: ${name}`)
    return source.replace(declaration, (_, prefix) => `${prefix}${value};`)
  }, tokens)
}

test('Tailwind emits semantic colours, their interaction variants and role radii', async () => {
  const roles = {
    'bg-page': 'background-color',
    'bg-surface': 'background-color',
    'bg-surface-subtle': 'background-color',
    'bg-surface-inverse': 'background-color',
    'text-text-primary': 'color',
    'text-text-secondary': 'color',
    'text-text-muted': 'color',
    'text-text-inverse': 'color',
    'border-border-default': 'border-color',
    'border-border-strong': 'border-color',
    'text-link': 'color',
    'bg-action-primary': 'background-color',
    'text-on-action-primary': 'color',
    'bg-action-secondary': 'background-color',
    'text-on-action-secondary': 'color',
    'bg-action-destructive': 'background-color',
    'text-on-action-destructive': 'color',
    'bg-selected': 'background-color',
    'text-on-selected': 'color',
    'rounded-control': 'border-radius',
    'rounded-surface': 'border-radius',
    'rounded-surface-large': 'border-radius',
  }

  for (const role of ['success', 'warning', 'error', 'info']) {
    roles[`text-feedback-${role}`] = 'color'
    roles[`bg-feedback-${role}-surface`] = 'background-color'
    roles[`border-feedback-${role}-border`] = 'border-color'
  }

  const css = await compileTheme([
    ...Object.keys(roles),
    'hover:bg-action-primary-hover',
    'active:bg-action-primary-active',
    'hover:bg-action-secondary-hover',
    'hover:bg-action-destructive-hover',
    'focus-visible:ring-focus',
    'bg-surface/80',
  ])

  for (const [utility, property] of Object.entries(roles)) {
    resolvedRuleValue(css, `.${utility}`, property)
  }
  for (const selector of [
    '.hover\\:bg-action-primary-hover',
    '.active\\:bg-action-primary-active',
    '.hover\\:bg-action-secondary-hover',
    '.hover\\:bg-action-destructive-hover',
    '.focus-visible\\:ring-focus',
    '.bg-surface\\/80',
  ]) {
    assert.ok(css.includes(`${selector} {`), `missing variant: ${selector}`)
  }
})

test('foundation edits propagate to semantic utilities and base CSS', async () => {
  const changed = changeTokens({
    '--brand-primary-600': '#123456',
    '--brand-primary-700': '#234567',
    '--neutral-100': '#abcdef',
    '--radius-xl': '0.875rem',
  })
  const css = await compileTheme(['text-link', 'bg-surface-subtle', 'bg-action-primary', 'rounded-control'], changed)

  assert.equal(resolvedRuleValue(css, '.text-link', 'color'), '#234567')
  assert.equal(resolvedRuleValue(css, 'a', 'color'), '#234567')
  assert.equal(resolvedRuleValue(css, '.bg-surface-subtle', 'background-color'), '#abcdef')
  assert.equal(resolvedRuleValue(css, '.bg-action-primary', 'background-color'), '#123456')
  assert.equal(resolvedRuleValue(css, '.rounded-control', 'border-radius'), '0.875rem')
  assert.equal(resolvedRuleValue(css, 'button', 'border-radius'), '0.875rem')
})

test('semantic action mappings can change without changing utility names', async () => {
  const changed = changeTokens({
    '--color-action-primary': 'var(--feedback-error-600)',
    '--feedback-error-600': '#345678',
  })
  const css = await compileTheme(['bg-action-primary', 'bg-action-destructive'], changed)

  assert.equal(resolvedRuleValue(css, '.bg-action-primary', 'background-color'), '#345678')
  assert.equal(resolvedRuleValue(css, '.bg-action-destructive', 'background-color'), '#345678')
})

test('native typography tokens drive utilities and base elements', async () => {
  const changed = changeTokens({
    '--text-base': '1.0625rem',
    '--text-3xl': '2rem',
    '--leading-normal': '1.6',
    '--tracking-tight': '-0.02em',
    '--font-weight-semibold': '650',
    '--font-family-interface': '"Example Font", sans-serif',
  })
  const css = await compileTheme(['text-base', 'text-3xl', 'leading-normal', 'tracking-tight', 'font-semibold', 'font-sans'], changed)

  assert.equal(resolvedRuleValue(css, '.text-base', 'font-size'), '1.0625rem')
  assert.equal(resolvedRuleValue(css, 'body', 'font-size'), '1.0625rem')
  assert.equal(resolvedRuleValue(css, '.text-3xl', 'font-size'), '2rem')
  assert.equal(resolvedRuleValue(css, 'h1', 'font-size'), '2rem')
  assert.equal(resolvedRuleValue(css, '.leading-normal', 'line-height'), '1.6')
  assert.equal(resolvedRuleValue(css, 'body', 'line-height'), '1.6')
  assert.equal(resolvedRuleValue(css, '.tracking-tight', 'letter-spacing'), '-0.02em')
  assert.equal(resolvedRuleValue(css, 'h1', 'letter-spacing'), '-0.02em')
  assert.equal(resolvedRuleValue(css, '.font-semibold', 'font-weight'), '650')
  assert.equal(resolvedRuleValue(css, 'h1', 'font-weight'), '650')
  assert.equal(resolvedRuleValue(css, '.font-sans', 'font-family'), '"Example Font", sans-serif')
  assert.ok(resolvedRuleValue(css, 'body', 'font-family').startsWith('"Example Font", sans-serif'))
})

test('surface shape, shadow and motion are centrally changeable', async () => {
  const changed = changeTokens({
    '--radius-md': '0.5rem',
    '--shadow-sm': '0 2px 8px 0 rgb(0 0 0 / 0.12)',
    '--default-transition-duration': '200ms',
    '--default-transition-timing-function': 'linear',
  })
  const css = await compileTheme(['rounded-surface', 'shadow-sm', 'transition-colors'], changed)

  assert.equal(resolvedRuleValue(css, '.rounded-surface', 'border-radius'), '0.5rem')
  assert.match(resolvedRuleValue(css, '.shadow-sm', '--tw-shadow'), /0 2px 8px 0/)
  assert.equal(resolvedRuleValue(css, '.transition-colors', 'transition-duration'), 'var(--tw-duration, 200ms)')
  assert.equal(resolvedRuleValue(css, '.transition-colors', 'transition-timing-function'), 'var(--tw-ease, linear)')
})

test('standard gray utilities retain framework meanings independently of brand tokens', async () => {
  const candidates = ['bg-gray-50', 'border-gray-200', 'text-gray-900', 'hover:bg-gray-50']
  const framework = await compileTheme(candidates, tokens, '@import "tailwindcss";')
  const changed = changeTokens({
    '--neutral-50': '#abcdef',
    '--neutral-200': '#123456',
    '--neutral-900': '#234567',
    '--brand-primary-600': '#345678',
  })
  const css = await compileTheme(candidates, changed)

  for (const [selector, property] of [
    ['.bg-gray-50', 'background-color'],
    ['.border-gray-200', 'border-color'],
    ['.text-gray-900', 'color'],
    ['.hover\\:bg-gray-50', 'background-color'],
  ]) {
    assert.equal(resolvedRuleValue(css, selector, property), resolvedRuleValue(framework, selector, property))
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    assert.equal([...css.matchAll(new RegExp(`${escaped} \\{`, 'g'))].length, 1, `duplicate utility definition: ${selector}`)
  }
})

test('theme.css owns the theme without legacy aliases or a separate palette for controls', async () => {
  await assert.rejects(access(path.join(appDirectory, 'tokens.css')), { code: 'ENOENT' })
  const files = await readdir(appDirectory, { recursive: true })
  const sources = await Promise.all(files.filter((file) => /\.(css|tsx|ts)$/.test(file))
    .map(async (file) => ({ file, contents: await readFile(path.join(appDirectory, file), 'utf8') })))
  const themeSources = sources.filter((source) => /@theme\b/.test(source.contents))
  assert.deepEqual(themeSources.map((source) => source.file), ['theme.css'])

  const legacyName = /--(?:gray-\d+|accent-sky-\d+|neutral-ui-\d+|font-geist-[\w-]+|font-size-[\w-]+|line-height-[\w-]+|letter-spacing-[\w-]+|radius-button\b|background\b|foreground\b)/
  for (const source of sources) {
    assert.doesNotMatch(source.contents, legacyName, `obsolete styling variable in ${source.file}`)
    assert.doesNotMatch(source.contents, /tokens\.css/, `obsolete theme reference in ${source.file}`)
    assert.doesNotMatch(source.contents, /@\/app\/components\/(?:Button|Input|Card|Badge|Alert|actionStyles|fieldStyles|feedbackStyles)['"]/, `noncanonical UI import in ${source.file}`)
  }
  assert.doesNotMatch(tokens, /--color-(?:gray-\d+|background|foreground)\s*:/)
  assert.doesNotMatch(globals, /\.(?:bg|border|text)-gray-\d+\b/)

  const semanticColours = [...tokens.matchAll(/--color-[\w-]+:\s*([^;]+);/g)]
  assert.ok(semanticColours.length > 0)
  for (const [, value] of semanticColours) {
    assert.match(value, /^var\(--(?:brand-primary|neutral|feedback)-[\w-]+\)$/)
  }
})
