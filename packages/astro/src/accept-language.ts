/**
 * The Accept-Language step of the middleware's fallback cascade, read from the header
 * itself. Astro's own match is no substitute: it keeps only the tags that equal a
 * configured locale before choosing, so a regional tag (`es-MX`) never reaches a
 * language-part match. Pure: no Astro, no virtual module, no `cloudflare:`.
 */

export type AcceptLanguageEntry = { tag: string; q: number }

/**
 * The header's language ranges, highest `q` first (header order among equals). A missing
 * or unparsable `q` is 1; `q=0` entries and the `*` wildcard are dropped.
 */
export function parseAcceptLanguage(header: string | null): AcceptLanguageEntry[] {
  if (!header) return []

  const entries: AcceptLanguageEntry[] = []
  for (const part of header.split(',')) {
    const [rawTag = '', ...params] = part.split(';')
    const tag = rawTag.trim()
    if (!tag || tag === '*') continue

    let q = 1
    for (const param of params) {
      const [name, value] = param.split('=').map((s) => s.trim())
      if (name?.toLowerCase() !== 'q' || value === undefined) continue
      const parsed = Number.parseFloat(value)
      if (!Number.isNaN(parsed)) q = parsed
    }
    if (q <= 0) continue

    entries.push({ tag, q })
  }

  // Array.prototype.sort is stable: equal q keeps header order.
  return entries.sort((a, b) => b.q - a.q)
}

/**
 * The first supported locale the header names: for each tag in `q` order, the full tag
 * (lowercased), then its language subtag (before the first `-` or `_`). Null when none.
 */
export function matchAcceptLanguage<L extends string>(
  header: string | null,
  parseLocale: (value: unknown) => L | null,
): L | null {
  for (const { tag } of parseAcceptLanguage(header)) {
    const lower = tag.toLowerCase()
    const full = parseLocale(lower)
    if (full) return full

    const language = parseLocale(lower.split(/[-_]/)[0])
    if (language) return language
  }
  return null
}
