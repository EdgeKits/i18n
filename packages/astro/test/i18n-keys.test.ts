import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildTranslationCacheRequest,
  buildTranslationCacheUrl,
  buildTranslationKvKey,
} from '../src/translations-keys.ts'

/**
 * Pins the translation KV keys and edge-cache URLs byte for byte. Production KV
 * holds data under these keys and the bundle step purges these URLs, so a
 * change here orphans the stored translations and leaves stale cache entries
 * that never age out (`s-maxage=31536000, immutable`).
 *
 * The config is the fixture (`test/fixtures/i18n.config.ts`, keyPrefix `edgekits.dev`),
 * served in place of the integration's virtual config by tsconfig.test.json.
 */

test('KV key is <prefix>:<namespace>:<locale>', () => {
  assert.equal(buildTranslationKvKey('de', 'common'), 'edgekits.dev:common:de')
})

test('cache URL is https://<prefix>/<encoded i18n:<locale>:<namespace>>', () => {
  assert.equal(buildTranslationCacheUrl('de', 'common'), 'https://edgekits.dev/i18n%3Ade%3Acommon')
})

test('cache Request carries the same URL', () => {
  assert.equal(buildTranslationCacheRequest('ja', 'blog').url, 'https://edgekits.dev/i18n%3Aja%3Ablog')
})
