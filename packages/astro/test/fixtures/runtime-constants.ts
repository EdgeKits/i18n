// Stands in for the consumer's generated runtime-constants.ts in tests (tsconfig.test.json),
// matching the fixture config's locales.
export const NAMESPACE_KEYS = ['blog', 'common'] as [string, ...string[]]

export const LOCALES_WITH_TRANSLATIONS = ['de', 'en', 'es', 'ja'] as const

export const FULLY_TRANSLATED_LOCALES = ['en'] as const
