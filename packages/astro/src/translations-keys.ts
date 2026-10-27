import { I18N_CONFIG } from './config'
import type { Locale } from './constants'
import { formatTranslationCacheUrl, formatTranslationKvKey } from './key-format'
import type { Namespace } from './schema'

/**
 * Single source of truth for translation KV key construction.
 *
 * Used by both:
 *   - fetcher.ts (runtime: cache.match / cache.put)
 *   - the CLI (build: KV bulk data), through the same `key-format.ts`
 *
 * Format: <I18N_CONFIG.keyPrefix>:<namespace>:<locale>
 */
export function buildTranslationKvKey(locale: Locale, ns: Namespace): string {
  return formatTranslationKvKey(I18N_CONFIG.keyPrefix, locale, ns)
}

/**
 * Single source of truth for translation cache URL construction.
 *
 * Used by both:
 *   - fetcher.ts (runtime: cache.match / cache.put)
 *   - the CLI (build: Cloudflare Purge API), through the same `key-format.ts`
 *
 * The URL uses a static, non-versioned structure. Cache invalidation is
 * handled explicitly via the Cloudflare Purge API in `edgekits-i18n migrate`
 * rather than by changing the key on every deploy.
 *
 * Format: https://<I18N_CONFIG.keyPrefix>/<encodeURIComponent(i18n:<locale>:<namespace>)>
 */
export function buildTranslationCacheUrl(locale: Locale, ns: Namespace): string {
  return formatTranslationCacheUrl(I18N_CONFIG.keyPrefix, locale, ns)
}

/**
 * Build a Cache API Request object from a translation cache URL.
 * The Cache API requires a Request object, not a plain string.
 */
export function buildTranslationCacheRequest(locale: Locale, ns: Namespace): Request {
  return new Request(buildTranslationCacheUrl(locale, ns))
}
