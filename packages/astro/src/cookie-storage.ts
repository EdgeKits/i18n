import { type AstroCookies } from 'astro'
import type { CookieJar } from '@edgekits/i18n-core'

import { i18n } from './instance'
import { LocaleSchema } from './schema'
import type { Locale } from './constants'
import { LANG_COOKIE_NAME } from './constants'

// The core's lang-cookie helpers (cookie.ts there: why the cookie is not httpOnly) over
// Astro's cookies. `?.`: plain Node (the tests) has no `import.meta.env`.
function jar(cookies: AstroCookies): CookieJar {
  return {
    get: (name) => cookies.get(name)?.value,
    set: (name, value, options) => cookies.set(name, value, options),
  }
}

export function setCookieLang(cookies: AstroCookies, locale: Locale) {
  i18n.setCookieLang(jar(cookies), locale, { secure: import.meta.env?.PROD === true })
}

export type CookieLang = {
  // A lang cookie came with the request, whatever its value.
  present: boolean
  // Its value when it is a supported locale, otherwise null.
  locale: Locale | null
}

export function readCookieLang(cookies: AstroCookies): CookieLang {
  return i18n.readCookieLang(jar(cookies), { onInvalid: warnInvalidCookie })
}

export function getCookieLang(cookies: AstroCookies): Locale | null {
  return readCookieLang(cookies).locale
}

function warnInvalidCookie(value: string): void {
  if (import.meta.env?.PROD !== true) {
    console.warn(`Invalid cookie "${LANG_COOKIE_NAME}"`, LocaleSchema.safeParse(value).error?.issues)
  }
}
