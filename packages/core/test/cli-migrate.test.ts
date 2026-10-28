import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import test from 'node:test'

import { computeHash } from '../src/cli/hashes.ts'
import { formatTranslationCacheUrl } from '../src/key-format.ts'

/**
 * `edgekits-i18n migrate` end to end, in a fake project under the OS temp dir: a stand-in
 * wrangler that exits 0, and a preloaded `fetch` that answers the zone lookup and the
 * purge from a script. No network. The keyPrefix check is advisory: a token without
 * Zone Read gets one info line, and the purge and the hash file go on as before.
 */

const ROOT = path.resolve(import.meta.dirname, '..')
const ZONE_ID = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'

type Reply = { status: number; body: unknown }
// `purges`, when given, answers the purge calls in order (the last one repeats); else `purge`.
type Scripted = { zone: Reply; purge: Reply; purges?: Reply[] }

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

// Every fetch the CLI makes is answered here and appended to calls.json; each purge's
// `files` list is appended to purges.json.
function fakeFetchSource(root: string, scripted: Scripted): string {
  return `import fs from 'node:fs'
const scripted = ${JSON.stringify(scripted)}
const log = ${JSON.stringify(path.join(root, 'calls.json'))}
const purgeLog = ${JSON.stringify(path.join(root, 'purges.json'))}
const append = (file, entry) => {
  const entries = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : []
  entries.push(entry)
  fs.writeFileSync(file, JSON.stringify(entries))
  return entries.length
}
globalThis.fetch = async (input, init = {}) => {
  append(log, { url: String(input), method: init.method ?? 'GET', auth: new Headers(init.headers).get('authorization') })
  let reply = scripted.zone
  if (String(input).endsWith('/purge_cache')) {
    const n = append(purgeLog, JSON.parse(init.body).files)
    reply = scripted.purges ? scripted.purges[Math.min(n, scripted.purges.length) - 1] : scripted.purge
  }
  return new Response(JSON.stringify(reply.body), { status: reply.status, headers: { 'Content-Type': 'application/json' } })
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
  const run = runCli(root, path.join(root, 'fake-fetch.mjs'), ['migrate', '--purge-delay', '0'], env)
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
      '--purge-delay',
      '0',
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

// ---------------------------------------------------------------------------
// Deploy: two purge rounds, exit codes, inputs, environments, deleted files, the baseline
// per KV namespace. One fake project per test; the stand-in wrangler appends every call
// (argv, cwd and, for a bulk delete, the keys file's contents) to wrangler-calls.json.
// ---------------------------------------------------------------------------

const KV_ID = 'b'.repeat(32)
const ZONE = { status: 200, body: { success: true, result: { name: 'edgekits.dev' } } }
const FAILED = { status: 500, body: { success: false, errors: [{ code: 10000 }] } }

type WranglerCall = { argv: string[]; cwd: string; keys?: unknown }

function project(
  options: { wrangler?: Record<string, unknown>; files?: Record<string, string>; scripted?: Partial<Scripted> } = {},
): string {
  const root = mkdtempSync(path.join(os.tmpdir(), 'ek-deploy-'))
  const write = writer(root)
  write('package.json', '{ "name": "consumer", "private": true, "type": "module" }\n')
  write('edgekits-i18n.config.ts', configSource('edgekits.dev'))
  write(
    'wrangler.jsonc',
    JSON.stringify(
      options.wrangler ?? {
        kv_namespaces: [{ binding: 'TRANSLATIONS', id: KV_ID }],
        vars: { CLOUDFLARE_ZONE_ID: ZONE_ID },
      },
    ),
  )
  write('locales/en/common.json', '{ "hello": "Hello" }\n')
  write('locales/en/blog.json', '{ "heading": "Blog" }\n')
  write('node_modules/wrangler/package.json', '{ "name": "wrangler", "bin": { "wrangler": "./bin.js" } }\n')
  write(
    'node_modules/wrangler/bin.js',
    `const fs = require('node:fs')
const log = ${JSON.stringify(path.join(root, 'wrangler-calls.json'))}
const argv = process.argv.slice(2)
const calls = fs.existsSync(log) ? JSON.parse(fs.readFileSync(log, 'utf8')) : []
const keys = argv[1] === 'bulk' && argv[2] === 'delete' ? JSON.parse(fs.readFileSync(argv[3], 'utf8')) : undefined
calls.push({ argv, cwd: process.cwd(), keys })
fs.writeFileSync(log, JSON.stringify(calls))
`,
  )
  write('fake-fetch.mjs', fakeFetchSource(root, { zone: ZONE, purge: PURGED, ...options.scripted }))
  for (const [file, content] of Object.entries(options.files ?? {})) write(file, content)
  return root
}

function cli(root: string, args: string[], env: NodeJS.ProcessEnv = { CLOUDFLARE_CACHEPURGE_API_TOKEN: 'token' }) {
  return runCli(root, path.join(root, 'fake-fetch.mjs'), args, { ...envWithoutCloudflare(), ...env })
}

function readJson<T>(root: string, file: string): T {
  return JSON.parse(readFileSync(path.join(root, file), 'utf8')) as T
}

function inProject(options: Parameters<typeof project>[0], check: (root: string) => void): void {
  const root = project(options)
  try {
    check(root)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

const url = (ns: string) => formatTranslationCacheUrl('edgekits.dev', 'en', ns)
const HASHES = { 'en:common': computeHash({ hello: 'Hello' }), 'en:blog': computeHash({ heading: 'Blog' }) }

test('migrate purges, waits --purge-delay, purges the same URLs again, then writes the hashes', () => {
  inProject({}, (root) => {
    const run = cli(root, ['migrate', '--purge-delay', '0.05'])
    assert.equal(run.status, 0, run.stderr)
    const purges = readJson<string[][]>(root, 'purges.json')
    assert.deepEqual(
      purges.map((files) => [...files].sort()),
      [
        [url('blog'), url('common')],
        [url('blog'), url('common')],
      ],
    )
    assert.match(run.stdout, /Waiting 0\.05 s for KV to settle/)
    assert.deepEqual(readJson(root, '.i18n-hashes.json'), { [KV_ID]: HASHES })
  })
})

test('--purge-delay 0: one purge round', () => {
  inProject({}, (root) => {
    const run = cli(root, ['migrate', '--purge-delay', '0'])
    assert.equal(run.status, 0, run.stderr)
    assert.equal(readJson<unknown[]>(root, 'purges.json').length, 1)
    assert.doesNotMatch(run.stdout, /Waiting/)
  })
})

test('a failure in the second purge round: exit 1, hashes not written', () => {
  inProject({ scripted: { purges: [PURGED, FAILED] } }, (root) => {
    const run = cli(root, ['migrate', '--purge-delay', '0.01'])
    assert.equal(run.status, 1)
    assert.equal(readJson<unknown[]>(root, 'purges.json').length, 2)
    assert.match(run.stderr, /KV is updated; the edge cache is not/)
    assert.ok(!existsSync(path.join(root, '.i18n-hashes.json')))
  })
})

test('a failed first purge round: exit 1, no second round, hashes not written', () => {
  inProject({ scripted: { purge: FAILED } }, (root) => {
    const run = cli(root, ['migrate', '--purge-delay', '0.01'])
    assert.equal(run.status, 1)
    assert.equal(readJson<unknown[]>(root, 'purges.json').length, 1)
    assert.match(run.stderr, /KV is updated; the edge cache is not/)
    assert.ok(!existsSync(path.join(root, '.i18n-hashes.json')))
  })
})

test('a skipped purge (no zone id, or no token) exits 1 after the KV push', () => {
  const wrangler = { kv_namespaces: [{ binding: 'TRANSLATIONS', id: KV_ID }] }
  inProject({ wrangler }, (root) => {
    const run = cli(root, ['migrate', '--purge-delay', '0'])
    assert.equal(run.status, 1)
    assert.match(run.stderr, /CLOUDFLARE_ZONE_ID not found/)
    assert.match(run.stderr, /KV is updated; the edge cache is not/)
    assert.equal(readJson<WranglerCall[]>(root, 'wrangler-calls.json').length, 1, 'the push ran')
    assert.ok(!existsSync(path.join(root, '.i18n-hashes.json')))
  })
  inProject({}, (root) => {
    const run = cli(root, ['migrate', '--purge-delay', '0'], {})
    assert.equal(run.status, 1)
    assert.match(run.stderr, /CLOUDFLARE_CACHEPURGE_API_TOKEN not set/)
    assert.match(run.stderr, /KV is updated; the edge cache is not/)
    assert.ok(!existsSync(path.join(root, '.i18n-hashes.json')))
  })
})

test('.dev.vars is read as dotenv: quotes, an export prefix and an inline comment', () => {
  const files = { '.dev.vars': '# purge\nexport CLOUDFLARE_CACHEPURGE_API_TOKEN="abc" # the token\n' }
  inProject({ files }, (root) => {
    const run = cli(root, ['migrate', '--purge-delay', '0'], {})
    assert.equal(run.status, 0, run.stderr)
    const calls = readJson<Array<{ auth: string }>>(root, 'calls.json')
    assert.deepEqual(new Set(calls.map((c) => c.auth)), new Set(['Bearer abc']))
  })
})

test('seed writes the preview_id namespace (what wrangler dev reads), migrate the id', () => {
  const previewId = 'e'.repeat(32)
  const wrangler = {
    kv_namespaces: [{ binding: 'TRANSLATIONS', id: KV_ID, preview_id: previewId }],
    vars: { CLOUDFLARE_ZONE_ID: ZONE_ID },
  }
  inProject({ wrangler }, (root) => {
    assert.equal(cli(root, ['seed']).status, 0)
    assert.equal(cli(root, ['migrate', '--purge-delay', '0']).status, 0)
    const [seed, migrate] = readJson<WranglerCall[]>(root, 'wrangler-calls.json')
    assert.ok(seed!.argv.includes('--local') && seed!.argv.includes(`--namespace-id=${previewId}`), String(seed!.argv))
    assert.ok(migrate!.argv.includes('--remote') && migrate!.argv.includes(`--namespace-id=${KV_ID}`))
  })
})

const STAGING_KV = 'f'.repeat(32)
const STAGING_ZONE = '1'.repeat(32)
const WITH_ENVS = {
  kv_namespaces: [{ binding: 'TRANSLATIONS', id: KV_ID }],
  vars: { CLOUDFLARE_ZONE_ID: ZONE_ID },
  env: {
    staging: {
      kv_namespaces: [{ binding: 'TRANSLATIONS', id: STAGING_KV }],
      vars: { CLOUDFLARE_ZONE_ID: STAGING_ZONE },
    },
    canary: { kv_namespaces: [{ binding: 'TRANSLATIONS', id: KV_ID }] },
  },
}

test('--env <name>: the binding and the zone id from env.<name>, and wrangler gets --env', () => {
  inProject({ wrangler: WITH_ENVS }, (root) => {
    const run = cli(root, ['migrate', '--env', 'staging', '--purge-delay', '0'])
    assert.equal(run.status, 0, run.stderr)
    const [put] = readJson<WranglerCall[]>(root, 'wrangler-calls.json')
    assert.deepEqual(put!.argv.slice(-4), ['--config', path.join(root, 'wrangler.jsonc'), '--env', 'staging'])
    assert.ok(put!.argv.includes(`--namespace-id=${STAGING_KV}`))
    const calls = readJson<Array<{ url: string }>>(root, 'calls.json')
    assert.ok(
      calls.every((c) => c.url.includes(`/zones/${STAGING_ZONE}`)),
      JSON.stringify(calls),
    )
    assert.deepEqual(Object.keys(readJson(root, '.i18n-hashes.json')), [STAGING_KV])
    assert.doesNotMatch(run.stderr, /different id/)
  })
})

test('without --env: one warning names the environments that bind TRANSLATIONS to another id', () => {
  inProject({ wrangler: WITH_ENVS }, (root) => {
    const run = cli(root, ['migrate', '--purge-delay', '0'])
    assert.equal(run.status, 0, run.stderr)
    const warnings = run.stderr.split('\n').filter((line) => line.includes('different id'))
    assert.equal(warnings.length, 1, run.stderr)
    assert.match(warnings[0]!, /env\.staging/)
    assert.doesNotMatch(warnings[0]!, /canary/, 'same id, no warning')
  })
})

test('--env naming an environment without TRANSLATIONS exits 1 before anything is written', () => {
  inProject({ wrangler: { ...WITH_ENVS, env: { qa: { vars: {} } } } }, (root) => {
    const run = cli(root, ['migrate', '--env', 'qa', '--purge-delay', '0'])
    assert.equal(run.status, 1)
    assert.match(run.stderr, /"TRANSLATIONS" not found in env\.qa/)
    assert.match(run.stderr, /does not inherit/)
    assert.ok(!existsSync(path.join(root, 'i18n-data.json')))
  })
})

test('a deleted translation file: its KV key is bulk-deleted and its cache URL purged', () => {
  const baseline = { [KV_ID]: { ...HASHES, 'en:pricing': '000000000000' } }
  inProject({ files: { '.i18n-hashes.json': JSON.stringify(baseline) } }, (root) => {
    const run = cli(root, ['migrate', '--purge-delay', '0'])
    assert.equal(run.status, 0, run.stderr)
    const [, del] = readJson<WranglerCall[]>(root, 'wrangler-calls.json')
    assert.deepEqual(del!.argv.slice(0, 3), ['kv', 'bulk', 'delete'])
    assert.deepEqual(del!.argv.slice(4), [
      '--remote',
      `--namespace-id=${KV_ID}`,
      '--force',
      '--config',
      path.join(root, 'wrangler.jsonc'),
    ])
    assert.deepEqual(del!.keys, ['edgekits.dev:pricing:en'])
    assert.match(run.stdout, /edgekits\.dev:pricing:en/)
    assert.deepEqual(readJson(root, 'purges.json'), [[url('pricing')]])
    assert.deepEqual(readJson(root, '.i18n-hashes.json'), { [KV_ID]: HASHES })
  })
})

test('the baseline: an old flat file is the current namespace baseline, rewritten per KV id', () => {
  inProject({ files: { '.i18n-hashes.json': JSON.stringify(HASHES) } }, (root) => {
    const run = cli(root, ['migrate', '--purge-delay', '0'])
    assert.equal(run.status, 0, run.stderr)
    assert.match(run.stdout, /No translation changes detected/)
    assert.ok(!existsSync(path.join(root, 'purges.json')), 'nothing purged')
    assert.deepEqual(readJson(root, '.i18n-hashes.json'), { [KV_ID]: HASHES })
  })
})

test('the baseline: two KV namespaces are kept apart', () => {
  const other = { 'en:common': 'aaaaaaaaaaaa' }
  const baseline = { [STAGING_KV]: other, [KV_ID]: HASHES }
  inProject({ wrangler: WITH_ENVS, files: { '.i18n-hashes.json': JSON.stringify(baseline) } }, (root) => {
    const run = cli(root, ['migrate', '--purge-delay', '0'])
    assert.equal(run.status, 0, run.stderr)
    assert.ok(!existsSync(path.join(root, 'purges.json')), 'the production baseline matched')
    assert.deepEqual(readJson(root, '.i18n-hashes.json'), baseline, 'staging kept')

    const staging = cli(root, ['migrate', '--env', 'staging', '--purge-delay', '0'])
    assert.equal(staging.status, 0, staging.stderr)
    assert.deepEqual(readJson<string[][]>(root, 'purges.json')[0]!.sort(), [url('blog'), url('common')])
    assert.deepEqual(readJson(root, '.i18n-hashes.json'), { [STAGING_KV]: HASHES, [KV_ID]: HASHES })
  })
})

test('a translation file that is not JSON, or empty: exit 1 naming <localesDir>/<locale>/<file>', () => {
  for (const content of ['{ "hello": ', '', '\uFEFF']) {
    inProject({ files: { 'locales/en/common.json': content } }, (root) => {
      const run = cli(root, ['bundle'])
      assert.equal(run.status, 1, JSON.stringify(content))
      assert.match(run.stderr, /locales\/en\/common\.json/)
      assert.ok(!existsSync(path.join(root, 'i18n-data.json')))
    })
  }
})
