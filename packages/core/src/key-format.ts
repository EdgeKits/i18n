/**
 * The translation KV key and edge-cache URL formats, as pure functions of the key
 * prefix, and the compiled fallback's identifier. Shared by the runtime (`translations-keys.ts`, prefix from the virtual config)
 * and the CLI (prefix from the loaded config), so the key a value is stored under and
 * the URL a purge targets can never drift apart. Pinned by `test/i18n-keys.test.ts`.
 */

// Format: <keyPrefix>:<namespace>:<locale>
export function formatTranslationKvKey(keyPrefix: string, locale: string, ns: string): string {
  return `${keyPrefix}:${ns}:${locale}`
}

// Format: https://<keyPrefix>/<encodeURIComponent(i18n:<locale>:<namespace>)>
export function formatTranslationCacheUrl(keyPrefix: string, locale: string, ns: string): string {
  const cacheId = `i18n:${locale}:${ns}`
  return `https://${keyPrefix}/${encodeURIComponent(cacheId)}`
}

// Format: FALLBACK_<NAMESPACE>, upper-cased, every `.` as `__` (`app.billing` ->
// `FALLBACK_APP__BILLING`). The CLI exports each compiled fallback under this name and the
// fetcher looks it up by the same call.
export function fallbackIdentifier(ns: string): string {
  return `FALLBACK_${ns.toUpperCase().replace(/\./g, '__')}`
}
