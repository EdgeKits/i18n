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

// The cache entry format: `v2` entries hold the raw KV value (ADR-0033). 0.2.x wrote merged
// namespaces under the unversioned `i18n:<locale>:<namespace>`, which is never read again.
const CACHE_FORMAT = 'v2'

// Format: https://<keyPrefix>/<encodeURIComponent(i18n:v2:<locale>:<namespace>)>
export function formatTranslationCacheUrl(keyPrefix: string, locale: string, ns: string): string {
  const cacheId = `i18n:${CACHE_FORMAT}:${locale}:${ns}`
  return `https://${keyPrefix}/${encodeURIComponent(cacheId)}`
}

// Format: FALLBACK_<NAMESPACE>, upper-cased, every `.` as `__` (`app.billing` ->
// `FALLBACK_APP__BILLING`). The CLI exports each compiled fallback under this name and the
// fetcher looks it up by the same call.
export function fallbackIdentifier(ns: string): string {
  return `FALLBACK_${ns.toUpperCase().replace(/\./g, '__')}`
}
