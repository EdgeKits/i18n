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
  // Called once when `userPreference` throws or rejects; the cascade then continues with no
  // preference. Absent: a `console.warn`, whatever DEBUG_I18N says (an application error
  // belongs in production logs).
  onUserPreferenceError?: (error: unknown, request: Request) => void
}

/**
 * The locale of a request, from the request alone: the middleware and the loader both call
 * this, so Hono's chain and TanStack's server functions (which cannot reach Hono's context)
 * give the same answer. The core's cascade without its country step: the lang cookie, then
 * `userPreference`, then Accept-Language, then the default locale.
 *
 * `userPreference` may be async, the core's cascade is not: it is awaited here, and only
 * when the cookie carries no valid locale. A hook that throws or rejects counts as no
 * preference (see `onUserPreferenceError`).
 *
 * The hook runs once per Request: the middleware and every loader of one request (the SSR
 * document's server functions get the same Request through getRequest()) share its answer,
 * and a failure is reported once. The first caller's options decide.
 */
export async function resolveRequestLocale<L extends string>(
  i18n: RequestI18n<L>,
  request: Request,
  options: RequestLocaleOptions = {},
): Promise<L> {
  // `getCookie` reads `c.req.raw` only: the loader has a Request and no Hono context.
  const cookieLocale = i18n.parseLocale(getCookie({ req: { raw: request } } as Context, i18n.LANG_COOKIE_NAME))
  const preferred = cookieLocale ? null : i18n.parseLocale((await readUserPreference(request, options)) ?? null)

  return i18n.resolveFallbackLocale({
    cookieLocale: () => cookieLocale,
    userPreference: () => preferred,
    acceptLanguage: () => request.headers.get('accept-language'),
    country: () => undefined,
  })
}

// One `userPreference` answer per Request, kept while the Request lives.
const preferences = new WeakMap<Request, Promise<string | null | undefined>>()

function readUserPreference(request: Request, options: RequestLocaleOptions): Promise<string | null | undefined> {
  let preference = preferences.get(request)
  if (!preference) {
    preference = callUserPreference(request, options)
    preferences.set(request, preference)
  }
  return preference
}

async function callUserPreference(request: Request, options: RequestLocaleOptions): Promise<string | null | undefined> {
  try {
    return await options.userPreference?.(request)
  } catch (error) {
    if (options.onUserPreferenceError) options.onUserPreferenceError(error, request)
    else console.warn('[@edgekits/tanstack-i18n] userPreference failed; falling back to Accept-Language', error)
    return null
  }
}
