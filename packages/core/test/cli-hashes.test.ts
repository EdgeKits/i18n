import assert from 'node:assert/strict'
import test from 'node:test'

import {
  computeHash,
  diffHashes,
  purgeUrlsFor,
  readBaseline,
  removedKeys,
  stableStringify,
  writeBaseline,
} from '../src/cli/hashes.ts'
import { ARRAY_TREE, LOCALE_TREE } from './fixtures/locales.ts'

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
    'https://edgekits.dev/i18n%3Av2%3Ade%3Acommon',
    'https://edgekits.dev/i18n%3Av2%3Aja%3Ablog',
  ])
})

test('stableStringify sorts keys by code point, not by locale collation', () => {
  assert.equal(
    stableStringify({ metadata: 1, metaTitle: 2, b: 3, B: 4, a_b: 5, 'a-b': 6 }),
    '{"B":4,"a-b":6,"a_b":5,"b":3,"metaTitle":2,"metadata":1}',
  )
})

test('the fixture baselines hash as before the code-point sort (lowercase ASCII keys)', () => {
  // Pinned from the localeCompare implementation on 2026-10-28.
  assert.deepEqual(diffHashes(LOCALE_TREE, {}).currentHashes, {
    'en:common': '4da090312761',
    'en:blog': 'c9aca63c837f',
    'de:common': 'eba106a79ec6',
  })
  assert.deepEqual(diffHashes(ARRAY_TREE, {}).currentHashes, { 'en:faq': 'ba1c433044bc', 'de:faq': 'd97329b18c1d' })
})

const KV_A = 'a'.repeat(32)
const KV_B = 'b'.repeat(32)

test('baseline: one map per KV namespace id', () => {
  const file = { [KV_A]: { 'en:common': '111111111111' }, [KV_B]: { 'en:common': '222222222222' } }
  assert.deepEqual(readBaseline(file, KV_A), { 'en:common': '111111111111' })
  assert.deepEqual(readBaseline(file, KV_B), { 'en:common': '222222222222' })
  assert.deepEqual(readBaseline(file, 'c'.repeat(32)), {}, 'a namespace never migrated: everything changed')
  assert.deepEqual(readBaseline(undefined, KV_A), {}, 'no file')
  assert.deepEqual(writeBaseline(file, KV_A, { 'en:blog': '333333333333' }), {
    [KV_A]: { 'en:blog': '333333333333' },
    [KV_B]: { 'en:common': '222222222222' },
  })
})

test('baseline: the old flat shape is the current namespace baseline, and is rewritten per id', () => {
  const flat = { 'en:common': '111111111111', 'de:common': '222222222222' }
  assert.deepEqual(readBaseline(flat, KV_A), flat)
  assert.deepEqual(readBaseline(flat, KV_B), flat)
  assert.deepEqual(writeBaseline(flat, KV_A, { 'en:common': '333333333333' }), {
    [KV_A]: { 'en:common': '333333333333' },
  })
})

test('baseline without a KV id (bundle): the only map, the flat file, else none', () => {
  assert.deepEqual(readBaseline({ [KV_A]: { 'en:common': '1' } }), { 'en:common': '1' })
  assert.deepEqual(readBaseline({ 'en:common': '1' }), { 'en:common': '1' })
  assert.deepEqual(readBaseline({}), {})
  assert.equal(readBaseline({ [KV_A]: {}, [KV_B]: {} }), undefined)
})

test('removedKeys: pairs in the baseline that the tree no longer has', () => {
  const { currentHashes } = diffHashes(LOCALE_TREE, {})
  assert.deepEqual(removedKeys({ ...currentHashes, 'de:pricing': 'x', 'ja:blog': 'y' }, currentHashes), [
    'de:pricing',
    'ja:blog',
  ])
  assert.deepEqual(removedKeys({}, currentHashes), [])
})
