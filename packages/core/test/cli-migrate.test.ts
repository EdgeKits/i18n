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

function writer(root: string): (file: string, content: string) => void {
  return (file, content) => {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
    writeFileSync(path.join(root, file), content)
  }
}

function configSource(keyPrefix: string): string {
  return `export default ${JSON.stringify({
    keyPrefix,
    languages: { en: { name: 'English' } },
    defaultLocale: 'en',
    cookie: { name: 'lang', maxAge: 60 },
    missingTranslationBanner: false,
    routing: 'prefix',
  })}\n`
}

// Every fetch the CLI makes is answered here and appended to calls.json.
function fakeFetchSource(root: string, scripted: Scripted): string {
  return `import fs from 'node:fs'
const scripted = ${JSON.stringify(scripted)}
const log = ${JSON.stringify(path.join(root, 'calls.json'))}
globalThis.fetch = async (input, init = {}) => {
  const calls = fs.existsSync(log) ? JSON.parse(fs.readFileSync(log, 'utf8')) : []
  calls.push({ url: String(input), method: init.method ?? 'GET', auth: new Headers(init.headers).get('authorization') })
  fs.writeFileSync(log, JSON.stringify(calls))
  const { status, body } = String(input).endsWith('/purge_cache') ? scripted.purge : scripted.zone
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}
`
}

function fakeProject(keyPrefix: string, scripted: Scripted): string {
  const root = mkdtempSync(path.join(os.tmpdir(), 'ek-migrate-'))
  const write = writer(root)
  write('package.json', '{ "name": "consumer", "private": true, "type": "module" }\n')
  write('edgekits-i18n.config.ts', configSource(keyPrefix))
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
  write('fake-fetch.mjs', fakeFetchSource(root, scripted))
  return root
}

function runCli(cwd: string, fakeFetch: string | null, args: string[], env: NodeJS.ProcessEnv) {
  const preload = fakeFetch ? ['--import', pathToFileURL(fakeFetch).href] : []
  return spawnSync(
    process.execPath,
    ['--import', import.meta.resolve('tsx'), ...preload, path.join(ROOT, 'src/cli/index.ts'), ...args],
    { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  )
}

function migrate(root: string): { out: string; err: string } {
  const env: NodeJS.ProcessEnv = { ...process.env, CLOUDFLARE_CACHEPURGE_API_TOKEN: 'token' }
  delete env.CLOUDFLARE_ZONE_ID
  const run = runCli(root, path.join(root, 'fake-fetch.mjs'), ['migrate'], env)
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

// A monorepo: one translations package, the Worker config in an app, wrangler hoisted to the
// repository root, the CLI run from that root with both flags. The stand-in wrangler records
// its argv and cwd.
const APP_ZONE_ID = 'c'.repeat(32)
const APP_KV_ID = 'd'.repeat(32)

function fakeMonorepo(scripted: Scripted): string {
  const root = mkdtempSync(path.join(os.tmpdir(), 'ek-mono-'))
  const write = writer(root)
  write('package.json', '{ "name": "monorepo", "private": true, "type": "module" }\n')
  write('packages/i18n/edgekits-i18n.config.ts', configSource('edgekits.dev'))
  write('packages/i18n/locales/en/common.json', '{ "hello": "Hello" }\n')
  write('packages/i18n/locales/en/app.billing.json', '{ "plan": "Pro" }\n')
  write(
    'apps/app/wrangler.jsonc',
    JSON.stringify({
      kv_namespaces: [{ binding: 'TRANSLATIONS', id: APP_KV_ID }],
      vars: { CLOUDFLARE_ZONE_ID: APP_ZONE_ID },
    }),
  )
  write('apps/app/.dev.vars', 'CLOUDFLARE_CACHEPURGE_API_TOKEN=from-dev-vars\n')
  write('node_modules/wrangler/package.json', '{ "name": "wrangler", "bin": { "wrangler": "./bin.js" } }\n')
  write(
    'node_modules/wrangler/bin.js',
    `require('node:fs').writeFileSync(${JSON.stringify(path.join(root, 'wrangler-call.json'))}, ` +
      'JSON.stringify({ argv: process.argv.slice(2), cwd: process.cwd() }))\n',
  )
  write('fake-fetch.mjs', fakeFetchSource(root, scripted))
  return root
}

function envWithoutCloudflare(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env }
  delete env.CLOUDFLARE_ZONE_ID
  delete env.CLOUDFLARE_CACHEPURGE_API_TOKEN
  return env
}

test('migrate in a monorepo: outputs next to --config, Worker settings from --wrangler', () => {
  const zone = { status: 200, body: { success: true, result: { name: 'edgekits.dev' } } }
  const root = fakeMonorepo({ zone, purge: PURGED })
  try {
    const args = [
      'migrate',
      '--config',
      'packages/i18n/edgekits-i18n.config.ts',
      '--wrangler',
      'apps/app/wrangler.jsonc',
    ]
    const run = runCli(root, path.join(root, 'fake-fetch.mjs'), args, envWithoutCloudflare())
    assert.equal(run.status, 0, run.stderr)

    const pkg = path.join(root, 'packages', 'i18n')
    for (const file of [
      'i18n-data.json',
      'src/i18n.generated.d.ts',
      'src/i18n/runtime-constants.ts',
      'src/i18n/fallbacks.generated.ts',
      '.i18n-hashes.json',
    ]) {
      assert.ok(existsSync(path.join(pkg, file)), `packages/i18n/${file}`)
      assert.ok(!existsSync(path.join(root, file)), `nothing at the root: ${file}`)
    }
    assert.match(readFileSync(path.join(pkg, 'src/i18n/fallbacks.generated.ts'), 'utf8'), /FALLBACK_APP__BILLING = /)
    assert.match(run.stdout, /Generated:\n- packages\/i18n\/i18n-data\.json\n/)

    const wrangler = JSON.parse(readFileSync(path.join(root, 'wrangler-call.json'), 'utf8'))
    assert.deepEqual(wrangler, {
      argv: [
        'kv',
        'bulk',
        'put',
        path.join(pkg, 'i18n-data.json'),
        '--remote',
        `--namespace-id=${APP_KV_ID}`,
        '--config',
        path.join(root, 'apps', 'app', 'wrangler.jsonc'),
      ],
      cwd: path.join(root, 'apps', 'app'),
    })

    const calls = JSON.parse(readFileSync(path.join(root, 'calls.json'), 'utf8')) as Array<{
      url: string
      auth: string
    }>
    assert.deepEqual(calls, [
      { url: `https://api.cloudflare.com/client/v4/zones/${APP_ZONE_ID}`, method: 'GET', auth: 'Bearer from-dev-vars' },
      {
        url: `https://api.cloudflare.com/client/v4/zones/${APP_ZONE_ID}/purge_cache`,
        method: 'POST',
        auth: 'Bearer from-dev-vars',
      },
    ])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('--config pointing at a missing file exits 1, naming the path tried', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'ek-noconfig-'))
  try {
    const run = runCli(root, null, ['bundle', '--config', 'nope/edgekits-i18n.config.ts'], envWithoutCloudflare())
    assert.equal(run.status, 1)
    assert.ok(
      run.stderr.includes(`Config file not found: ${path.join(root, 'nope', 'edgekits-i18n.config.ts')}`),
      run.stderr,
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('flags before the command work: --config x bundle', () => {
  const root = fakeMonorepo({ zone: PURGED, purge: PURGED })
  try {
    const run = runCli(
      root,
      null,
      ['--config', 'packages/i18n/edgekits-i18n.config.ts', 'bundle'],
      envWithoutCloudflare(),
    )
    assert.equal(run.status, 0, run.stderr)
    assert.ok(existsSync(path.join(root, 'packages', 'i18n', 'i18n-data.json')))
    assert.ok(!existsSync(path.join(root, 'i18n-data.json')))
    assert.ok(!existsSync(path.join(root, 'wrangler-call.json')), 'bundle never runs wrangler')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
