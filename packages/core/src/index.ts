// `@edgekits/i18n-core`: the engine, free of any framework. `createI18n` binds it to one
// project; the pure helpers below are what an adapter (or a project) uses directly.
export {
  createI18n,
  type GeneratedModules,
  type I18nInstance,
  type InstanceLocale,
  type MissingTranslationType,
} from './create-i18n.ts'
export { localesOf, type LocalesOf } from './config.ts'
export {
  DEFAULT_GENERATED_DIR,
  DEFAULT_LOCALES_DIR,
  defineI18nConfig,
  type I18nBindings,
  type I18nConfig,
  type I18nLanguage,
  type I18nLocales,
  type I18nRouting,
  type Locale,
  type LocaleOf,
  type Namespace,
  type PickSchema,
} from './types.ts'
export type { Bindings, EdgeCache, FetcherInputs, TranslationsKv } from './fetcher.ts'
export {
  fmt,
  getLangFromUrl,
  plural,
  pluralIcu,
  replaceLocaleInPath,
  toIetfTag,
  type PluralCategory,
  type PluralPatterns,
} from './format.ts'
export { matchAcceptLanguage, parseAcceptLanguage, type AcceptLanguageEntry } from './accept-language.ts'
export {
  mapCountryToLocale,
  resolveFallbackLocale,
  type FallbackInputs,
  type FallbackOptions,
} from './locale-fallback.ts'
export { MARKDOWN_PATH, markdownRedirectTarget, type MarkdownOptions } from './markdown-path.ts'
export { assembleNamespace } from './assemble.ts'
export { formatTranslationCacheUrl, formatTranslationKvKey } from './key-format.ts'
export { parseBooleanFlag } from './parse-boolean.ts'
export {
  getCookieLang,
  readCookieLang,
  setCookieLang,
  type CookieJar,
  type CookieLang,
  type CookieLangOptions,
  type ReadCookieLangOptions,
  type SetCookieLangOptions,
} from './cookie.ts'
