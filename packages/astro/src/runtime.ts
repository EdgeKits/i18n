// The runtime entry (`@edgekits/astro-i18n/runtime`): what pages, layouts and endpoints
// import. Ships as source and runs through the project's Vite, next to the virtual
// modules the integration serves.
export { fetchTranslations } from './fetcher'
export { fmt, plural, pluralIcu, toIetfTag, replaceLocaleInPath, getLangFromUrl } from './format'
export type { PluralCategory, PluralPatterns } from './format'
export { I18N_CONFIG } from './config'
export {
  DEFAULT_LOCALE,
  ENABLE_MISSING_TRANSLATION_BANNER,
  LANG_COOKIE_NAME,
  LANGUAGES,
  SUPPORTED_LOCALES,
} from './constants'
export type { Language, SupportedLocales } from './constants'
export { LocaleSchema } from './schema'
export type { Namespace, PickSchema } from './schema'
export { checkMissingTranslation, resolveLocale, resolveLocaleForTranslations } from './resolve-locale'
export type { I18nBindings, I18nConfig, I18nLanguage, I18nLocales, Locale } from './types'
