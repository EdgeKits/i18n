import { env, waitUntil } from 'cloudflare:workers'
import * as fallbacksModule from 'virtual:@edgekits/astro-i18n/fallbacks'

import { assembleNamespace } from './assemble'
import { buildTranslationKvKey, buildTranslationCacheRequest } from './translations-keys'
import { parseBooleanFlag } from './parse-boolean'
import type { Locale } from './constants'
import type { Namespace, PickSchema } from './schema'
import type { I18nBindings } from './types'

// The bindings this module reads, typed by the package rather than the project's Env.
const i18nEnv = env as unknown as I18nBindings

// Optional fallbacks: the project's fallbacks.generated.ts if generated, otherwise an
// empty stub module (no FALLBACK_* exports), served by the integration's Vite plugin.
const FALLBACKS: Record<string, unknown> = fallbacksModule

const KV_JSON_OPTIONS = { type: 'json' as const }

/**
 * Fetch translations from KV for a given locale and list of namespaces.
 *
 * Cache strategy — per-namespace static cache keys:
 *
 * Each namespace is cached individually under a static (non-versioned) URL:
 *   https://<I18N_CONFIG.keyPrefix>/<encodeURIComponent(i18n:<locale>:<ns>)>
 *
 * Cache invalidation is handled explicitly by the Cloudflare Purge API
 * in `edgekits-i18n migrate` — only namespaces whose content actually changed
 * are purged, leaving untouched namespaces warm in the cache.
 *
 * Hot path (all namespaces cached):
 *   Parallel cache.match() for each namespace → all HIT → merge each with
 *   FALLBACK_* → return immediately. Zero KV reads.
 *
 * Partial or full cache miss:
 *   Missing namespaces collected → single KV getAll() batch →
 *   merge with FALLBACK_* → individual cache.put() per namespace → return.
 *
 * Every namespace — cached or freshly read — is assembled through
 * assembleNamespace(), so a cache HIT is merged with FALLBACK_* exactly like a
 * miss. An entry cached before a schema addition therefore degrades to
 * default-locale text for the keys it predates instead of yielding `undefined`
 * (ADR-0014).
 *
 * KV unavailable:
 *   Falls back to FALLBACK_* compiled dictionaries (always available).
 *   If none were generated, returns empty objects per namespace — no crash.
 */
export async function fetchTranslations<N extends Namespace>(
  locale: Locale,
  namespaces: readonly N[],
): Promise<PickSchema<N>> {
  const useCache = isCacheEnabled()

  if (!useCache) {
    debug('i18n cache DISABLED, using KV only', { locale, namespaces })
    return fetchAllFromKV(locale, namespaces)
  }

  const { cache } = getEdgeCache()

  if (!cache) {
    // `caches.default` absent (e.g. an untrusted Workers for Platforms namespace): read KV
    // directly. The package does not use `caches.open()`.
    debug('i18n caches.default absent, reading KV directly', {
      locale,
      namespaces,
    })
    return fetchAllFromKV(locale, namespaces)
  }

  // ---------------------------------------------------------------------------
  // 1. Check Cache API in parallel for each namespace individually
  // ---------------------------------------------------------------------------

  const cacheResults = await Promise.all(
    namespaces.map(async (ns) => {
      const cacheRequest = buildTranslationCacheRequest(locale, ns)
      try {
        const cached = await cache.match(cacheRequest)
        if (cached) {
          return { ns, data: await cached.json(), hit: true }
        }
      } catch (error) {
        debug(`i18n cache READ error for ${ns}`, error)
      }
      return { ns, data: null, hit: false }
    }),
  )

  // ---------------------------------------------------------------------------
  // 2. Separate hits from misses
  // ---------------------------------------------------------------------------

  const finalData: Partial<PickSchema<N>> = {}
  const missingNamespaces: N[] = []

  for (const { ns, data, hit } of cacheResults) {
    if (hit) {
      // Cached entries are merged with FALLBACK_* too. A namespace cached before
      // a schema addition is missing the newer keys; without this merge it would
      // reach pages as-is and any read of a new key would throw (ADR-0014).
      ;(finalData as any)[ns] = assembleNamespace(data, getFallback(ns))
    } else {
      missingNamespaces.push(ns)
    }
  }

  // All namespaces were in cache — return immediately, zero KV reads
  if (missingNamespaces.length === 0) {
    debug('i18n cache FULL HIT', { locale, namespaces })
    return finalData as PickSchema<N>
  }

  debug('i18n cache PARTIAL/FULL MISS', {
    locale,
    hit: namespaces.length - missingNamespaces.length,
    miss: missingNamespaces.length,
  })

  // ---------------------------------------------------------------------------
  // 3. Batch KV read for missing namespaces only
  // ---------------------------------------------------------------------------

  const missingKvKeys = missingNamespaces.map((ns) => buildTranslationKvKey(locale, ns))

  let kvResults = new Map<string, unknown | null>()
  let kvFailed = false

  try {
    kvResults = (await i18nEnv.TRANSLATIONS.get(missingKvKeys, KV_JSON_OPTIONS)) as Map<string, unknown | null>

    debug('i18n KV batch OK', { locale, missingNamespaces })
  } catch (error) {
    kvFailed = true
    debug('i18n KV ERROR, using FALLBACK_* for missing namespaces', error)
  }

  // ---------------------------------------------------------------------------
  // 4. Assemble missing namespaces + schedule individual cache writes
  // ---------------------------------------------------------------------------

  const putPromises: Promise<void>[] = []

  for (let i = 0; i < missingNamespaces.length; i++) {
    const ns = missingNamespaces[i] as N
    const kvKey = missingKvKeys[i] as string

    // Use KV value if available, otherwise empty object (fallback will fill it)
    const kvValue = kvFailed ? {} : ((kvResults.get(kvKey) as object) ?? {})

    // Merge with FALLBACK_* compiled dictionary if present
    const fallback = getFallback(ns)

    const nsData = assembleNamespace(kvValue, fallback)

    if (kvFailed && !fallback) {
      debug(`i18n namespace "${ns}" unavailable: KV failed and no fallback`)
    }

    ;(finalData as any)[ns] = nsData

    // Cache the resolved namespace individually with a long TTL.
    // Invalidation is handled explicitly via Cloudflare Purge API —
    // no TTL-based expiry needed here.
    const cacheRequest = buildTranslationCacheRequest(locale, ns)
    const response = new Response(JSON.stringify(nsData), {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'public, s-maxage=31536000, immutable',
      },
    })

    putPromises.push(
      cache.put(cacheRequest, response.clone()).catch((error: unknown) => {
        const errorMsg = error instanceof Error ? error.message : String(error)
        debug(`i18n cache WRITE error for ${ns}`, errorMsg)
      }),
    )
  }

  // ---------------------------------------------------------------------------
  // 5. Schedule cache writes as background tasks
  // ---------------------------------------------------------------------------

  if (putPromises.length > 0) {
    // Top-level waitUntil (cloudflare:workers): same semantics as
    // ctx.waitUntil, no need to plumb an ExecutionContext through callers.
    // putPromises only exist when the Cache API is available, so this never
    // runs in plain `astro dev`.
    waitUntil(Promise.all(putPromises))

    debug('i18n cache PUT scheduled', { locale, missingNamespaces })
  }

  return finalData as PickSchema<N>
}

// ---------------------------------------------------------------------------
// KV helpers
// ---------------------------------------------------------------------------

/**
 * Fetch all requested namespaces directly from KV, bypassing the cache.
 * Used when caching is disabled or the Cache API is unavailable.
 */
async function fetchAllFromKV<N extends Namespace>(locale: Locale, namespaces: readonly N[]): Promise<PickSchema<N>> {
  const keys = namespaces.map((ns) => buildTranslationKvKey(locale, ns))

  let kvResults = new Map<string, unknown | null>()
  let kvFailed = false

  try {
    kvResults = (await i18nEnv.TRANSLATIONS.get(keys, KV_JSON_OPTIONS)) as Map<string, unknown | null>
  } catch (error) {
    kvFailed = true
    debug('i18n KV ERROR (cache bypassed), using FALLBACK_* for all namespaces', error)
  }

  if (kvFailed) {
    return buildFallbackOnly(namespaces)
  }

  const data: Partial<PickSchema<N>> = {}

  for (let i = 0; i < namespaces.length; i++) {
    const ns = namespaces[i]
    const kvValue = kvResults.get(keys[i] as string) as object | null
    ;(data as any)[ns] = assembleNamespace(kvValue, getFallback(ns as N))
  }

  return data as PickSchema<N>
}

/**
 * Look up the compiled FALLBACK_* dictionary for a namespace, if one was generated.
 */
function getFallback(ns: Namespace): unknown {
  return FALLBACKS[`FALLBACK_${String(ns).toUpperCase()}`]
}

/**
 * Build a payload using only FALLBACK_* compiled dictionaries.
 * Used when KV is completely unavailable.
 */
function buildFallbackOnly<N extends Namespace>(namespaces: readonly N[]): PickSchema<N> {
  const data: Partial<PickSchema<N>> = {}

  for (const ns of namespaces) {
    ;(data as any)[ns] = getFallback(ns) ?? {}
  }

  return data as PickSchema<N>
}

// ---------------------------------------------------------------------------
// Runtime helpers
// ---------------------------------------------------------------------------

/**
 * Narrow the global `caches` to the minimal shape this module needs.
 * (waitUntil comes straight from 'cloudflare:workers' — no ctx plumbing.)
 */
function getEdgeCache(): {
  cache: { match: any; put: any } | null
} {
  const cacheStorage = caches as { default?: { match: any; put: any } }

  return {
    cache: cacheStorage?.default ?? null,
  }
}

/**
 * Determine whether edge caching is enabled.
 *
 * Wrangler var:
 *   I18N_CACHE = "on" | "off" | "true" | "false" | "1" | "0"
 *
 * After adding the variable:
 *   - Update wrangler.jsonc / wrangler.toml or .dev.vars
 *   - Run: wrangler types (if the project generates its Env)
 */
function isCacheEnabled(): boolean {
  return parseBooleanFlag(i18nEnv.I18N_CACHE, /* defaultValue */ true)
}

/**
 * Debug logger controlled by a Wrangler variable.
 *
 * Wrangler var:
 *   DEBUG_I18N = "on" | "off" | "true" | "false" | "1" | "0"
 *
 * After adding the variable:
 *   - Update wrangler.jsonc / wrangler.toml or .dev.vars
 *   - Run: wrangler types (if the project generates its Env)
 */
function debug(...args: unknown[]): void {
  const enabled = parseBooleanFlag(i18nEnv.DEBUG_I18N, /* defaultValue */ false)
  if (!enabled) return

  // eslint-disable-next-line no-console
  console.log(...args)
}
