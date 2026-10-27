import { defineI18nConfig } from '../../src/types.ts'

// The switcher render test's config with one locale: nothing to switch to.
export default defineI18nConfig({
  keyPrefix: 'example.test',
  languages: { en: { countryCode: 'us', name: 'English' } },
  defaultLocale: 'en',
  cookie: { name: 'lang', maxAge: 60 },
  missingTranslationBanner: false,
})
