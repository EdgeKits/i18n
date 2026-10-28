import assert from 'node:assert/strict'
import test from 'node:test'

import { buildTranslationCacheRequest, buildTranslationCacheUrl, buildTranslationKvKey } from './fixtures/instance.ts'

/**
 * Pins the translation KV keys and edge-cache URLs byte for byte. Production KV
 * holds data under these keys and `migrate` purges these URLs, so a KV key
 * change orphans the stored translations, and a cache URL change leaves the old
 * entries unpurged until they age out (`s-maxage=31536000, immutable`). The
 * cache URL changes only with the entry format (`v2`: raw KV values, ADR-0033).
 *
 * The builders are an instance's (`createI18n`) over the fixture config
 * (`test/fixtures/i18n.config.ts`, keyPrefix `edgekits.dev`).
 */

test('KV key is <prefix>:<namespace>:<locale>', () => {
  assert.equal(buildTranslationKvKey('de', 'common'), 'edgekits.dev:common:de')
})

test('cache URL is https://<prefix>/<encoded i18n:v2:<locale>:<namespace>>', () => {
  assert.equal(buildTranslationCacheUrl('de', 'common'), 'https://edgekits.dev/i18n%3Av2%3Ade%3Acommon')
})

test('a dotted namespace keeps both formats: the dot is just a character', () => {
  assert.equal(buildTranslationKvKey('en', 'app.billing'), 'edgekits.dev:app.billing:en')
  assert.equal(buildTranslationCacheUrl('en', 'app.billing'), 'https://edgekits.dev/i18n%3Av2%3Aen%3Aapp.billing')
})

test('cache Request carries the same URL', () => {
  assert.equal(buildTranslationCacheRequest('ja', 'blog').url, 'https://edgekits.dev/i18n%3Av2%3Aja%3Ablog')
})
