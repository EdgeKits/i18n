import type { Locale } from '@edgekits/i18n-core'
import type { MiddlewareHandler } from 'hono'

import { resolveRequestLocale, type RequestI18n, type RequestLocaleOptions } from './request-locale.ts'

/** The middleware's variables, for the app's `new Hono<{ Variables: I18nVariables & … }>()`. */
export type I18nVariables<L extends string = Locale> = { locale: L }

// The request headers an HTML page's locale is chosen from (`userPreference` reads whatever
// the app keys it on, usually a session cookie).
const NEGOTIATED = ['Cookie', 'Accept-Language']

/**
 * Sets `c.var.locale` from the request (see `resolveRequestLocale`) and hands on. It never
 * sets a cookie and never redirects: the URL carries no locale, and the lang cookie is
 * written by the language switcher alone. An HTML response comes back with
 * `Vary: Cookie, Accept-Language` (merged with its own `Vary`): the same URL renders in
 * whichever locale those headers chose.
 */
export function i18nMiddleware<L extends string>(
  i18n: RequestI18n<L>,
  options: RequestLocaleOptions = {},
): MiddlewareHandler<{ Variables: I18nVariables<L> }> {
  return async (c, next) => {
    c.set('locale', await resolveRequestLocale(i18n, c.req.raw, options))
    await next()
    if (!(c.res.headers.get('Content-Type') ?? '').includes('text/html')) return
    try {
      varyOnNegotiated(c.res.headers)
    } catch {
      // Immutable headers (a response passed through from fetch()): vary on a copy.
      c.res = new Response(c.res.body, c.res)
      varyOnNegotiated(c.res.headers)
    }
  }
}

function varyOnNegotiated(headers: Headers): void {
  const vary = headers.get('Vary')
  const fields = (vary ?? '').split(',').map((field) => field.trim().toLowerCase())
  if (fields.includes('*')) return
  const missing = NEGOTIATED.filter((name) => !fields.includes(name.toLowerCase()))
  if (missing.length > 0) headers.set('Vary', [...(vary ? [vary] : []), ...missing].join(', '))
}
