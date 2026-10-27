import { defineI18nConfig } from '../../src/types.ts'

// The config the switcher render test serves as `virtual:@edgekits/astro-i18n/config`:
// one locale with a `countryCode`, one without (Esperanto has no country).
export default defineI18nConfig({
  keyPrefix: 'example.test',
  languages: {
    en: { countryCode: 'us', name: 'English' },
    eo: { name: 'Esperanto' },
  },
  defaultLocale: 'en',
  cookie: { name: 'lang', maxAge: 60 },
  missingTranslationBanner: false,
  routing: 'prefix',
})
