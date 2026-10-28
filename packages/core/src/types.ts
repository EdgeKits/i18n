/**
 * Public types of the package and the config validator. Pure: no framework, no
 * `cloudflare:workers`, so a project's config file, an adapter's build step and the CLI
 * can import it under plain Node.
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
  // Prefix of every translation KV key and the host of every edge-cache URL, so it must be
  // a URL host as written (lowercase, no scheme, path or space).
  keyPrefix: string
  missingTranslationBanner: boolean
  // URL locale prefixes. The core reads none of this: an adapter interprets it and
  // rejects the modes it does not support.
  routing?: I18nRouting
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

export type I18nRouting = 'prefix' | 'prefix-except-default'

const ROUTINGS: readonly unknown[] = ['prefix', 'prefix-except-default'] satisfies I18nRouting[]

export const DEFAULT_GENERATED_DIR = 'src/i18n'
export const DEFAULT_LOCALES_DIR = 'locales'

/** The locale keys of a config's `languages`: a literal union for a literal config. */
export type LocaleOf<C extends I18nConfig> = Extract<keyof C['languages'], string>

const COUNTRY_CODE = /^[A-Z]{2}$/

// True when `https://<value>` parses with exactly `value` as its host: no scheme, path,
// port syntax error, space or upper case (the URL parser would change any of them).
function isOwnUrlHost(value: unknown): boolean {
  if (typeof value !== 'string' || value === '') return false
  try {
    return new URL(`https://${value}`).host === value
  } catch {
    return false
  }
}

/**
 * Validates and returns the config unchanged. Throws at config time on a `keyPrefix` that
 * is not a URL host as written, an empty
 * `languages`, a `defaultLocale` or `markdownLocale` that is not one of its keys, a
 * `routing` other than the two modes (absent is valid), or a `countryToLocale` entry whose key is not an uppercase country
 * code or whose value is not one of `languages` (also a type error for a literal config).
 */
export function defineI18nConfig<const C extends I18nConfig>(
  config: C & { countryToLocale?: Record<string, LocaleOf<C>>; markdownLocale?: LocaleOf<C> },
): C {
  const locales = Object.keys(config.languages ?? {})

  if (locales.length === 0) {
    throw new Error('[@edgekits/i18n-core] `languages` must define at least one locale.')
  }
  // Lowercase everywhere (config, `locales/` folders, URLs); `toIetfTag` relies on it.
  for (const locale of locales) {
    if (locale !== locale.toLowerCase()) {
      throw new Error(
        `[@edgekits/i18n-core] \`languages\` key "${locale}" is not lowercase (use "${locale.toLowerCase()}").`,
      )
    }
  }
  if (!isOwnUrlHost(config.keyPrefix)) {
    throw new Error(
      `[@edgekits/i18n-core] \`keyPrefix\` ${JSON.stringify(config.keyPrefix)} is not a URL host as written: ` +
        'it is the host of every edge-cache URL (https://<keyPrefix>/…). Use lowercase letters, digits, dots ' +
        'and hyphens, with no scheme or path ("example.com", "my-site").',
    )
  }
  if (!locales.includes(config.defaultLocale)) {
    throw new Error(
      `[@edgekits/i18n-core] \`defaultLocale\` "${config.defaultLocale}" is not one of \`languages\`: ${locales.join(', ')}.`,
    )
  }
  if (config.markdownLocale !== undefined && !locales.includes(config.markdownLocale)) {
    throw new Error(
      `[@edgekits/i18n-core] \`markdownLocale\` "${config.markdownLocale}" is not one of \`languages\`: ${locales.join(', ')}.`,
    )
  }
  if (config.routing !== undefined && !ROUTINGS.includes(config.routing)) {
    throw new Error(
      `[@edgekits/i18n-core] \`routing\` "${String(config.routing)}" is not supported; use 'prefix' or 'prefix-except-default'.`,
    )
  }
  for (const [country, locale] of Object.entries(config.countryToLocale ?? {})) {
    if (!COUNTRY_CODE.test(country)) {
      throw new Error(
        `[@edgekits/i18n-core] \`countryToLocale\` key "${country}" is not an uppercase ISO 3166-1 alpha-2 country code.`,
      )
    }
    if (!locales.includes(locale)) {
      throw new Error(
        `[@edgekits/i18n-core] \`countryToLocale\` maps "${country}" to "${locale}", which is not one of \`languages\`: ${locales.join(', ')}.`,
      )
    }
  }

  return config
}

/**
 * The project's locales, as keys. Empty here; an adapter augments it from the config's
 * `languages` (the Astro integration through `injectTypes` at `astro:config:done`).
 */
export interface I18nLocales {}

type LocaleKey = Extract<keyof I18nLocales, string>

// Falls back to `string` while `I18nLocales` is empty, like `Namespace` over `I18n.Schema`.
export type Locale = [LocaleKey] extends [never] ? string : LocaleKey

/** The Worker bindings an adapter reads from `cloudflare:workers` and hands to `createI18n`. */
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
}

type GlobalSchema = I18n.Schema

// Strictly bind the type to the keys of I18n.Schema.
// If the interface is empty (e.g., on a fresh project clone), fall back to string.
export type Namespace = keyof GlobalSchema extends never ? string : keyof GlobalSchema

// Added intersection N & keyof GlobalSchema so the compiler
// doesn't throw an error inside Pick when Namespace falls back to string.
export type PickSchema<N extends Namespace> = [N] extends [keyof GlobalSchema]
  ? Pick<GlobalSchema, N & keyof GlobalSchema>
  : any
