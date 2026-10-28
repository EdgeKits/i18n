import { deepMerge } from './deep-merge.ts'

/**
 * Assemble a single translation namespace from a raw value and its compiled
 * fallback dictionary.
 *
 * This is the ONLY place namespace assembly happens: `fetchTranslations` routes
 * its cache-HIT branch, its cache-miss/KV branch and `fetchAllFromKV` through it,
 * so a cached namespace and a freshly read one can never diverge in shape.
 *
 * Semantics (unchanged from the original miss path):
 *   - the fallback provides the full known key set,
 *   - the raw value (cached entry or KV read) overrides it wherever it has a value,
 *   - `null` / `undefined` are tolerated for either argument.
 *
 * Consequence for stale cache entries: a namespace cached before a schema addition
 * degrades to default-locale text for the keys it predates instead of handing pages
 * `undefined` (see ADR-0014 and the 2026-07-18 `/en/blog/` incident).
 *
 * The result is the caller's own: the fallback is a module-level object shared by every
 * request in the isolate, so it is deep-copied first (`structuredClone`; deepMerge copies
 * only the levels the raw value overrides). A page that mutates what it was handed never
 * changes the next request's text.
 *
 * Deliberately pure — no `cloudflare:workers` imports, so it is testable under
 * plain Node (`npm test`).
 */
export function assembleNamespace(rawValue: unknown, fallback: unknown): object {
  const raw = (rawValue as object | null | undefined) ?? {}

  if (!fallback) return raw

  return deepMerge(structuredClone(fallback) as object, raw)
}
