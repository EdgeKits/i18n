import assert from 'node:assert/strict'
import test from 'node:test'

import * as runtime from '../src/runtime.ts'
import type { Language, Locale, Namespace, PickSchema, SupportedLocales } from '../src/runtime.ts'

/**
 * Pins the value exports of `@edgekits/astro-i18n/runtime`. Consumers import these by
 * name (the site imports DEFAULT_LOCALE in 15 files), so removing or renaming one is a
 * breaking change: it has to be made here, on purpose. The type imports above fail
 * `npm run typecheck` the same way if a pinned type disappears.
 *
 * Loaded through the fixture config and fixture virtual modules (tsconfig.test.json).
 */
const PINNED_VALUE_EXPORTS = [
  'DEFAULT_LOCALE',
  'ENABLE_MISSING_TRANSLATION_BANNER',
  'I18N_CONFIG',
  'LANGUAGES',
  'LANG_COOKIE_NAME',
  'LocaleSchema',
  'SUPPORTED_LOCALES',
  'checkMissingTranslation',
  'fetchTranslations',
  'fmt',
  'getLangFromUrl',
  'plural',
  'pluralIcu',
  'replaceLocaleInPath',
  'resolveLocale',
  'resolveLocaleForTranslations',
  'toIetfTag',
]

test('the runtime barrel exports exactly the pinned value names', () => {
  assert.deepEqual(Object.keys(runtime).sort(), [...PINNED_VALUE_EXPORTS].sort())
})

test('the locale constants come from the config', () => {
  assert.equal(runtime.DEFAULT_LOCALE, 'en')
  assert.deepEqual(runtime.SUPPORTED_LOCALES, ['en', 'de', 'es', 'ja'])
  assert.deepEqual(runtime.LANGUAGES.de, { countryCode: 'de', name: 'Deutsch' })
  assert.equal(runtime.LANG_COOKIE_NAME, 'lang')
  assert.equal(runtime.ENABLE_MISSING_TRANSLATION_BANNER, true)
  assert.equal(runtime.I18N_CONFIG.keyPrefix, 'edgekits.dev')
})

// Compile-time only: each pinned type is still exported (`npm run typecheck`).
export type PinnedTypes = [Language, Locale, Namespace, PickSchema<never>, SupportedLocales]
