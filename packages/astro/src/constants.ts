import { I18N_CONFIG } from './config'
import { localesOf } from './config.entry'
import type { I18nLanguage, Locale } from './types'

export type { Locale }

export type Language = I18nLanguage

// Languages are configured in the project's edgekits-i18n.config.ts; the derivation is
// `localesOf` (config.entry.ts), shared with project code. Inside the package the config
// is not literal, so its keys are narrowed to the augmented `Locale` here.
const LOCALES = localesOf(I18N_CONFIG)

export const LANGUAGES = LOCALES.LANGUAGES as Record<Locale, Language>

// Locales Configuration
export const SUPPORTED_LOCALES = LOCALES.SUPPORTED_LOCALES as [Locale, ...Locale[]]

// export const SUPPORTED_LOCALES = ['en', 'de', 'es', 'pt-br', 'ja'] as const
export type SupportedLocales = (typeof SUPPORTED_LOCALES)[number]

// Default locale
export const DEFAULT_LOCALE: SupportedLocales = LOCALES.DEFAULT_LOCALE as Locale

// Missing translation banner flag
export const ENABLE_MISSING_TRANSLATION_BANNER = I18N_CONFIG.missingTranslationBanner

// Cookie name
export const LANG_COOKIE_NAME = I18N_CONFIG.cookie.name
