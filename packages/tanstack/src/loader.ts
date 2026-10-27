import type { Namespace, PickSchema } from '@edgekits/i18n-core'

import { resolveRequestLocale, type RequestI18n, type RequestLocaleOptions } from './request-locale.ts'

export type LoaderI18n<L extends string> = RequestI18n<L> & {
  fetchTranslations<N extends Namespace>(locale: L, namespaces: readonly N[]): Promise<PickSchema<N>>
}

export type LoadedTranslations<L extends string, N extends Namespace> = {
  locale: L
  translations: PickSchema<N>
}

/**
 * The body of the app's translations server function: the request's locale (the same
 * cascade as the middleware) and the namespaces asked for in it. The namespaces come from
 * the browser: validate them with `isNamespaceList` before they reach this. Repeats are
 * dropped here as well, for a caller that skips the validator.
 */
export function createTranslationsLoader<L extends string>(i18n: LoaderI18n<L>, options: RequestLocaleOptions = {}) {
  return async <N extends Namespace>(request: Request, namespaces: readonly N[]): Promise<LoadedTranslations<L, N>> => {
    const locale = await resolveRequestLocale(i18n, request, options)
    return { locale, translations: await i18n.fetchTranslations(locale, [...new Set(namespaces)]) }
  }
}
