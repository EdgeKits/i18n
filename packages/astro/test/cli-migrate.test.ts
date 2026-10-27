import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import test from 'node:test'

/**
 * `edgekits-i18n migrate` end to end, in a fake project under the OS temp dir: a stand-in
 * wrangler that exits 0, and a preloaded `fetch` that answers the zone lookup and the
 * purge from a script. No network. The keyPrefix check is advisory: a token without
 * Zone Read gets one info line, and the purge and the hash file go on as before.
 */

const ROOT = path.resolve(import.meta.dirname, '..')
const ZONE_ID = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'

type Scripted = { zone: { status: number; body: unknown }; purge: { status: number; body: unknown } }

function fakeProject(keyPrefix: string, scripted: Scripted): string {
  const root = mkdtempSync(path.join(os.tmpdir(), 'ek-migrate-'))
  const write = (file: string, content: string) => {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
    writeFileSync(path.join(root, file), content)
  }
  write('package.json', '{ "name": "consumer", "private": true, "type": "module" }\n')
  write(
    'edgekits-i18n.config.ts',
    `export default ${JSON.stringify({
      keyPrefix,
      languages: { en: { name: 'English' } },
      defaultLocale: 'en',
      cookie: { name: 'lang', maxAge: 60 },
      missingTranslationBanner: false,
      routing: 'prefix',
    })}\n`,
  )
  write(
    'wrangler.jsonc',
    JSON.stringify({
      kv_namespaces: [{ binding: 'TRANSLATIONS', id: 'b'.repeat(32) }],
      vars: { CLOUDFLARE_ZONE_ID: ZONE_ID },
    }),
  )
  write('locales/en/common.json', '{ "hello": "Hello" }\n')
  write('node_modules/wrangler/package.json', '{ "name": "wrangler", "bin": { "wrangler": "./bin.js" } }\n')
  write('node_modules/wrangler/bin.js', '')
  // Every fetch the CLI makes is answered here and appended to calls.json.
  write(
    'fake-fetch.mjs',
    `import fs from 'node:fs'
const scripted = ${JSON.stringify(scripted)}
const log = ${JSON.stringify(path.join(root, 'calls.json'))}
globalThis.fetch = async (input, init = {}) => {
  const calls = fs.existsSync(log) ? JSON.parse(fs.readFileSync(log, 'utf8')) : []
  calls.push({ url: String(input), method: init.method ?? 'GET' })
  fs.writeFileSync(log, JSON.stringify(calls))
  const { status, body } = String(input).endsWith('/purge_cache') ? scripted.purge : scripted.zone
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}
`,
  )
  return root
}

function migrate(root: string): { out: string; err: string } {
  const env: NodeJS.ProcessEnv = { ...process.env, CLOUDFLARE_CACHEPURGE_API_TOKEN: 'token' }
  delete env.CLOUDFLARE_ZONE_ID
  const run = spawnSync(
    process.execPath,
    [
      '--import',
      pathToFileURL(path.join(ROOT, 'test/register.mjs')).href,
      '--import',
      pathToFileURL(path.join(root, 'fake-fetch.mjs')).href,
      path.join(ROOT, 'src/cli/index.ts'),
      'migrate',
    ],
    { cwd: root, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  )
  assert.equal(run.status, 0, run.stderr)
  return { out: run.stdout, err: run.stderr }
}

const PURGED = { status: 200, body: { success: true, errors: [], result: { id: ZONE_ID } } }

test('migrate: a 403 on the zone lookup prints the skip line; the purge runs and the hashes are written', () => {
  const root = fakeProject('other.example', { zone: { status: 403, body: { success: false } }, purge: PURGED })
  try {
    const { out } = migrate(root)
    assert.match(out, /\[i18n\] ℹ️ {2}Could not read the zone name \(HTTP 403\), so the keyPrefix check was skipped/)
    const calls = JSON.parse(readFileSync(path.join(root, 'calls.json'), 'utf8')) as Array<{ url: string }>
    assert.deepEqual(
      calls.map((c) => c.url),
      [
        `https://api.cloudflare.com/client/v4/zones/${ZONE_ID}`,
        `https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/purge_cache`,
      ],
    )
    assert.match(out, /Cache purge completed/)
    assert.ok(existsSync(path.join(root, '.i18n-hashes.json')), 'hash file written')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('migrate: a keyPrefix outside the zone warns, and the purge and hashes go on unchanged', () => {
  const zone = { status: 200, body: { success: true, result: { name: 'edgekits.dev' } } }
  const root = fakeProject('other.example', { zone, purge: PURGED })
  try {
    const { out, err } = migrate(root)
    assert.match(err, /\[i18n\] ⚠️ {2}keyPrefix "other\.example" is a hostname outside the zone .* \(edgekits\.dev\)/)
    assert.doesNotMatch(out, /keyPrefix check was skipped/)
    assert.match(out, /Cache purge completed/)
    assert.ok(existsSync(path.join(root, '.i18n-hashes.json')), 'hash file written')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
