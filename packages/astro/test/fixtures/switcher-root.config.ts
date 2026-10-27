import { defineI18nConfig } from '../../src/types.ts'

// The switcher render test's config without `routing` (the 'prefix-except-default' default).
export default defineI18nConfig({
  keyPrefix: 'example.test',
  languages: {
    en: { countryCode: 'us', name: 'English' },
    eo: { name: 'Esperanto' },
  },
  defaultLocale: 'en',
  cookie: { name: 'lang', maxAge: 60 },
  missingTranslationBanner: false,
})
