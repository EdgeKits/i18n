// The config helpers: Node-safe. Nothing here reaches a framework, workerd or a virtual
// module, so a project's pure modules (unit tests under Node, a content config evaluated
// at build time) can derive the locale constants from the config file directly.
import { defineI18nConfig, type I18nConfig, type I18nLanguage, type LocaleOf } from './types.ts'

export { defineI18nConfig }
export type { I18nBindings, I18nConfig, I18nLanguage, I18nLocales, I18nRouting, Locale, LocaleOf } from './types.ts'

export type LocalesOf<C extends I18nConfig> = {
  DEFAULT_LOCALE: LocaleOf<C>
  SUPPORTED_LOCALES: [LocaleOf<C>, ...LocaleOf<C>[]]
  LANGUAGES: Record<LocaleOf<C>, I18nLanguage>
}

/**
 * The locale constants of a config: the one derivation, shared by `createI18n` and by
 * project code (over its own `edgekits-i18n.config.ts`, typed by its own keys without the
 * `I18nLocales` augmentation).
 *
 * `defaultLocale` must be one of `languages` at the type level, and is validated at run time.
 */
export function localesOf<const C extends I18nConfig>(
  config: C & {
    defaultLocale: LocaleOf<C>
    countryToLocale?: Record<string, LocaleOf<C>>
    markdownLocale?: LocaleOf<C>
  },
): LocalesOf<C> {
  defineI18nConfig<C>(config)

  return {
    DEFAULT_LOCALE: config.defaultLocale,
    // Object.keys widens to string[]; the keys are the config's own `languages` keys.
    SUPPORTED_LOCALES: Object.keys(config.languages) as [LocaleOf<C>, ...LocaleOf<C>[]],
    LANGUAGES: config.languages as Record<LocaleOf<C>, I18nLanguage>,
  }
}
