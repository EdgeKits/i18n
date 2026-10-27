/**
 * The middleware's fallback cascade for a request whose URL carries no valid locale,
 * as a pure function: the request-bound inputs arrive as getters, so each one is read
 * exactly when, and only if, the cascade reaches it (same split as `env` in the fetcher).
 *
 * Order (unchanged from the middleware):
 *   1. the lang cookie, if valid;
 *   2. the Accept-Language header (the middleware passes the request header): each tag in
 *      `q` order, full tag, then its language part ('es-mx' -> 'es'); the first tag that
 *      names a supported locale wins (accept-language.ts);
 *   3. ONLY when no tag matched (or there is no header): the Cloudflare geo-IP country,
 *      through the project's `countryToLocale` table (skipped without one);
 *   4. the default locale.
 */

import { matchAcceptLanguage } from './accept-language'

export type FallbackInputs<L extends string> = {
  cookieLocale: () => L | null
  acceptLanguage: () => string | null
  country: () => unknown
}

export type FallbackOptions<L extends string> = {
  // Returns the locale when the value is a supported one, otherwise null.
  parseLocale: (value: unknown) => L | null
  defaultLocale: L
  countryToLocale?: Readonly<Record<string, string>>
}

export function resolveFallbackLocale<L extends string>(inputs: FallbackInputs<L>, options: FallbackOptions<L>): L {
  const cookieLocale = inputs.cookieLocale()
  if (cookieLocale) return cookieLocale

  const browser = matchAcceptLanguage(inputs.acceptLanguage(), options.parseLocale)
  if (browser) return browser

  if (options.countryToLocale) {
    // 3) Cloudflare Geo-IP Strategy
    // cf is undefined in local dev unless simulated
    const geo = options.parseLocale(mapCountryToLocale(inputs.country(), options.countryToLocale))
    if (geo) return geo
  }

  return options.defaultLocale
}

/**
 * Maps a Cloudflare country code (`request.cf.country`) to a locale through the
 * project's table. Returns undefined if the country is not in it.
 */
export function mapCountryToLocale(country: unknown, table: Readonly<Record<string, string>>): string | undefined {
  // Safety: In dev mode (localhost), 'country' might be null or undefined.
  if (typeof country !== 'string') return undefined

  // Cloudflare always sends uppercase (e.g., 'US', 'DE'), but safety first.
  return table[country.toUpperCase()]
}
