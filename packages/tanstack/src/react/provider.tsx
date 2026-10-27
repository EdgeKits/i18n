import type { I18nConfig, I18nLanguage, Locale, Namespace } from '@edgekits/i18n-core'
import { createContext, useContext, useMemo, type ReactNode } from 'react'

export type I18nLanguages = Readonly<Partial<Record<Locale, I18nLanguage>>>

export type I18nCookie = Readonly<I18nConfig['cookie']>

// One namespace's object: its schema type once the CLI has generated one, a plain record
// before (as the core's `Namespace`/`PickSchema` fall back on an empty `I18n.Schema`).
export type NamespaceTranslations<N extends Namespace> = N extends keyof I18n.Schema
  ? I18n.Schema[N]
  : Record<string, unknown>

type I18nContextValue = {
  locale: Locale
  languages: I18nLanguages
  translations: Readonly<Record<string, unknown>>
  cookie: I18nCookie | undefined
}

const I18nContext = createContext<I18nContextValue | null>(null)

export type I18nProviderProps = {
  // Required on the outermost provider; an inner one inherits it.
  locale?: Locale
  // A loader's `translations`, keyed by namespace: an inner provider's are merged over the
  // ones above it.
  translations: Readonly<Record<string, unknown>>
  // `localesOf(config).LANGUAGES`, given once at the root; the switcher's list.
  languages?: I18nLanguages
  // `config.cookie`, given once at the root; the switcher writes the lang cookie with it.
  cookie?: I18nCookie
  children?: ReactNode
}

/**
 * The translations a route's loader returned, for the components below it. Providers nest:
 * the root route gives `common` (with `languages` and `cookie`), a page its own namespaces.
 */
export function I18nProvider({ locale, translations, languages, cookie, children }: I18nProviderProps) {
  const outer = useContext(I18nContext)
  const resolvedLocale = locale ?? outer?.locale
  if (resolvedLocale === undefined) {
    throw new Error('[@edgekits/tanstack-i18n] the outermost I18nProvider needs a `locale`')
  }

  const value = useMemo<I18nContextValue>(
    () => ({
      locale: resolvedLocale,
      languages: languages ?? outer?.languages ?? {},
      translations: outer ? { ...outer.translations, ...translations } : translations,
      cookie: cookie ?? outer?.cookie,
    }),
    [resolvedLocale, languages, cookie, translations, outer],
  )

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

function useI18nContext(): I18nContextValue {
  const value = useContext(I18nContext)
  if (!value) throw new Error('[@edgekits/tanstack-i18n] no I18nProvider above this component')
  return value
}

export function useI18n(): Pick<I18nContextValue, 'locale' | 'languages' | 'translations'> {
  const { locale, languages, translations } = useI18nContext()
  return { locale, languages, translations }
}

// The switcher's cookie settings; not part of `useI18n`.
export function useI18nCookie(): I18nCookie | undefined {
  return useI18nContext().cookie
}

/** One namespace a route loader above this component has loaded. */
export function useT<N extends Namespace>(namespace: N): NamespaceTranslations<N> {
  const translations = useI18nContext().translations[namespace]
  if (translations === undefined) {
    throw new Error(
      `[@edgekits/tanstack-i18n] namespace "${namespace}" is not loaded by a route loader above this component`,
    )
  }
  return translations as NamespaceTranslations<N>
}
