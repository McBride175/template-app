import { readFileSync } from 'node:fs'

// Lossless sharing keeps full pre-refactor outputs reviewable without repeating
// the same summary/score explanations thousands of times. No values are rounded.
const golden = JSON.parse(readFileSync(new URL('../fixtures/collection-calculation-parity.json', import.meta.url), 'utf8'))
function expand(value) {
  if (value === null || typeof value !== 'object') return value
  if (Object.keys(value).length === 1 && Object.hasOwn(value, '$fixtureRef')) return expand(golden.values[value.$fixtureRef])
  return Array.isArray(value) ? value.map(expand) :
    Object.fromEntries(Object.entries(value).map(([key, child]) => [key, expand(child)]))
}
export const provenance = golden.provenance
export const expectedByName = new Map(golden.scenarios.map(({ name, expected }) => [name, expand(expected)]))
