/**
 * The core's public types and config helpers, re-exported for this package's entries
 * (root, `./config`, `./runtime`), plus what only Astro needs: the `App.Locals` the
 * middleware fills. `I18nLocales` is the core's interface: augmenting it through either
 * entry (the integration's injected `locales.d.ts`) merges into that one declaration.
 */
import type { Locale } from '@edgekits/i18n-core'

export { DEFAULT_GENERATED_DIR, defineI18nConfig, localesOf } from '@edgekits/i18n-core'
export type {
  I18nBindings,
  I18nConfig,
  I18nLanguage,
  I18nLocales,
  Locale,
  LocaleOf,
  LocalesOf,
} from '@edgekits/i18n-core'

declare global {
  // Set by the i18n middleware on every request.
  namespace App {
    interface Locals {
      uiLocale: Locale
      translationLocale: Locale
      isMissingContent?: boolean
    }
  }
}
