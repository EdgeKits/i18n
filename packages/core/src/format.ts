import type { I18nRouting } from './types.ts'

// Sanitizer: Turns <script> into &lt;script&gt;
function escapeHtml(unsafe: string | number): string {
  return String(unsafe)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

type TemplateValues = Record<string, string | number>

// `./format` is a Node-safe entry: under plain Node (a project's unit tests, `astro sync`)
// there is no `import.meta.env`, and a missing one counts as "not production", so the
// dev warnings below still fire instead of throwing.
function isProd(): boolean {
  return import.meta.env?.PROD === true
}

/**
 * Interpolates {placeholders} in a template string and escapes values.
 * - If `template` is undefined/null, returns an empty string (and logs in dev).
 * - If `values` is undefined, returns the template unchanged.
 */
export function fmt(template: string | null | undefined, values?: TemplateValues): string {
  if (template == null) {
    if (!isProd()) {
      console.warn('[i18n] fmt() called with null/undefined template')
    }
    return ''
  }

  if (!values) return template

  return template.replace(/{([^}]+)}/g, (match, key) => {
    const replacement = values[key]

    if (replacement === undefined || replacement === null) {
      return match
    }

    return escapeHtml(replacement)
  })
}

/**
 * Simple two-form plural helper.
 * Good for English-like languages where "1" vs "other" is enough.
 * Both forms interpolate `{count}`.
 */
export function plural(count: number, singular: string, plural: string): string {
  return fmt(count === 1 ? singular : plural, { count })
}

/**
 * ICU-style plural categories used by Intl.PluralRules.
 */
export type PluralCategory = 'zero' | 'one' | 'two' | 'few' | 'many' | 'other'

export type PluralPatterns = Partial<Record<PluralCategory, string>>

/**
 * Advanced plural helper using Intl.PluralRules + fmt().
 *
 * - `locale` controls plural categories (en, de, es, ja, ...).
 * - `patterns` comes from KV (e.g. { zero, one, other }).
 * - Missing categories fall back to `other`.
 *
 * Example:
 *   pluralIcu(5, 'en', {
 *     zero: 'No items',
 *     one: '{count} item',
 *     other: '{count} items'
 *   })
 */
export function pluralIcu(count: number, locale: string, patterns: PluralPatterns): string {
  const rules = new Intl.PluralRules(locale)
  const cat = rules.select(count) as PluralCategory

  const template =
    patterns[cat] ??
    patterns.other ??
    (isProd() ? '' : (console.warn('[i18n] pluralIcu(): missing "other" pattern'), ''))

  return fmt(template, { count })
}

export type LocalizedPathOptions = {
  // Absent means 'prefix-except-default', the mode a config without `routing` gets.
  routing: I18nRouting | undefined
  defaultLocale: string
  isLocale: (segment: string) => boolean
}

// An extension that starts with a letter, up to 11 characters (`.webmanifest`, the
// longest common one): `.xml`, `.md`; not `.0` (`/blog/v2.0` is a page).
const FILE_EXTENSION = /\.[a-z][a-z0-9]{0,10}$/i

/**
 * True when the path's last segment ends in a file extension (`/rss.xml`, `/doc.pdf`).
 * A path that ends in a slash is a page (`/rss.xml/` included).
 */
export function isFilePath(pathname: string): boolean {
  const last = pathname.slice(pathname.lastIndexOf('/') + 1)
  return FILE_EXTENSION.test(last)
}

/**
 * The path of a page in `locale`, for either routing mode: with a trailing slash, or
 * without one for a file path (`isFilePath`). A leading locale segment is stripped first,
 * so a prefixed `/de/about/`, a rewritten `/en/about/` and a bare `/about/` all name the
 * same page. 'prefix': `/<locale>/<rest>/`. 'prefix-except-default': the same, except
 * `/<rest>/` (`/` for the root) for the default locale. A `?query` and a `#hash` in the
 * input are kept after the path. The path is rebuilt from its non-empty segments, so the
 * result never starts with `//`.
 */
export function localizedPath(locale: string, pathname: string, options: LocalizedPathOptions): string {
  const suffixAt = pathname.search(/[?#]/)
  const path = suffixAt === -1 ? pathname : pathname.slice(0, suffixAt)
  const suffix = suffixAt === -1 ? '' : pathname.slice(suffixAt)

  const segments = path.split('/').filter(Boolean)
  if (segments.length > 0 && options.isLocale(segments[0]!)) segments.shift()

  const rest = segments.length > 0 ? `${segments.join('/')}${isFilePath(path) ? '' : '/'}` : ''
  const unprefixed = options.routing !== 'prefix' && locale === options.defaultLocale
  return (unprefixed ? `/${rest}` : `/${locale}/${rest}`) + suffix
}

// Used in the LanguageSwitcher and SeoHreflangs components. Prefix-only by construction:
// a path without a locale prefix (the default locale in 'prefix-except-default') comes
// back unchanged; `localizedPath` covers both modes.
export function replaceLocaleInPath(currentPath: string, currentLocale: string, newLocale: string): string {
  const prefixRegex = new RegExp(`^/${currentLocale}/`)
  return currentPath.replace(prefixRegex, `/${newLocale}/`)
}

// Used in the LanguageSwitcher component. Prefix-only by construction: the first segment,
// which in 'prefix-except-default' is a content segment on a default-locale page.
export function getLangFromUrl(pathname: string) {
  // Remove leading/trailing slashes: '/en/about/' -> 'en/about'
  const cleaned = pathname.replace(/^\/+|\/+$/g, '')
  const [lang] = cleaned.split('/')
  return lang
}

// Converts a URL locale code to an IETF BCP 47 language tag.
// Used for the HTML lang attribute and hreflang values. After the language, each subtag
// is cased by its length: 2 letters (a region) upper, 4 letters (a script) title case,
// anything else (`419`) as is.
// 'pt-br' → 'pt-BR', 'zh-hant-tw' → 'zh-Hant-TW', 'en' → 'en'
export function toIetfTag(locale: string): string {
  const [lang = '', ...subtags] = locale.split('-')
  const cased = subtags.map((subtag) => {
    if (/^[a-z]{2}$/i.test(subtag)) return subtag.toUpperCase()
    if (/^[a-z]{4}$/i.test(subtag)) return subtag[0]!.toUpperCase() + subtag.slice(1).toLowerCase()
    return subtag
  })
  return [lang, ...cased].join('-')
}
