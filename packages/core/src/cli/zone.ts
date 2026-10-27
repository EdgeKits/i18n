import { keyPrefixZoneWarning } from './key-prefix-check.ts'

// ---------------------------------------------------------------------------
// Zone name lookup for the keyPrefix check (migrate only)
// ---------------------------------------------------------------------------

export type ZoneDeps = {
  fetch?: (input: string, init: RequestInit) => Promise<Response>
}

/**
 * Read the zone's name: `GET /zones/{zoneId}`, `result.name`. Needs Zone › Zone › Read
 * on the token. Never throws: any failure (non-2xx, network error, unexpected body)
 * comes back as `{ error }`.
 *
 * `deps` replaces `fetch` in tests.
 */
export async function readZoneName(
  zoneId: string,
  apiToken: string,
  deps: ZoneDeps = {},
): Promise<{ name: string } | { error: string }> {
  const { fetch: fetchFn = fetch } = deps

  try {
    const response = await fetchFn(`https://api.cloudflare.com/client/v4/zones/${zoneId}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiToken}` },
    })
    if (!response.ok) return { error: `HTTP ${response.status}` }

    const body = (await response.json()) as { result?: { name?: unknown } } | null
    const name = body?.result?.name
    if (typeof name !== 'string' || name.trim() === '') return { error: 'no result.name in the response' }

    return { name }
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * Print the keyPrefix warning when `keyPrefix` lies outside the zone, or one info line
 * when the zone name cannot be read. Advisory only: it returns nothing, and the purge
 * runs the same either way.
 */
export async function checkKeyPrefixZone(
  keyPrefix: string,
  zoneId: string,
  apiToken: string,
  deps: ZoneDeps = {},
): Promise<void> {
  const zone = await readZoneName(zoneId, apiToken, deps)

  if ('error' in zone) {
    console.log(
      `[i18n] ℹ️  Could not read the zone name (${zone.error}), so the keyPrefix check was skipped (needs Zone › Zone › Read on the token).`,
    )
    return
  }

  const warning = keyPrefixZoneWarning(keyPrefix, zone.name)
  if (warning) console.warn(warning)
}
