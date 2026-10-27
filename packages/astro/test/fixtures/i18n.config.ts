import { defineI18nConfig } from '../../src/types.ts'

// The config the tests run against, served in place of `virtual:@edgekits/astro-i18n/config`
// (tsconfig.test.json). Values mirror edgekits.dev, whose KV keys the keys test pins.
export default defineI18nConfig({
  keyPrefix: 'edgekits.dev',
  languages: {
    en: { countryCode: 'us', name: 'English (US)' },
    de: { countryCode: 'de', name: 'Deutsch' },
    es: { countryCode: 'es', name: 'Español' },
    ja: { countryCode: 'jp', name: '日本語' },
  },
  defaultLocale: 'en',
  cookie: { name: 'lang', maxAge: 60 * 60 * 24 * 365 },
  missingTranslationBanner: true,
  routing: 'prefix',
})
