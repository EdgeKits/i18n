import assert from 'node:assert/strict'
import test from 'node:test'

import { createI18n } from '../src/create-i18n.ts'
import type { Bindings, EdgeCache, TranslationsKv } from '../src/fetcher.ts'
import config from './fixtures/i18n.config.ts'

/**
 * The fetcher through `createI18n`, with in-memory stand-ins for the platform: a Map-backed
 * KV, a cache keyed by request URL, and a `waitUntil` that records what it is handed.
 * Pins the cache/KV algorithm: which branch reads what, how many KV round trips, which
 * namespaces are written back and how, and the fallback merge on hit and on miss.
 */

type Setup = {
  kv?: Record<string, unknown>
  cached?: Record<string, unknown>
  fallbacks?: Record<string, unknown>
  cacheEnabled?: boolean
  noCache?: boolean
  kvThrows?: boolean
  // Throws for the batches it returns true for, reads the others.
  kvThrowsFor?: (keys: string[]) => boolean
}

const RUNTIME_CONSTANTS = { NAMESPACE_KEYS: [], LOCALES_WITH_TRANSLATIONS: [], FULLY_TRANSLATED_LOCALES: [] }

const KEYS = createI18n(config, { fallbacks: {}, runtimeConstants: RUNTIME_CONSTANTS }, {} as Bindings)
const kvKey = (ns: string) => KEYS.buildTranslationKvKey('de', ns)
const cacheUrl = (ns: string) => KEYS.buildTranslationCacheUrl('de', ns)

function setup(options: Setup = {}) {
  const kvStore = new Map(Object.entries(options.kv ?? {}))
  const kvCalls: string[][] = []
  const kv: TranslationsKv = {
    async get(keys) {
      kvCalls.push(keys)
      if (options.kvThrows || options.kvThrowsFor?.(keys)) throw new Error('KV unavailable')
      return new Map(keys.map((key) => [key, kvStore.get(key) ?? null]))
    },
  }

  const cacheStore = new Map(Object.entries(options.cached ?? {}).map(([url, value]) => [url, JSON.stringify(value)]))
  const cacheCalls: string[] = []
  const puts: { url: string; body: unknown; headers: Record<string, string> }[] = []
  const cache: EdgeCache = {
    async match(request) {
      cacheCalls.push(`match ${request.url}`)
      const body = cacheStore.get(request.url)
      return body === undefined ? undefined : new Response(body)
    },
    // Stored as well as recorded, so a later call on the same instance sees what was written.
    async put(request, response) {
      cacheCalls.push(`put ${request.url}`)
      const body = await response.json()
      cacheStore.set(request.url, JSON.stringify(body))
      puts.push({ url: request.url, body, headers: Object.fromEntries(response.headers) })
    },
  }

  const scheduled: Promise<unknown>[] = []
  const bindings: Bindings = {
    kv,
    cache: options.noCache ? null : cache,
    waitUntil: (promise) => void scheduled.push(promise),
    cacheEnabled: options.cacheEnabled ?? true,
    debug: false,
  }

  const i18n = createI18n(config, { fallbacks: options.fallbacks ?? {}, runtimeConstants: RUNTIME_CONSTANTS }, bindings)
  return { i18n, kvCalls, cacheCalls, cacheStore, puts, scheduled }
}

test('full cache hit: every namespace from the cache, zero KV reads, nothing scheduled', async () => {
  const { i18n, kvCalls, cacheCalls, scheduled } = setup({
    cached: { [cacheUrl('common')]: { title: 'Hallo' }, [cacheUrl('blog')]: { heading: 'Blog' } },
  })

  const data = await i18n.fetchTranslations('de', ['common', 'blog'])

  assert.deepEqual(data, { common: { title: 'Hallo' }, blog: { heading: 'Blog' } })
  assert.deepEqual(kvCalls, [])
  assert.deepEqual(cacheCalls, [`match ${cacheUrl('common')}`, `match ${cacheUrl('blog')}`])
  assert.equal(scheduled.length, 0)
})

test('partial miss: one batched KV get for the missing namespaces, one put each through waitUntil', async () => {
  const { i18n, kvCalls, puts, scheduled } = setup({
    cached: { [cacheUrl('common')]: { title: 'Hallo' } },
    kv: { [kvKey('blog')]: { heading: 'Blog' }, [kvKey('nav')]: { home: 'Start' } },
  })

  const data = await i18n.fetchTranslations('de', ['common', 'blog', 'nav'])

  assert.deepEqual(data, { common: { title: 'Hallo' }, blog: { heading: 'Blog' }, nav: { home: 'Start' } })
  assert.deepEqual(kvCalls, [[kvKey('blog'), kvKey('nav')]])
  assert.equal(scheduled.length, 1, 'the writes go to waitUntil as one task')

  await Promise.all(scheduled)
  assert.deepEqual(
    puts.map((put) => [put.url, put.body]),
    [
      [cacheUrl('blog'), { heading: 'Blog' }],
      [cacheUrl('nav'), { home: 'Start' }],
    ],
  )
  for (const put of puts) {
    assert.equal(put.headers['cache-control'], 'public, s-maxage=31536000, immutable')
    assert.equal(put.headers['content-type'], 'application/json; charset=utf-8')
  }
})

test('a dotted namespace finds its compiled fallback under FALLBACK_APP__BILLING', async () => {
  const fallbacks = { FALLBACK_APP__BILLING: { plan: 'Pro', added: 'New key' } }

  const down = setup({ kvThrows: true, fallbacks })
  assert.deepEqual(await down.i18n.fetchTranslations('de', ['app.billing']), {
    'app.billing': { plan: 'Pro', added: 'New key' },
  })

  const miss = setup({ kv: { [kvKey('app.billing')]: { plan: 'Profi' } }, fallbacks })
  assert.deepEqual(await miss.i18n.fetchTranslations('de', ['app.billing']), {
    'app.billing': { plan: 'Profi', added: 'New key' },
  })
})

test('cacheEnabled false: KV only, the cache is never touched', async () => {
  const { i18n, kvCalls, cacheCalls, scheduled } = setup({
    cacheEnabled: false,
    cached: { [cacheUrl('common')]: { title: 'stale' } },
    kv: { [kvKey('common')]: { title: 'Hallo' } },
  })

  assert.deepEqual(await i18n.fetchTranslations('de', ['common']), { common: { title: 'Hallo' } })
  assert.deepEqual(kvCalls, [[kvKey('common')]])
  assert.deepEqual(cacheCalls, [])
  assert.equal(scheduled.length, 0)
})

test('cache null: KV only, nothing scheduled', async () => {
  const { i18n, kvCalls, scheduled } = setup({ noCache: true, kv: { [kvKey('common')]: { title: 'Hallo' } } })

  assert.deepEqual(await i18n.fetchTranslations('de', ['common']), { common: { title: 'Hallo' } })
  assert.deepEqual(kvCalls, [[kvKey('common')]])
  assert.equal(scheduled.length, 0)
})

test('KV throwing: the compiled fallbacks only, {} for a namespace without one', async () => {
  const fallbacks = { FALLBACK_COMMON: { title: 'Hello' } }

  const miss = setup({ kvThrows: true, fallbacks })
  assert.deepEqual(await miss.i18n.fetchTranslations('de', ['common', 'blog']), {
    common: { title: 'Hello' },
    blog: {},
  })

  const bypass = setup({ kvThrows: true, fallbacks, cacheEnabled: false })
  assert.deepEqual(await bypass.i18n.fetchTranslations('de', ['common', 'blog']), {
    common: { title: 'Hello' },
    blog: {},
  })
})

test('KV throwing: the fallbacks are served and never cached; a healthy KV later fills the cache', async () => {
  const fallbacks = { FALLBACK_COMMON: { title: 'Hello' } }
  // Read by the KV stand-in at call time: failing first, healthy after.
  const options: Setup = { kvThrows: true, fallbacks, kv: { [kvKey('common')]: { title: 'Hallo' } } }
  const { i18n, kvCalls, cacheStore, puts, scheduled } = setup(options)

  assert.deepEqual(await i18n.fetchTranslations('de', ['common']), { common: { title: 'Hello' } })
  assert.equal(scheduled.length, 0, 'waitUntil not called')
  await Promise.all(scheduled)
  assert.deepEqual(puts, [], 'no cache write after a KV failure')
  assert.equal(cacheStore.size, 0, 'the cache stays empty')

  options.kvThrows = false
  assert.deepEqual(await i18n.fetchTranslations('de', ['common']), { common: { title: 'Hallo' } })
  assert.deepEqual(kvCalls, [[kvKey('common')], [kvKey('common')]], 'a cache miss, so KV is read again')
  await Promise.all(scheduled)
  assert.deepEqual(
    puts.map(({ url, body }) => ({ url, body })),
    [{ url: cacheUrl('common'), body: { title: 'Hallo' } }],
  )
})

test('a cache hit is merged with a newer fallback key (ADR-0014)', async () => {
  const { i18n, kvCalls } = setup({
    cached: { [cacheUrl('common')]: { title: 'Hallo' } },
    fallbacks: { FALLBACK_COMMON: { title: 'Hello', added: 'New key' } },
  })

  assert.deepEqual(await i18n.fetchTranslations('de', ['common']), { common: { title: 'Hallo', added: 'New key' } })
  assert.deepEqual(kvCalls, [])
})

test('a cache entry holds the raw KV value: a later fallback change reaches the cached locale', async () => {
  const first = setup({
    kv: { [kvKey('common')]: { title: 'Hallo' } },
    fallbacks: { FALLBACK_COMMON: { title: 'Hello', footer: 'Old footer' } },
  })
  assert.deepEqual(await first.i18n.fetchTranslations('de', ['common']), {
    common: { title: 'Hallo', footer: 'Old footer' },
  })
  await Promise.all(first.scheduled)
  assert.deepEqual(
    first.puts.map(({ body }) => body),
    [{ title: 'Hallo' }],
    'the KV value, not the merged namespace',
  )

  // The next deploy: the same edge cache, a new compiled fallback.
  const next = setup({
    cached: { [cacheUrl('common')]: first.puts[0]!.body },
    fallbacks: { FALLBACK_COMMON: { title: 'Hello', footer: 'New footer' } },
  })
  assert.deepEqual(await next.i18n.fetchTranslations('de', ['common']), {
    common: { title: 'Hallo', footer: 'New footer' },
  })
  assert.deepEqual(next.kvCalls, [])
})

test('a namespace KV does not have: a null marker cached for 60 s, the fallback served on miss and hit', async () => {
  const { i18n, kvCalls, puts, scheduled } = setup({ fallbacks: { FALLBACK_BLOG: { heading: 'Blog' } } })

  assert.deepEqual(await i18n.fetchTranslations('de', ['blog']), { blog: { heading: 'Blog' } })
  await Promise.all(scheduled)
  assert.deepEqual(
    puts.map(({ url, body, headers }) => [url, body, headers['cache-control']]),
    [[cacheUrl('blog'), null, 'public, s-maxage=60']],
  )

  assert.deepEqual(await i18n.fetchTranslations('de', ['blog']), { blog: { heading: 'Blog' } })
  assert.deepEqual(kvCalls, [[kvKey('blog')]], 'the marker is a hit: no second KV read')
})

const MANY = Array.from({ length: 150 }, (_, i) => `ns${i}`)

test('150 namespaces: two KV reads of 100 and 50, with the cache and without', async () => {
  for (const options of [{}, { cacheEnabled: false }, { noCache: true }] satisfies Setup[]) {
    const { i18n, kvCalls } = setup({ ...options, kv: { [kvKey('ns149')]: { v: 'last' } } })

    const data = (await i18n.fetchTranslations('de', MANY)) as Record<string, unknown>

    assert.deepEqual(
      kvCalls.map((keys) => keys.length),
      [100, 50],
    )
    assert.deepEqual(kvCalls.flat(), MANY.map(kvKey))
    assert.deepEqual(data.ns149, { v: 'last' })
  }
})

test('a failing KV batch falls back for its own namespaces only, and caches none of them', async () => {
  const fallbacks = { FALLBACK_NS0: { v: 'fallback' }, FALLBACK_NS100: { v: 'fallback' } }
  const kv = { [kvKey('ns0')]: { v: 'first batch' }, [kvKey('ns100')]: { v: 'second batch' } }
  const kvThrowsFor = (keys: string[]) => keys.includes(kvKey('ns0'))

  for (const options of [{}, { cacheEnabled: false }] satisfies Setup[]) {
    const { i18n, puts, scheduled } = setup({ ...options, kv, fallbacks, kvThrowsFor })

    const data = (await i18n.fetchTranslations('de', MANY)) as Record<string, unknown>

    assert.deepEqual(data.ns0, { v: 'fallback' })
    assert.deepEqual(data.ns99, {})
    assert.deepEqual(data.ns100, { v: 'second batch' })
    await Promise.all(scheduled)
    assert.deepEqual(
      puts.map(({ url }) => url),
      options.cacheEnabled === false ? [] : MANY.slice(100).map(cacheUrl),
    )
  }
})

test('an entry under the 0.2.x cache URL is never looked up', async () => {
  const oldUrl = 'https://edgekits.dev/i18n%3Ade%3Acommon'
  const { i18n, cacheCalls, kvCalls } = setup({
    cached: { [oldUrl]: { title: 'a merged 0.2.x snapshot' } },
    kv: { [kvKey('common')]: { title: 'Hallo' } },
  })

  assert.deepEqual(await i18n.fetchTranslations('de', ['common']), { common: { title: 'Hallo' } })
  assert.deepEqual(cacheCalls.slice(0, 1), [`match ${cacheUrl('common')}`])
  assert.ok(cacheCalls.every((call) => !call.endsWith(` ${oldUrl}`)))
  assert.deepEqual(kvCalls, [[kvKey('common')]])
})

test('bindings are read at call time, never when the instance is created', async () => {
  const reads: string[] = []
  const kv: TranslationsKv = {
    get: async (keys) => new Map(keys.map((key) => [key, { title: 'Hallo' }])),
  }
  const bindings: Bindings = {
    get kv() {
      reads.push('kv')
      return kv
    },
    get cache() {
      reads.push('cache')
      return null
    },
    waitUntil: () => {},
    get cacheEnabled() {
      reads.push('cacheEnabled')
      return true
    },
    get debug() {
      return false
    },
  }

  const i18n = createI18n(config, { fallbacks: {}, runtimeConstants: RUNTIME_CONSTANTS }, bindings)
  assert.deepEqual(reads, [])

  await i18n.fetchTranslations('de', ['common'])
  assert.deepEqual(reads, ['cacheEnabled', 'cache', 'kv'])
})
