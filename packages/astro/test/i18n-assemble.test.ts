import assert from 'node:assert/strict'
import test from 'node:test'

import { assembleNamespace } from '../src/assemble.ts'
import { deepMerge } from '../src/deep-merge.ts'
import { FALLBACK_BLOG } from './fixtures/fallbacks.ts'

/**
 * Guard for the 2026-07-18 `/en/blog/` 500 (colo ORD): a Cache API entry for the
 * `blog` namespace written BEFORE the `pagination` keys existed was returned raw
 * by `fetchTranslations`, so `blog.pagination.previous` was `undefined` and the
 * page threw.
 *
 * These tests pin the quantity the defect actually moves — KEY COMPLETENESS of the
 * value the fetcher hands to pages — not object identity. They exercise the pure
 * assembly seam (`assembleNamespace`), which the cache-HIT branch, the KV/miss
 * branch and `fetchAllFromKV` all route through.
 */

type Dict = Record<string, unknown>

function isPlainObject(value: unknown): value is Dict {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Collect every LEAF key path (dot-separated) reachable in a dictionary. */
function leafKeyPaths(value: unknown, prefix = ''): string[] {
  if (!isPlainObject(value)) return prefix ? [prefix] : []

  return Object.entries(value).flatMap(([key, child]) => leafKeyPaths(child, prefix ? `${prefix}.${key}` : key))
}

/** Read a dot-separated path without throwing on missing intermediate objects. */
function readPath(value: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, key) => (isPlainObject(acc) ? acc[key] : undefined), value)
}

/**
 * A pre-schema-change cache entry: a deep copy of the compiled fallback with the
 * whole `pagination` subtree removed, exactly as an entry cached before those keys
 * were added would look.
 */
function staleBlogCacheEntry(): Dict {
  const stale = structuredClone(FALLBACK_BLOG) as Dict
  delete stale.pagination
  return stale
}

test('cache HIT: a stale entry still yields every key path the fallback defines', () => {
  const stale = staleBlogCacheEntry()

  // Precondition: the synthetic entry really is missing the keys that crashed.
  assert.equal(readPath(stale, 'pagination.previous'), undefined, 'fixture should be missing pagination')

  const assembled = assembleNamespace(stale, FALLBACK_BLOG)

  const missing = leafKeyPaths(FALLBACK_BLOG).filter((path) => readPath(assembled, path) === undefined)

  assert.deepEqual(missing, [], `assembled namespace is missing key paths: ${missing.join(', ')}`)
})

test('cache HIT: fresh cached values win over fallback values where both exist', () => {
  const cached = { ...staleBlogCacheEntry(), heading: 'Blog (de)', seo: { title: 'Titel (de)' } }

  const assembled = assembleNamespace(cached, FALLBACK_BLOG) as Dict

  assert.equal(readPath(assembled, 'heading'), 'Blog (de)')
  assert.equal(readPath(assembled, 'seo.title'), 'Titel (de)')
  // Sibling key absent from the cached entry falls back rather than vanishing.
  assert.equal(readPath(assembled, 'seo.description'), FALLBACK_BLOG.seo.description)
  // And the subtree added after the entry was cached is filled in.
  assert.equal(readPath(assembled, 'pagination.previous'), FALLBACK_BLOG.pagination.previous)
})

test('tolerates null/undefined for either argument', () => {
  assert.deepEqual(assembleNamespace(null, null), {})
  assert.deepEqual(assembleNamespace(undefined, undefined), {})
  assert.deepEqual(assembleNamespace(null, FALLBACK_BLOG), FALLBACK_BLOG)
  assert.deepEqual(assembleNamespace({ heading: 'x' }, null), { heading: 'x' })
})

// Audit 2026-10-12 A08-1: a parsed KV value can carry `__proto__` as an own key.
test('deepMerge skips __proto__, constructor and prototype keys', () => {
  const overrides = JSON.parse(
    '{"__proto__": {"polluted": true}, "constructor": {"x": 1}, "prototype": "p", "title": "Hallo"}',
  ) as Record<string, unknown>

  const result = deepMerge({ title: 'Hello', nav: { home: 'Home' } } as Record<string, unknown>, overrides)

  assert.equal(Object.getPrototypeOf(result), Object.prototype)
  assert.equal((result as { polluted?: unknown }).polluted, undefined)
  assert.equal(result.constructor, Object)
  assert.equal(Object.hasOwn(result, 'prototype'), false)
  assert.deepEqual(result, { title: 'Hallo', nav: { home: 'Home' } })
  assert.equal(({} as { polluted?: unknown }).polluted, undefined, 'Object.prototype untouched')
})

test('arrays are values: an override replaces the whole list, no element merge', () => {
  const base = {
    tags: ['a', 'b', 'c'],
    items: [
      { q: 'Q1', a: 'A1' },
      { q: 'Q2', a: 'A2' },
    ],
    title: 'T',
  }
  const merged = assembleNamespace({ tags: ['x'], items: [{ q: 'F1' }] }, base) as typeof base

  assert.deepEqual(merged.tags, ['x'])
  assert.deepEqual(merged.items, [{ q: 'F1' }], 'no element-wise merge with the fallback list')
  assert.equal(merged.title, 'T')
  assert.deepEqual(base.tags, ['a', 'b', 'c'], 'the fallback is not mutated')

  const kept = assembleNamespace({ title: 'U' }, base) as typeof base
  assert.deepEqual(kept.tags, ['a', 'b', 'c'], 'a list missing from the override comes from the fallback')
  assert.deepEqual(assembleNamespace({ tags: [] }, base), { ...base, tags: [] }, 'an empty list is a value too')
})
