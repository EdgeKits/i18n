import assert from 'node:assert/strict'
import test from 'node:test'

import { astroI18n, assertAstroI18n, edgekitsI18n, resolveConfig } from '../src/integration/index.ts'
import config from './fixtures/i18n.config.ts'

/**
 * Both routing modes are accepted; an absent `routing` resolves to 'prefix-except-default'
 * before the config is serialised. The Astro `i18n` block is the same in both modes
 * (`prefixDefaultLocale: true`: Astro's own check runs on the rewritten `/<default>/…`
 * URL), and a project's own block must route that way.
 */

test("a config without routing resolves to 'prefix-except-default', in the virtual config too", () => {
  const { routing: _routing, ...withoutRouting } = config
  assert.equal(resolveConfig(withoutRouting).routing, 'prefix-except-default')
  assert.equal(resolveConfig(config).routing, 'prefix')

  // What the Vite plugin serves as `virtual:@edgekits/astro-i18n/config`.
  const updates: any[] = []
  const setup = edgekitsI18n(withoutRouting).hooks['astro:config:setup'] as (params: unknown) => void
  setup({
    config: { root: new URL('./', import.meta.url) },
    updateConfig: (payload: unknown) => updates.push(payload),
    addMiddleware: () => {},
  })
  const plugin = updates[0].vite.plugins[0]
  const source: string = plugin.load(plugin.resolveId('virtual:@edgekits/astro-i18n/config'))
  assert.equal(JSON.parse(source.replace(/^export default /, '')).routing, 'prefix-except-default')
})

test("both routing values are accepted: 'prefix' and 'prefix-except-default'", () => {
  assert.equal(edgekitsI18n(config).name, '@edgekits/astro-i18n')
  assert.equal(edgekitsI18n({ ...config, routing: 'prefix-except-default' }).name, '@edgekits/astro-i18n')
})

test('the Astro i18n block is the same in both modes', () => {
  const expected = {
    locales: ['en', 'de', 'es', 'ja'],
    defaultLocale: 'en',
    routing: { prefixDefaultLocale: true, redirectToDefaultLocale: false, fallbackType: 'redirect' },
  }
  assert.deepEqual(astroI18n(resolveConfig(config)), expected)
  assert.deepEqual(astroI18n(resolveConfig({ ...config, routing: 'prefix-except-default' })), expected)
})

test('assertAstroI18n rejects prefixDefaultLocale: false (or absent) and redirectToDefaultLocale: true', () => {
  const block = (routing: unknown) => ({ locales: ['en', 'de', 'es', 'ja'], defaultLocale: 'en', routing }) as never
  for (const mode of ['prefix', 'prefix-except-default'] as const) {
    const resolved = resolveConfig({ ...config, routing: mode })
    assert.throws(
      () => assertAstroI18n(block({ prefixDefaultLocale: false, redirectToDefaultLocale: false }), resolved),
      /must set `prefixDefaultLocale: true` and `redirectToDefaultLocale: false`/,
    )
    assert.throws(() => assertAstroI18n(block({}), resolved), /must set `prefixDefaultLocale: true`/)
    assert.throws(() => assertAstroI18n(block('manual'), resolved), /must set `prefixDefaultLocale: true`/)
    assert.throws(
      () => assertAstroI18n(block({ prefixDefaultLocale: true, redirectToDefaultLocale: true }), resolved),
      /`redirectToDefaultLocale: false`/,
    )
    assert.doesNotThrow(() => assertAstroI18n(block({ prefixDefaultLocale: true }), resolved))
  }
})
