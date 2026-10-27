import crypto from 'node:crypto'

import { formatTranslationCacheUrl } from '../key-format.ts'
import type { CollectedData } from './generate.ts'

/**
 * Per-namespace content hashes and the change diff that drives the cache purge.
 * Pure apart from hashing. Same algorithm as the site's `scripts/bundle-translations.ts`,
 * so an existing `.i18n-hashes.json` stays a valid baseline.
 */

// Persisted hash map: "<locale>:<namespace>" → content hash
export type HashMap = Record<string, string>

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value)
  }

  if (Array.isArray(value)) {
    return '[' + value.map(stableStringify).join(',') + ']'
  }

  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))

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

/** Purge API URLs for the changed "<locale>:<namespace>" pairs. */
export function purgeUrlsFor(changedKeys: readonly string[], keyPrefix: string): string[] {
  return changedKeys.map((hashKey) => {
    const [locale, ns] = hashKey.split(':') as [string, string]
    return formatTranslationCacheUrl(keyPrefix, locale, ns)
  })
}
