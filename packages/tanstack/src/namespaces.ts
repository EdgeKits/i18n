import type { Namespace } from '@edgekits/i18n-core'

/**
 * The validator for a server function's namespace list: true only for a non-empty array of
 * distinct strings, all in the generated `NAMESPACE_KEYS`, no longer than that list. The
 * input comes from the browser, so on false the server function rejects:
 *   - an unknown namespace must never reach a KV key;
 *   - the bounds keep one request to what a page can need. The list becomes one batched
 *     KV read (a Workers KV batch takes at most 100 keys; a longer one fails and the
 *     request is served from the compiled fallbacks) and one cache lookup and write per
 *     entry, so repeats and oversized lists would multiply a request's work for nothing.
 *     An empty list asks for nothing.
 */
export function isNamespaceList(i18n: { readonly NAMESPACE_KEYS: readonly string[] }) {
  const known = new Set(i18n.NAMESPACE_KEYS)

  return (data: unknown): data is Namespace[] =>
    Array.isArray(data) &&
    data.length > 0 &&
    data.length <= known.size &&
    new Set(data).size === data.length &&
    data.every((ns) => typeof ns === 'string' && known.has(ns))
}
