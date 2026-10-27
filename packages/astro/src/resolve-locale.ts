import type { AstroGlobal } from 'astro'

import { i18n } from './instance'
import { LocaleSchema } from './schema'
import type { Locale } from './constants'
import { DEFAULT_LOCALE } from './constants'

/**
 * Optional: which “missing translation” banner to show ('ui' or 'content'), or null for
 * none, when uiLocale has no translations or (blog) content is missing in the required
 * language. Translation locale: what is actually loaded from KV, the default locale when
 * there is no bundle for the UI locale. Both are the core's (`createI18n`).
 */
export const { checkMissingTranslation, resolveLocaleForTranslations } = i18n

/**
 * UI / routing locale:
 * - What user selected
 * - What is used for <html lang>, URL, etc.
 */
export function resolveLocale(Astro: AstroGlobal): Locale {
  const raw = Astro.currentLocale ?? DEFAULT_LOCALE
  const parsed = LocaleSchema.safeParse(raw)
  return parsed.success ? parsed.data : DEFAULT_LOCALE
}
