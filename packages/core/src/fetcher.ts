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

// The most keys one KV bulk read accepts.
const KV_BATCH_LIMIT = 100

// A value read from KV: a year, until `migrate` purges it. A key KV does not have (a locale
// without that namespace): a `null` marker for a minute, so a later `seed` shows without a purge.
const CACHE_CONTROL_VALUE = 'public, s-maxage=31536000, immutable'
const CACHE_CONTROL_MISSING = 'public, s-maxage=60'

// The fetcher's mark on its own entries. The cache URL sits on a hostname of the site's zone,
// so a response something else left at that URL is a miss, never read as translations.
// The value is the entry format, as in the URL (`i18n:v2:…`).
const ENTRY_MARKER = 'X-EdgeKits-I18n'
const ENTRY_FORMAT = 'v2'

export function createFetchTranslations<L extends string>({
  fallbacks: FALLBACKS,
  bindings,
  buildTranslationKvKey,
  buildTranslationCacheRequest,
}: FetcherInputs<L>) {
  /**
   * Fetch translations from KV for a given locale and list of namespaces.
   *
   * Cache strategy — per-namespace cache keys, versioned by entry format:
   *
   * Each namespace is cached individually under
   *   https://<keyPrefix>/<encodeURIComponent(i18n:v2:<locale>:<ns>)>
   *
   * An entry holds what KV holds: the raw value of the namespace's key, or a `null`
   * marker when KV has none (cached for 60 s). Never the merged namespace: the
   * compiled fallback is merged on every read, so a fallback change reaches every
   * locale on the next deploy (ADR-0033). Each entry carries `X-EdgeKits-I18n: v2`; a
   * response at the URL without it is a miss, read again from KV and replaced.
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
   *   Missing namespaces collected → KV bulk reads of at most 100 keys, in
   *   parallel → merge with FALLBACK_* → individual cache.put() of the raw value
   *   per namespace → return.
   *
   * Every namespace — cached or freshly read — is assembled through
   * assembleNamespace(), so a cache HIT is merged with FALLBACK_* exactly like a
   * miss: a newer fallback key shows as default-locale text instead of `undefined`
   * (ADR-0014).
   *
   * KV unavailable (per bulk read):
   *   That read's namespaces fall back to FALLBACK_* compiled dictionaries (always
   *   available), and none of them is cached: only values read from KV are written
   *   to the cache. If none were generated, returns empty objects — no crash.
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
          if (cached?.headers.get(ENTRY_MARKER) === ENTRY_FORMAT) {
            return { ns, data: await cached.json(), hit: true }
          }
          if (cached) debug(`i18n cache entry for ${ns} lacks ${ENTRY_MARKER}: treated as a miss`)
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
        // The raw KV value (or a null marker: the fallback alone), merged with the
        // current FALLBACK_* like a miss (ADR-0014, ADR-0033).
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
    // 3. Batched KV reads for missing namespaces only
    // ---------------------------------------------------------------------------

    const missingKvKeys = missingNamespaces.map((ns) => buildTranslationKvKey(locale, ns))

    const { values: kvResults, failed: failedKvKeys } = await readKv(missingKvKeys)

    // ---------------------------------------------------------------------------
    // 4. Assemble missing namespaces + schedule individual cache writes
    // ---------------------------------------------------------------------------

    const putPromises: Promise<void>[] = []

    for (let i = 0; i < missingNamespaces.length; i++) {
      const ns = missingNamespaces[i] as N
      const kvKey = missingKvKeys[i] as string
      const kvFailed = failedKvKeys.has(kvKey)

      // The KV value, or null when KV has none or its read failed (the fallback fills it)
      const kvValue = kvFailed ? null : (kvResults.get(kvKey) ?? null)

      // Merge with FALLBACK_* compiled dictionary if present
      const fallback = getFallback(ns)

      if (kvFailed && !fallback) {
        debug(`i18n namespace "${ns}" unavailable: KV failed and no fallback`)
      }

      ;(finalData as any)[ns] = assembleNamespace(kvValue, fallback)

      // Only what KV answered is cached. After a KV failure there is no answer: a null
      // marker would hide the namespace's real value for a minute.
      if (kvFailed) continue

      // Cache the raw KV value, never the merged namespace: the fallback is merged on
      // every read. A value lives until the Purge API removes it, a missing key's null
      // marker for a minute.
      const cacheRequest = buildTranslationCacheRequest(locale, ns)
      const response = new Response(JSON.stringify(kvValue), {
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': kvValue === null ? CACHE_CONTROL_MISSING : CACHE_CONTROL_VALUE,
          [ENTRY_MARKER]: ENTRY_FORMAT,
        },
      })

      putPromises.push(
        cache.put(cacheRequest, response).catch((error: unknown) => {
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
    if (failedKvKeys.size > 0) {
      debug('i18n cache PUT skipped where KV failed: the fallbacks are not cached', { locale, failedKvKeys })
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

    const { values: kvResults, failed: failedKvKeys } = await readKv(keys)

    const data: Partial<PickSchema<N>> = {}

    for (let i = 0; i < namespaces.length; i++) {
      const ns = namespaces[i] as N
      const key = keys[i] as string
      // A namespace whose read failed gets its compiled fallback alone (a copy, as every
      // assembled namespace is).
      const kvValue = failedKvKeys.has(key) ? null : (kvResults.get(key) ?? null)
      ;(data as any)[ns] = assembleNamespace(kvValue, getFallback(ns))
    }

    return data as PickSchema<N>
  }

  /**
   * Read `keys` from KV in bulk reads of at most KV_BATCH_LIMIT keys, in parallel. A read
   * that throws marks its own keys failed; the other reads' values still arrive.
   */
  async function readKv(keys: readonly string[]): Promise<{ values: Map<string, unknown>; failed: Set<string> }> {
    const batches: string[][] = []
    for (let i = 0; i < keys.length; i += KV_BATCH_LIMIT) {
      batches.push(keys.slice(i, i + KV_BATCH_LIMIT))
    }

    const values = new Map<string, unknown>()
    const failed = new Set<string>()

    await Promise.all(
      batches.map(async (batch) => {
        try {
          for (const [key, value] of await bindings.kv.get(batch, KV_JSON_OPTIONS)) values.set(key, value)
          debug('i18n KV batch OK', { keys: batch.length })
        } catch (error) {
          for (const key of batch) failed.add(key)
          debug('i18n KV ERROR, using FALLBACK_* for this batch', error)
        }
      }),
    )

    return { values, failed }
  }

  /**
   * Look up the compiled FALLBACK_* dictionary for a namespace, if one was generated.
   */
  function getFallback(ns: Namespace): unknown {
    return FALLBACKS[fallbackIdentifier(String(ns))]
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
