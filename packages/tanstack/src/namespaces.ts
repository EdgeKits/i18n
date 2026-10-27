import type { Namespace } from '@edgekits/i18n-core'

/**
 * The validator for a server function's namespace list: true only for an array of strings
 * that are all in the generated `NAMESPACE_KEYS`. The input comes from the browser, so an
 * unknown namespace must never reach a KV key: on false, the server function rejects.
 */
export function isNamespaceList(i18n: { readonly NAMESPACE_KEYS: readonly string[] }) {
  const known = new Set(i18n.NAMESPACE_KEYS)

  return (data: unknown): data is Namespace[] =>
    Array.isArray(data) && data.every((ns) => typeof ns === 'string' && known.has(ns))
}
