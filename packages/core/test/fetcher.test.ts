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
      if (options.kvThrows) throw new Error('KV unavailable')
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
    async put(request, response) {
      cacheCalls.push(`put ${request.url}`)
      puts.push({ url: request.url, body: await response.json(), headers: Object.fromEntries(response.headers) })
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
  return { i18n, kvCalls, cacheCalls, puts, scheduled }
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

test('a cache hit is merged with a newer fallback key (ADR-0014)', async () => {
  const { i18n, kvCalls } = setup({
    cached: { [cacheUrl('common')]: { title: 'Hallo' } },
    fallbacks: { FALLBACK_COMMON: { title: 'Hello', added: 'New key' } },
  })

  assert.deepEqual(await i18n.fetchTranslations('de', ['common']), { common: { title: 'Hallo', added: 'New key' } })
  assert.deepEqual(kvCalls, [])
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
