import { localesOf } from './config.ts'
import {
  getCookieLang as getCookieLangFrom,
  readCookieLang as readCookieLangFrom,
  setCookieLang as setCookieLangFrom,
  type CookieJar,
  type CookieLang,
} from './cookie.ts'
import { createFetchTranslations, type Bindings } from './fetcher.ts'
import { formatTranslationCacheUrl, formatTranslationKvKey } from './key-format.ts'
import { resolveFallbackLocale as resolveFallbackFrom, type FallbackInputs } from './locale-fallback.ts'
import type { I18nConfig, I18nLanguage, Locale, LocaleOf, Namespace } from './types.ts'

/** The project's CLI-generated modules, or empty stand-ins before the first `bundle`. */
export type GeneratedModules = {
  // `fallbacks.generated.ts`: `FALLBACK_<NAMESPACE>` dictionaries.
  fallbacks: Record<string, unknown>
  // `runtime-constants.ts`.
  runtimeConstants: {
    NAMESPACE_KEYS: readonly string[]
    LOCALES_WITH_TRANSLATIONS: readonly string[]
    FULLY_TRANSLATED_LOCALES: readonly string[]
  }
}

/**
 * The locale type of an instance: the config's own keys when the config is literal, the
 * augmented `Locale` when it is not (an adapter's config arriving as `I18nConfig`), the
 * same rule `localesOf` and the adapter's constants follow.
 */
export type InstanceLocale<C extends I18nConfig> = string extends LocaleOf<C> ? Locale : LocaleOf<C>

// 'ui': the interface is not fully translated; 'content': the page's content is missing
// in the selected language; null: no banner.
export type MissingTranslationType = 'ui' | 'content' | null

/**
 * The engine for one project: the locale constants, the fetcher, the locale resolution
 * and the lang cookie, bound to its config, its generated modules and its platform
 * bindings. Pure of any framework and platform: an adapter builds one instance and
 * re-exports what its framework needs.
 *
 * `bindings` are read at call time (see `Bindings`), never here.
 */
export function createI18n<const C extends I18nConfig>(
  config: C & {
    defaultLocale: LocaleOf<C>
    countryToLocale?: Record<string, LocaleOf<C>>
    markdownLocale?: LocaleOf<C>
  },
  generated: GeneratedModules,
  bindings: Bindings,
) {
  type L = InstanceLocale<C>

  // Validates through defineI18nConfig.
  const locales = localesOf<C>(config)

  const DEFAULT_LOCALE = locales.DEFAULT_LOCALE as L
  const SUPPORTED_LOCALES = locales.SUPPORTED_LOCALES as [L, ...L[]]
  const LANGUAGES = locales.LANGUAGES as Record<L, I18nLanguage>
  const LANG_COOKIE_NAME = config.cookie.name
  const ENABLE_MISSING_TRANSLATION_BANNER = config.missingTranslationBanner

  const supported: readonly unknown[] = SUPPORTED_LOCALES

  function isLocale(value: unknown): value is L {
    return typeof value === 'string' && supported.includes(value)
  }

  function parseLocale(value: unknown): L | null {
    return isLocale(value) ? value : null
  }

  /**
   * Single source of truth for translation KV key construction, shared with the CLI
   * through `key-format.ts`. Format: <keyPrefix>:<namespace>:<locale>
   */
  function buildTranslationKvKey(locale: L, ns: Namespace): string {
    return formatTranslationKvKey(config.keyPrefix, locale, ns)
  }

  /**
   * Single source of truth for translation cache URL construction, shared with the CLI
   * (Purge API) through `key-format.ts`. The URL is static, not versioned: invalidation
   * is the explicit purge in `edgekits-i18n migrate`.
   *
   * Format: https://<keyPrefix>/<encodeURIComponent(i18n:<locale>:<namespace>)>
   */
  function buildTranslationCacheUrl(locale: L, ns: Namespace): string {
    return formatTranslationCacheUrl(config.keyPrefix, locale, ns)
  }

  // The Cache API takes a Request object, not a plain string.
  function buildTranslationCacheRequest(locale: L, ns: Namespace): Request {
    return new Request(buildTranslationCacheUrl(locale, ns))
  }

  const fetchTranslations = createFetchTranslations<L>({
    fallbacks: generated.fallbacks,
    bindings,
    buildTranslationKvKey,
    buildTranslationCacheRequest,
  })

  const { LOCALES_WITH_TRANSLATIONS, FULLY_TRANSLATED_LOCALES } = generated.runtimeConstants

  /**
   * Translation locale: what is actually loaded from KV. Falls back to the default
   * locale when there is no bundle for the UI locale.
   */
  function resolveLocaleForTranslations(locale: L): L {
    return LOCALES_WITH_TRANSLATIONS.includes(locale) ? locale : DEFAULT_LOCALE
  }

  /** Which "missing translation" banner to show for a UI locale, or null for none. */
  function checkMissingTranslation(uiLocale: L, isMissingContent: boolean | undefined): MissingTranslationType {
    if (!ENABLE_MISSING_TRANSLATION_BANNER) return null

    if (FULLY_TRANSLATED_LOCALES.includes(uiLocale) && !isMissingContent) return null

    return isMissingContent ? 'content' : 'ui'
  }

  /** The fallback cascade (locale-fallback.ts) with this config's options. */
  function resolveFallbackLocale(inputs: FallbackInputs<L>): L {
    return resolveFallbackFrom<L>(inputs, {
      parseLocale,
      defaultLocale: DEFAULT_LOCALE,
      countryToLocale: config.countryToLocale,
    })
  }

  const cookie = { parseLocale, name: LANG_COOKIE_NAME }

  function setCookieLang(jar: CookieJar, locale: L, options: { secure: boolean }): void {
    setCookieLangFrom(jar, locale, { ...cookie, maxAge: config.cookie.maxAge, secure: options.secure })
  }

  function readCookieLang(jar: CookieJar, options: { onInvalid?: (value: string) => void } = {}): CookieLang<L> {
    return readCookieLangFrom(jar, { ...cookie, onInvalid: options.onInvalid })
  }

  function getCookieLang(jar: CookieJar, options: { onInvalid?: (value: string) => void } = {}): L | null {
    return getCookieLangFrom(jar, { ...cookie, onInvalid: options.onInvalid })
  }

  return {
    config,
    DEFAULT_LOCALE,
    SUPPORTED_LOCALES,
    LANGUAGES,
    LANG_COOKIE_NAME,
    ENABLE_MISSING_TRANSLATION_BANNER,
    isLocale,
    parseLocale,
    fetchTranslations,
    resolveLocaleForTranslations,
    checkMissingTranslation,
    resolveFallbackLocale,
    buildTranslationKvKey,
    buildTranslationCacheUrl,
    buildTranslationCacheRequest,
    setCookieLang,
    readCookieLang,
    getCookieLang,
  }
}

export type I18nInstance<C extends I18nConfig = I18nConfig> = ReturnType<typeof createI18n<C>>
