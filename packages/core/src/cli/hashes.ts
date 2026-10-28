import crypto from 'node:crypto'

import { formatTranslationCacheUrl, formatTranslationKvKey } from '../key-format.ts'
import type { CollectedData } from './generate.ts'

/**
 * Per-namespace content hashes, the change diff that drives the cache purge, and the
 * baseline file. Pure apart from hashing. The site's `scripts/bundle-translations.ts`
 * algorithm, with keys sorted by code point instead of `localeCompare` (same order for
 * lowercase ASCII keys; mixed-case keys hash differently once, ADR-0034).
 */

// One baseline: "<locale>:<namespace>" → content hash
export type HashMap = Record<string, string>

// `.i18n-hashes.json`: one baseline per KV namespace id, so migrates of two namespaces
// (production, staging) do not overwrite each other's (ADR-0034).
export type BaselineFile = Record<string, HashMap>

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value)
  }

  if (Array.isArray(value)) {
    return '[' + value.map(stableStringify).join(',') + ']'
  }

  // Code point order: the same on every machine, whatever its ICU data and locale.
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))

  return '{' + entries.map(([k, v]) => JSON.stringify(k) + ':' + stableStringify(v)).join(',') + '}'
}

export function computeHash(value: unknown): string {
  const json = stableStringify(value)
  return crypto.createHash('sha256').update(json).digest('hex').slice(0, 12)
}

/**
 * Hash every collected namespace and list the "<locale>:<namespace>" pairs whose hash
 * differs from the previous run (all of them when there is no previous run).
 */
export function diffHashes(
  collected: CollectedData,
  previousHashes: HashMap,
): { currentHashes: HashMap; changedKeys: string[] } {
  const currentHashes: HashMap = {}
  const changedKeys: string[] = []

  for (const [locale, namespaces] of Object.entries(collected)) {
    for (const [ns, json] of Object.entries(namespaces)) {
      const hashKey = `${locale}:${ns}`
      const hash = computeHash(json)
      currentHashes[hashKey] = hash

      if (previousHashes[hashKey] !== hash) {
        changedKeys.push(hashKey)
      }
    }
  }

  return { currentHashes, changedKeys }
}

/** KV keys of "<locale>:<namespace>" pairs (the removed ones, for the bulk delete). */
export function kvKeysFor(hashKeys: readonly string[], keyPrefix: string): string[] {
  return hashKeys.map((hashKey) => {
    const [locale, ns] = hashKey.split(':') as [string, string]
    return formatTranslationKvKey(keyPrefix, locale, ns)
  })
}

/** Purge API URLs for the changed "<locale>:<namespace>" pairs. */
export function purgeUrlsFor(changedKeys: readonly string[], keyPrefix: string): string[] {
  return changedKeys.map((hashKey) => {
    const [locale, ns] = hashKey.split(':') as [string, string]
    return formatTranslationCacheUrl(keyPrefix, locale, ns)
  })
}

/** Pairs in `previous` that `current` no longer has: translation files removed since. */
export function removedKeys(previous: HashMap, current: HashMap): string[] {
  return Object.keys(previous).filter((key) => !Object.hasOwn(current, key))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// The pre-0.3 shape: one flat baseline, every value a hash string.
function isFlatBaseline(file: Record<string, unknown>): boolean {
  const values = Object.values(file)
  return values.length > 0 && values.every((value) => typeof value === 'string')
}

/**
 * The baseline of KV namespace `kvId` in a parsed `.i18n-hashes.json` (`undefined`: no
 * file). A file in the old flat shape is the baseline of whatever `kvId` is asked for. With
 * no `kvId` (bundle, which reads no wrangler config) the only baseline the file holds, or
 * `undefined` when it holds several.
 */
export function readBaseline(file: unknown, kvId?: string): HashMap | undefined {
  if (!isRecord(file)) return {}
  if (isFlatBaseline(file)) return file as HashMap

  const baselines = file as BaselineFile
  if (kvId !== undefined) return baselines[kvId] ?? {}

  const ids = Object.keys(baselines)
  if (ids.length > 1) return undefined
  return ids.length === 1 ? baselines[ids[0]!] : {}
}

/** The file with `kvId`'s baseline replaced; an old flat file becomes `{ [kvId]: hashes }`. */
export function writeBaseline(file: unknown, kvId: string, hashes: HashMap): BaselineFile {
  if (!isRecord(file) || isFlatBaseline(file)) return { [kvId]: hashes }
  return { ...(file as BaselineFile), [kvId]: hashes }
}
