import { assembleNamespace } from './assemble.ts'
import { fallbackIdentifier } from './key-format.ts'
import type { Namespace, PickSchema } from './types.ts'

/** The KV namespace the translations live in: the batched JSON read is all the fetcher uses. */
export type TranslationsKv = {
  get(keys: string[], options: { type: 'json' }): Promise<Map<string, unknown>>
}

/** The edge cache (`caches.default` on Workers): match and put by Request. */
export type EdgeCache = {
  match(request: Request): Promise<Response | undefined>
  put(request: Request, response: Response): Promise<void>
}

/**
 * What the fetcher reads from the platform. Every property is read at call time, never
 * at creation: an adapter may hand in getters over request-scoped values (in Astro on
 * Workers, `env` is valid only inside a request).
 */
export type Bindings = {
  readonly kv: TranslationsKv
  // Null when the platform has no edge cache: the fetcher then reads KV directly.
  readonly cache: EdgeCache | null
  readonly waitUntil: (promise: Promise<unknown>) => void
  // `I18N_CACHE`: false reads KV on every call.
  readonly cacheEnabled: boolean
  // `DEBUG_I18N`: logs each branch the fetcher takes.
  readonly debug: boolean
}

export type FetcherInputs<L extends string> = {
  // Optional fallbacks: the project's fallbacks.generated.ts if generated, otherwise an
  // empty module (no FALLBACK_* exports).
  fallbacks: Record<string, unknown>
  bindings: Bindings
  buildTranslationKvKey: (locale: L, ns: Namespace) => string
  buildTranslationCacheRequest: (locale: L, ns: Namespace) => Request
}

const KV_JSON_OPTIONS = { type: 'json' as const }

export function createFetchTranslations<L extends string>({
  fallbacks: FALLBACKS,
  bindings,
  buildTranslationKvKey,
  buildTranslationCacheRequest,
}: FetcherInputs<L>) {
  /**
   * Fetch translations from KV for a given locale and list of namespaces.
   *
   * Cache strategy — per-namespace static cache keys:
   *
   * Each namespace is cached individually under a static (non-versioned) URL:
   *   https://<keyPrefix>/<encodeURIComponent(i18n:<locale>:<ns>)>
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
  async function fetchTranslations<N extends Namespace>(locale: L, namespaces: readonly N[]): Promise<PickSchema<N>> {
    const useCache = bindings.cacheEnabled

    if (!useCache) {
      debug('i18n cache DISABLED, using KV only', { locale, namespaces })
      return fetchAllFromKV(locale, namespaces)
    }

    const cache = bindings.cache

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
      kvResults = (await bindings.kv.get(missingKvKeys, KV_JSON_OPTIONS)) as Map<string, unknown | null>

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
      // The adapter's waitUntil (on Workers, the top-level one from `cloudflare:workers`:
      // same semantics as ctx.waitUntil, no ExecutionContext plumbed through callers).
      // putPromises only exist when an edge cache is available.
      bindings.waitUntil(Promise.all(putPromises))

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
  async function fetchAllFromKV<N extends Namespace>(locale: L, namespaces: readonly N[]): Promise<PickSchema<N>> {
    const keys = namespaces.map((ns) => buildTranslationKvKey(locale, ns))

    let kvResults = new Map<string, unknown | null>()
    let kvFailed = false

    try {
      kvResults = (await bindings.kv.get(keys, KV_JSON_OPTIONS)) as Map<string, unknown | null>
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
    return FALLBACKS[fallbackIdentifier(String(ns))]
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
   * Debug logger controlled by `bindings.debug` (on Workers, the `DEBUG_I18N` var:
   * "on" | "off" | "true" | "false" | "1" | "0", parsed by the adapter).
   */
  function debug(...args: unknown[]): void {
    const enabled = bindings.debug
    if (!enabled) return

    // eslint-disable-next-line no-console
    console.log(...args)
  }

  return fetchTranslations
}
