import { createI18n } from '../../src/create-i18n.ts'
import config from './i18n.config.ts'

// An instance over the fixture config whose bindings fail when read: for tests of what an
// instance derives from its config alone (keys, locales), never of the fetcher.
const unreachable = (): never => {
  throw new Error('fixture instance: bindings are not for this test')
}

export const { buildTranslationCacheRequest, buildTranslationCacheUrl, buildTranslationKvKey } = createI18n(
  config,
  {
    fallbacks: {},
    runtimeConstants: { NAMESPACE_KEYS: [], LOCALES_WITH_TRANSLATIONS: [], FULLY_TRANSLATED_LOCALES: [] },
  },
  {
    get kv() {
      return unreachable()
    },
    get cache() {
      return unreachable()
    },
    waitUntil: unreachable,
    get cacheEnabled() {
      return unreachable()
    },
    get debug() {
      return unreachable()
    },
  },
)
