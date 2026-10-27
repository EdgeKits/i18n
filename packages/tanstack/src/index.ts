// `@edgekits/tanstack-i18n`, the server entry: no React, no TanStack. The Hono middleware
// for the Worker's chain, and the loader and validator the app's own server function wraps.
export { i18nMiddleware, type I18nVariables } from './middleware.ts'
export { createTranslationsLoader, type LoadedTranslations, type LoaderI18n } from './loader.ts'
export { isNamespaceList } from './namespaces.ts'
export type { RequestI18n, RequestLocaleOptions } from './request-locale.ts'
