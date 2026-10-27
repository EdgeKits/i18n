import type { FallbackInputs } from '@edgekits/i18n-core'
import type { Context } from 'hono'
import { getCookie } from 'hono/cookie'

/**
 * What the server entry reads from the core's instance (`createI18n`), structurally: the
 * locale type `L` is inferred from it, so a literal config types `c.var.locale` and the
 * loader's `locale` with its own keys.
 */
export type RequestI18n<L extends string> = {
  readonly LANG_COOKIE_NAME: string
  parseLocale(value: unknown): L | null
  resolveFallbackLocale(inputs: FallbackInputs<L>): L
}

export type RequestLocaleOptions = {
  // The user's saved preference (an account setting, say), consulted after the cookie and
  // before Accept-Language. Returns a locale string or null; the value is parsed, never
  // trusted.
  userPreference?: (request: Request) => string | null | undefined | Promise<string | null | undefined>
}

/**
 * The locale of a request, from the request alone: the middleware and the loader both call
 * this, so Hono's chain and TanStack's server functions (which cannot reach Hono's context)
 * give the same answer. The core's cascade without its country step: the lang cookie, then
 * `userPreference`, then Accept-Language, then the default locale.
 *
 * `userPreference` may be async, the core's cascade is not: it is awaited here, and only
 * when the cookie carries no valid locale.
 */
export async function resolveRequestLocale<L extends string>(
  i18n: RequestI18n<L>,
  request: Request,
  options: RequestLocaleOptions = {},
): Promise<L> {
  // `getCookie` reads `c.req.raw` only: the loader has a Request and no Hono context.
  const cookieLocale = i18n.parseLocale(getCookie({ req: { raw: request } } as Context, i18n.LANG_COOKIE_NAME))
  const preferred = cookieLocale ? null : i18n.parseLocale((await options.userPreference?.(request)) ?? null)

  return i18n.resolveFallbackLocale({
    cookieLocale: () => cookieLocale,
    userPreference: () => preferred,
    acceptLanguage: () => request.headers.get('accept-language'),
    country: () => undefined,
  })
}
