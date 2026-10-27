// ---------------------------------------------------------------------------
// keyPrefix against the purge zone
//
// Every cache URL is https://<keyPrefix>/..., and `migrate` purges those URLs from the
// zone CLOUDFLARE_ZONE_ID names. A URL a Worker cached is purged from the Worker's own
// zone when its hostname is no Cloudflare zone or a non-proxied one. A hostname that is
// an active proxied Cloudflare zone can be purged only from that zone, by its owner, and
// the Purge API answers `success: true` either way. The response cannot show the miss,
// so the only check left is the name. A proxied zone always has a dot: a dotless
// keyPrefix never collides with one.
// ---------------------------------------------------------------------------

/**
 * The warning `migrate` prints when `keyPrefix` is a dotted hostname outside `zoneName`,
 * or null when it is dotless, the zone name itself, or a subdomain of it (label
 * boundary, case-insensitive, both sides trimmed). Pure: no network, no `process`.
 */
export function keyPrefixZoneWarning(keyPrefix: string, zoneName: string): string | null {
  const host = keyPrefix.trim().toLowerCase()
  const zone = zoneName.trim().toLowerCase()

  if (!host.includes('.') || host === zone || host.endsWith(`.${zone}`)) return null

  return (
    `[i18n] ⚠️  keyPrefix "${keyPrefix.trim()}" is a hostname outside the zone the purge is issued against (${zoneName.trim()}).\n` +
    '        The Purge API answers success either way, so this run cannot tell whether the edge cache was purged.\n' +
    `        It is harmless only if "${keyPrefix.trim()}" is no proxied Cloudflare zone: a URL on a proxied zone\n` +
    '        can be purged only from that zone, by its owner. Fix: a keyPrefix inside the zone (its name or a\n' +
    '        subdomain), or a unique name without a dot.'
  )
}
