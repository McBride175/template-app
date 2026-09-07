import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'

const projectRoot = process.cwd()

async function readSourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const sources = []

  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name)

    if (entry.isDirectory()) {
      sources.push(...(await readSourceFiles(entryPath)))
    } else if (/\.(?:css|tsx)$/.test(entry.name)) {
      sources.push({
        path: path.relative(projectRoot, entryPath),
        contents: await readFile(entryPath, 'utf8'),
      })
    }
  }

  return sources
}

test('the light-only site does not apply pale dark-mode text to light surfaces', async () => {
  const css = await readFile(path.join(projectRoot, 'app/globals.css'), 'utf8')

  assert.match(css, /color-scheme:\s*light/)
  assert.doesNotMatch(css, /prefers-color-scheme:\s*dark/)

  const baseLayerStart = css.indexOf('@layer base')
  const utilityOverridesStart = css.indexOf('.bg-gray-50', baseLayerStart)
  const baseLayer = css.slice(baseLayerStart, utilityOverridesStart)

  assert.ok(baseLayerStart >= 0, 'global element defaults must live in the base layer')
  assert.ok(utilityOverridesStart > baseLayerStart, 'base layer must close before utility overrides')

  for (const selector of ['a', 'button', 'h1', 'h2', 'h3', 'p']) {
    assert.match(baseLayer, new RegExp(`\\n  ${selector} \\{`))
  }
})

test('shared muted and success text colors retain AA contrast on light surfaces', async () => {
  const sources = await readSourceFiles(path.join(projectRoot, 'app'))
  const violations = sources.flatMap((source) => {
    const matches = [
      ...source.contents.matchAll(/text-green-600|placeholder:text-gray-400/g),
    ]

    return matches.map((match) => `${source.path}:${match.index}:${match[0]}`)
  })

  assert.deepEqual(violations, [])
})
