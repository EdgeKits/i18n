// The `./config` entry: Node-safe. It imports nothing from workerd and no virtual module,
// so a project's pure modules (unit tests under Node, `src/content.config.ts` evaluated by
// `astro sync`) can derive the locale constants from the config file directly. The helpers
// are the core's (`@edgekits/i18n-core`). `test/node-safe-entries.test.ts` loads it under
// plain Node to keep it that way.
export { defineI18nConfig, localesOf } from './types'
export type { I18nBindings, I18nConfig, I18nLanguage, I18nLocales, Locale, LocaleOf, LocalesOf } from './types'
