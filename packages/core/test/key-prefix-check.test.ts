import assert from 'node:assert/strict'
import test from 'node:test'

import { keyPrefixZoneWarning } from '../src/cli/key-prefix-check.ts'
import { readZoneName } from '../src/cli/zone.ts'

/**
 * The Purge API answers `success: true` for a URL on another proxied zone, so `migrate`
 * can only compare the keyPrefix with the zone's name (probe of 2026-10-18).
 */

test('keyPrefixZoneWarning: the zone itself, a subdomain, any case, or a dotless name pass', () => {
  assert.equal(keyPrefixZoneWarning('edgekits.dev', 'edgekits.dev'), null)
  assert.equal(keyPrefixZoneWarning('www.edgekits.dev', 'edgekits.dev'), null)
  assert.equal(keyPrefixZoneWarning('EdgeKits.dev', 'edgekits.dev'), null)
  assert.equal(keyPrefixZoneWarning(' edgekits.dev ', 'EDGEKITS.DEV '), null)
  assert.equal(keyPrefixZoneWarning('astro-edgekits-core', 'edgekits.dev'), null)
})

test('keyPrefixZoneWarning: a dotted hostname outside the zone warns, on a label boundary', () => {
  for (const keyPrefix of ['other.example', 'edgekits.dev.evil.com', 'notedgekits.dev']) {
    const warning = keyPrefixZoneWarning(keyPrefix, 'edgekits.dev')
    assert.ok(warning, keyPrefix)
    assert.ok(warning.includes(`"${keyPrefix}"`), warning)
    assert.match(warning, /answers success either way/)
    assert.match(warning, /without a dot/)
  }
})

const respond =
  (body: unknown, status = 200) =>
  async () =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

test('readZoneName: result.name on 2xx; any failure is an error, never a throw', async () => {
  const calls: Array<[string, RequestInit]> = []
  const ok = async (input: string, init: RequestInit) => {
    calls.push([input, init])
    return respond({ success: true, result: { name: 'edgekits.dev' } })()
  }
  assert.deepEqual(await readZoneName('zone1', 'tok', { fetch: ok }), { name: 'edgekits.dev' })
  assert.equal(calls[0]![0], 'https://api.cloudflare.com/client/v4/zones/zone1')
  assert.deepEqual(calls[0]![1].headers, { Authorization: 'Bearer tok' })

  assert.deepEqual(await readZoneName('z', 't', { fetch: respond({ success: false }, 403) }), { error: 'HTTP 403' })
  assert.ok('error' in (await readZoneName('z', 't', { fetch: respond({ success: true, result: {} }) })))
  assert.ok('error' in (await readZoneName('z', 't', { fetch: async () => new Response('not json') })))
  const offline = async () => {
    throw new TypeError('fetch failed')
  }
  assert.deepEqual(await readZoneName('z', 't', { fetch: offline }), { error: 'fetch failed' })
})
