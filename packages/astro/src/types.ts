/**
 * Public types of the package and the config validator. Pure: no virtual modules,
 * no `cloudflare:workers`, so the consumer's `astro.config` and the CLI can import it
 * under plain Node.
 */

// `countryCode` is what the switcher's `flag` component receives; without it the item
// shows the name alone.
export type I18nLanguage = { countryCode?: string; name: string }

export type I18nConfig = {
  // The only source of truth for languages: the keys are the locales.
  languages: Record<string, I18nLanguage>
  defaultLocale: string
  // The lang cookie the middleware keeps in sync with the URL locale.
  cookie: { name: string; maxAge: number }
  // Prefix of every translation KV key and the host of every edge-cache URL.
  keyPrefix: string
  missingTranslationBanner: boolean
  routing: 'prefix'
  // Where the CLI writes `fallbacks.generated.ts` and `runtime-constants.ts`,
  // relative to the project root.
  generatedDir?: string
  // Where the CLI reads `<locale>/<namespace>.json`, relative to the project root.
  localesDir?: string
  // Geo-IP step of the middleware's locale fallback: ISO 3166-1 alpha-2 country code
  // (uppercase, as `request.cf.country` sends it) → one of `languages`. Without it the
  // step is skipped; the package ships no table of its own.
  countryToLocale?: Record<string, string>
  // The locale of the project's `.md` endpoints: a `.md` path is redirected once to
  // `/<markdownLocale>/<rest>` (a leading locale segment replaced, otherwise kept). Without
  // it, `.md` paths pass through the middleware untouched.
  markdownLocale?: string
}

export const DEFAULT_GENERATED_DIR = 'src/i18n'
export const DEFAULT_LOCALES_DIR = 'locales'

/** The locale keys of a config's `languages`: a literal union for a literal config. */
export type LocaleOf<C extends I18nConfig> = Extract<keyof C['languages'], string>

const COUNTRY_CODE = /^[A-Z]{2}$/

/**
 * Validates and returns the config unchanged. Throws at config time on an empty
 * `languages`, a `defaultLocale` or `markdownLocale` that is not one of its keys, an
 * unknown `routing`, or a `countryToLocale` entry whose key is not an uppercase country
 * code or whose value is not one of `languages` (also a type error for a literal config).
 */
export function defineI18nConfig<const C extends I18nConfig>(
  config: C & { countryToLocale?: Record<string, LocaleOf<C>>; markdownLocale?: LocaleOf<C> },
): C {
  const locales = Object.keys(config.languages ?? {})

  if (locales.length === 0) {
    throw new Error('[@edgekits/astro-i18n] `languages` must define at least one locale.')
  }
  // Lowercase everywhere (config, `locales/` folders, URLs); `toIetfTag` relies on it.
  for (const locale of locales) {
    if (locale !== locale.toLowerCase()) {
      throw new Error(
        `[@edgekits/astro-i18n] \`languages\` key "${locale}" is not lowercase (use "${locale.toLowerCase()}").`,
      )
    }
  }
  if (!locales.includes(config.defaultLocale)) {
    throw new Error(
      `[@edgekits/astro-i18n] \`defaultLocale\` "${config.defaultLocale}" is not one of \`languages\`: ${locales.join(', ')}.`,
    )
  }
  if (config.markdownLocale !== undefined && !locales.includes(config.markdownLocale)) {
    throw new Error(
      `[@edgekits/astro-i18n] \`markdownLocale\` "${config.markdownLocale}" is not one of \`languages\`: ${locales.join(', ')}.`,
    )
  }
  if (config.routing !== 'prefix') {
    throw new Error(
      `[@edgekits/astro-i18n] \`routing\` "${String(config.routing)}" is not supported; the only routing is 'prefix'.`,
    )
  }
  for (const [country, locale] of Object.entries(config.countryToLocale ?? {})) {
    if (!COUNTRY_CODE.test(country)) {
      throw new Error(
        `[@edgekits/astro-i18n] \`countryToLocale\` key "${country}" is not an uppercase ISO 3166-1 alpha-2 country code.`,
      )
    }
    if (!locales.includes(locale)) {
      throw new Error(
        `[@edgekits/astro-i18n] \`countryToLocale\` maps "${country}" to "${locale}", which is not one of \`languages\`: ${locales.join(', ')}.`,
      )
    }
  }

  return config
}

/**
 * The project's locales, as keys. Empty here; the integration augments it from the
 * config's `languages` (`injectTypes` at `astro:config:done`).
 */
export interface I18nLocales {}

type LocaleKey = Extract<keyof I18nLocales, string>

// Falls back to `string` while `I18nLocales` is empty, like `Namespace` over `I18n.Schema`.
export type Locale = [LocaleKey] extends [never] ? string : LocaleKey

/** The Worker bindings the engine reads from `cloudflare:workers`. */
export interface I18nBindings {
  TRANSLATIONS: KVNamespace
  I18N_CACHE?: string
  DEBUG_I18N?: string
}

declare global {
  // Augmented by the consumer's generated `i18n.generated.d.ts`.
  namespace I18n {
    interface Schema {}
  }

  // Set by the i18n middleware on every request.
  namespace App {
    interface Locals {
      uiLocale: Locale
      translationLocale: Locale
      isMissingContent?: boolean
    }
  }
}
