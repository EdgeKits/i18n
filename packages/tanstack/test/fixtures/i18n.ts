import { createI18n, defineI18nConfig, type Bindings, type TranslationsKv } from '@edgekits/i18n-core'

// A literal config, so the instance's locale type is 'en' | 'de' | 'es'.
export const config = defineI18nConfig({
  keyPrefix: 'tanstack.test',
  languages: {
    en: { countryCode: 'us', name: 'English' },
    de: { countryCode: 'de', name: 'Deutsch' },
    es: { countryCode: 'es', name: 'Español' },
  },
  defaultLocale: 'en',
  cookie: { name: 'lang', maxAge: 60 * 60 * 24 * 365 },
  missingTranslationBanner: false,
  // Present to show the cascade has no country step: a request never reaches it.
  countryToLocale: { DE: 'de' },
})

const RUNTIME_CONSTANTS = {
  NAMESPACE_KEYS: ['common', 'home'],
  LOCALES_WITH_TRANSLATIONS: ['en', 'de', 'es'],
  FULLY_TRANSLATED_LOCALES: ['en', 'de', 'es'],
}

/**
 * An instance over a Map-backed KV (the core's fetcher-test approach): no edge cache, so
 * every call reads the Map. `kv` maps `<namespace>:<locale>` to the stored JSON;
 * `localesWithTranslations` replaces the generated LOCALES_WITH_TRANSLATIONS.
 */
export function createFixture(
  kv: Record<string, unknown> = {},
  localesWithTranslations: readonly string[] = RUNTIME_CONSTANTS.LOCALES_WITH_TRANSLATIONS,
) {
  const store = new Map<string, unknown>()
  const reads: string[][] = []
  const translationsKv: TranslationsKv = {
    async get(keys) {
      reads.push(keys)
      return new Map(keys.map((key) => [key, store.get(key) ?? null]))
    },
  }
  const bindings: Bindings = {
    kv: translationsKv,
    cache: null,
    waitUntil: () => {},
    cacheEnabled: false,
    debug: false,
  }

  const runtimeConstants = { ...RUNTIME_CONSTANTS, LOCALES_WITH_TRANSLATIONS: localesWithTranslations }
  const i18n = createI18n(config, { fallbacks: {}, runtimeConstants }, bindings)
  for (const [entry, value] of Object.entries(kv)) {
    const [ns = '', locale = ''] = entry.split(':')
    store.set(i18n.buildTranslationKvKey(locale as 'en', ns), value)
  }
  return { i18n, reads }
}

export type FixtureLocale = 'en' | 'de' | 'es'

/**
 * One table for the middleware and the loader: the same request must give the same locale
 * through either. `preference` is the `userPreference` hook's answer (absent: no hook).
 */
export type LocaleCase = {
  name: string
  headers: Record<string, string>
  preference?: string | null
  async?: boolean
  expected: FixtureLocale
}

export const LOCALE_CASES: LocaleCase[] = [
  { name: 'cookie', headers: { cookie: 'lang=de' }, expected: 'de' },
  { name: 'cookie wins over Accept-Language', headers: { cookie: 'lang=de', 'accept-language': 'es' }, expected: 'de' },
  {
    name: 'cookie wins over userPreference',
    headers: { cookie: 'other=1; lang=de' },
    preference: 'es',
    expected: 'de',
  },
  { name: 'invalid cookie ignored', headers: { cookie: 'lang=xx', 'accept-language': 'es' }, expected: 'es' },
  {
    name: 'userPreference before Accept-Language',
    headers: { 'accept-language': 'de' },
    preference: 'es',
    expected: 'es',
  },
  {
    name: 'async userPreference',
    headers: { cookie: 'lang=xx', 'accept-language': 'de' },
    preference: 'es',
    async: true,
    expected: 'es',
  },
  { name: 'userPreference null', headers: { 'accept-language': 'de' }, preference: null, expected: 'de' },
  { name: 'userPreference unsupported', headers: { 'accept-language': 'de' }, preference: 'fr', expected: 'de' },
  { name: 'regional Accept-Language tag', headers: { 'accept-language': 'de-DE,de;q=0.9' }, expected: 'de' },
  { name: 'nothing matches', headers: { 'accept-language': 'fr-FR, it;q=0.8' }, expected: 'en' },
  { name: 'no headers', headers: {}, expected: 'en' },
]

// The case's `userPreference` hook, recording the requests it is called with.
export function preferenceOf(testCase: LocaleCase) {
  const calls: Request[] = []
  if (!('preference' in testCase)) return { calls, options: {} }

  const answer = testCase.preference ?? null
  const userPreference = testCase.async
    ? async (request: Request) => (calls.push(request), answer)
    : (request: Request) => (calls.push(request), answer)
  return { calls, options: { userPreference } }
}
