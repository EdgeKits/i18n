/**
 * The lang cookie over a minimal jar, so any framework's cookie API can carry it: the
 * adapter wraps its own (Astro's `context.cookies`, say) and supplies the values the
 * core cannot know (the cookie settings, whether the response is served over HTTPS).
 */

export type CookieJar = {
  get(name: string): string | undefined
  set(
    name: string,
    value: string,
    options: { path: string; httpOnly: boolean; secure: boolean; sameSite: 'lax'; maxAge: number },
  ): void
}

export type CookieLang<L extends string> = {
  // A lang cookie came with the request, whatever its value.
  present: boolean
  // Its value when it is a supported locale, otherwise null.
  locale: L | null
}

export type CookieLangOptions<L extends string> = {
  // Returns the locale when the value is a supported one, otherwise null.
  parseLocale: (value: unknown) => L | null
  name: string
}

export type SetCookieLangOptions<L extends string> = CookieLangOptions<L> & {
  maxAge: number
  secure: boolean
}

export type ReadCookieLangOptions<L extends string> = CookieLangOptions<L> & {
  // Called with a present value that is not a supported locale (an adapter's dev warning).
  onInvalid?: (value: string) => void
}

// The lang cookie is a preference, not a secret, and it has two writers: the language
// switcher's client script (`document.cookie`) and the middleware's URL-wins sync. Hence
// `httpOnly: false`: an httpOnly copy set here could never be overwritten by the switcher
// again, and a stale value would disable it for good. The server only reads the value
// through `parseLocale`, never trusts it.
export function setCookieLang<L extends string>(jar: CookieJar, locale: L, options: SetCookieLangOptions<L>): void {
  jar.set(options.name, locale, {
    path: '/',
    httpOnly: false,
    secure: options.secure,
    sameSite: 'lax',
    maxAge: options.maxAge,
  })
}

export function readCookieLang<L extends string>(jar: CookieJar, options: ReadCookieLangOptions<L>): CookieLang<L> {
  const value = jar.get(options.name)
  if (value === undefined) return { present: false, locale: null }

  const locale = options.parseLocale(value)
  if (locale !== null) return { present: true, locale }

  options.onInvalid?.(value)

  return { present: true, locale: null }
}

export function getCookieLang<L extends string>(jar: CookieJar, options: ReadCookieLangOptions<L>): L | null {
  return readCookieLang(jar, options).locale
}
