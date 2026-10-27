import assert from 'node:assert/strict'
import test from 'node:test'

import { edgekitsI18n } from '../src/integration/index.ts'
import config from './fixtures/i18n.config.ts'

/**
 * The core accepts `routing` absent or 'prefix-except-default'; the Astro adapter
 * implements 'prefix' only so far and stops anything else when the integration is created
 * (config time), before Astro builds anything.
 */

test("routing 'prefix' is accepted", () => {
  assert.equal(edgekitsI18n(config).name, '@edgekits/astro-i18n')
})

test('a config without routing throws, asking for prefix', () => {
  const { routing: _routing, ...withoutRouting } = config
  assert.throws(() => edgekitsI18n(withoutRouting), /`routing` is required: set `routing: 'prefix'`/)
})

test("routing 'prefix-except-default' throws until the adapter supports it", () => {
  assert.throws(
    () => edgekitsI18n({ ...config, routing: 'prefix-except-default' }),
    /`routing` "prefix-except-default" is not supported by the Astro adapter yet; use 'prefix'\./,
  )
})
