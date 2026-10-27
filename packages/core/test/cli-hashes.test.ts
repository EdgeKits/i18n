import assert from 'node:assert/strict'
import test from 'node:test'

import { computeHash, diffHashes, purgeUrlsFor, stableStringify } from '../src/cli/hashes.ts'
import { LOCALE_TREE } from './fixtures/locales.ts'

test('stableStringify ignores key order', () => {
  assert.equal(
    stableStringify({ b: 1, a: { d: 2, c: [3, { f: 4, e: 5 }] } }),
    '{"a":{"c":[3,{"e":5,"f":4}],"d":2},"b":1}',
  )
  assert.equal(computeHash({ b: 1, a: 2 }), computeHash({ a: 2, b: 1 }))
})

test('computeHash: first 12 hex chars of sha256 over the stable JSON', () => {
  // sha256('{"title":"Hello"}') — pinned so an existing .i18n-hashes.json stays a valid baseline.
  assert.equal(computeHash({ title: 'Hello' }), '5c924960820d')
})

test('diff: no previous baseline marks every namespace changed', () => {
  const { currentHashes, changedKeys } = diffHashes(LOCALE_TREE, {})
  assert.deepEqual(changedKeys, ['en:common', 'en:blog', 'de:common'])
  assert.deepEqual(Object.keys(currentHashes), ['en:common', 'en:blog', 'de:common'])
})

test('diff: only namespaces whose content changed are listed', () => {
  const { currentHashes: baseline } = diffHashes(LOCALE_TREE, {})
  const edited = { ...LOCALE_TREE, de: { common: { title: 'Hallo!', nav: { home: 'Startseite' } } } }

  assert.deepEqual(diffHashes(LOCALE_TREE, baseline).changedKeys, [], 'unchanged tree, nothing to purge')
  assert.deepEqual(diffHashes(edited, baseline).changedKeys, ['de:common'])
})

test('purge list: changed pairs map to the pinned cache URLs', () => {
  assert.deepEqual(purgeUrlsFor(['de:common', 'ja:blog'], 'edgekits.dev'), [
    'https://edgekits.dev/i18n%3Ade%3Acommon',
    'https://edgekits.dev/i18n%3Aja%3Ablog',
  ])
})
