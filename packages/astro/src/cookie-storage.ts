import { type AstroCookies } from 'astro'

import { I18N_CONFIG } from './config'
import { LocaleSchema } from './schema'
import type { Locale } from './constants'
import { LANG_COOKIE_NAME } from './constants'

// The lang cookie is a preference, not a secret, and it has two writers: the
// LanguageSwitcher's client script (`document.cookie`) and the middleware's URL-wins
// sync. Hence `httpOnly: false`: an httpOnly copy set here could never be overwritten
// by the switcher again, and a stale value would disable it for good. The server only
// reads the value through LocaleSchema, never trusts it. `?.`: plain Node (the tests)
// has no `import.meta.env`.
export function setCookieLang(cookies: AstroCookies, locale: Locale) {
  cookies.set(LANG_COOKIE_NAME, locale, {
    path: '/',
    httpOnly: false,
    secure: import.meta.env?.PROD === true,
    sameSite: 'lax',
    maxAge: I18N_CONFIG.cookie.maxAge,
  })
}

export type CookieLang = {
  // A lang cookie came with the request, whatever its value.
  present: boolean
  // Its value when it is a supported locale, otherwise null.
  locale: Locale | null
}

export function readCookieLang(cookies: AstroCookies): CookieLang {
  const entry = cookies.get(LANG_COOKIE_NAME)
  if (!entry) return { present: false, locale: null }

  const result = LocaleSchema.safeParse(entry.value)
  if (result.success) return { present: true, locale: result.data }

  if (import.meta.env?.PROD !== true) {
    console.warn(`Invalid cookie "${LANG_COOKIE_NAME}"`, result.error.issues)
  }

  return { present: true, locale: null }
}

export function getCookieLang(cookies: AstroCookies): Locale | null {
  return readCookieLang(cookies).locale
}
