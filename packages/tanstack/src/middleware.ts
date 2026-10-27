import type { Locale } from '@edgekits/i18n-core'
import type { MiddlewareHandler } from 'hono'

import { resolveRequestLocale, type RequestI18n, type RequestLocaleOptions } from './request-locale.ts'

/** The middleware's variables, for the app's `new Hono<{ Variables: I18nVariables & … }>()`. */
export type I18nVariables<L extends string = Locale> = { locale: L }

/**
 * Sets `c.var.locale` from the request (see `resolveRequestLocale`) and hands on. It never
 * sets a cookie and never redirects: the URL carries no locale, and the lang cookie is
 * written by the language switcher alone.
 */
export function i18nMiddleware<L extends string>(
  i18n: RequestI18n<L>,
  options: RequestLocaleOptions = {},
): MiddlewareHandler<{ Variables: I18nVariables<L> }> {
  return async (c, next) => {
    c.set('locale', await resolveRequestLocale(i18n, c.req.raw, options))
    await next()
  }
}
