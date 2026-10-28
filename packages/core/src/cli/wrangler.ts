import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

import { parse as parseJsonc, printParseErrorCode, type ParseError } from 'jsonc-parser'

// ---------------------------------------------------------------------------
// Wrangler config reader
// Parses the Worker's wrangler.jsonc (the path `--wrangler` names, ./wrangler.jsonc by
// default) for the translations binding and the zone id, at the top level or in one
// `env.<name>`.
// Single source of truth — no hardcoded IDs or zone IDs in package.json.
// ---------------------------------------------------------------------------

export const KV_BINDING = 'TRANSLATIONS'

function readWranglerConfig(wranglerConfigPath: string): Record<string, unknown> {
  if (!fs.existsSync(wranglerConfigPath)) {
    console.error(`[i18n] Wrangler config not found: ${wranglerConfigPath}`)
    process.exit(1)
  }

  const raw = fs.readFileSync(wranglerConfigPath, 'utf8')

  const errors: ParseError[] = []
  const config = parseJsonc(raw, errors, { allowTrailingComma: true })

  if (!config || typeof config !== 'object') {
    console.error(`[i18n] Failed to parse ${wranglerConfigPath} — result is empty.`)
    for (const err of errors) {
      const snippet = raw.slice(Math.max(0, err.offset - 10), err.offset + 20)
      console.error(`  ${printParseErrorCode(err.error)} at offset ${err.offset}: ...${JSON.stringify(snippet)}...`)
    }
    process.exit(1)
  }

  return config
}

type KvNamespace = { binding?: unknown; id?: unknown; preview_id?: unknown }

type WranglerScope = { kv_namespaces?: KvNamespace[]; vars?: Record<string, unknown> }

/** What the CLI reads from the Worker's wrangler config, for one environment or the top level. */
export type WorkerSettings = {
  // The binding's `id`: what `migrate` writes, and the key of its purge baseline.
  kvId: string
  // The binding's `preview_id`, when set: what `wrangler dev` reads, so what `seed` writes.
  previewId?: string
  // `vars.CLOUDFLARE_ZONE_ID` of the same scope.
  zoneId?: string
  // Without an environment: the `env.<name>` entries that bind the same name to another id.
  otherEnvs: string[]
}

function findBinding(scope: WranglerScope | undefined, binding: string): KvNamespace | undefined {
  const kvNamespaces = Array.isArray(scope?.kv_namespaces) ? scope.kv_namespaces : []
  return kvNamespaces.find((kv) => kv?.binding === binding)
}

/**
 * The `binding` KV namespace and `CLOUDFLARE_ZONE_ID` of the top level, or of `env.<env>`
 * when `env` is given: wrangler does not inherit `kv_namespaces` and `vars` into an
 * environment, so nothing falls back to the top level. Exits, naming the file and the
 * scope, when the environment or the binding (or its `id`) is missing.
 */
export function readWorkerSettings(wranglerConfigPath: string, binding: string, env?: string): WorkerSettings {
  const config = readWranglerConfig(wranglerConfigPath)
  const envs = (config.env ?? {}) as Record<string, WranglerScope | undefined>

  let scope = config as WranglerScope
  let where = wranglerConfigPath
  if (env !== undefined) {
    if (!Object.hasOwn(envs, env) || typeof envs[env] !== 'object' || envs[env] === null) {
      console.error(`[i18n] Environment "${env}" not found in ${wranglerConfigPath} (no env.${env}).`)
      process.exit(1)
    }
    scope = envs[env]
    where = `env.${env} of ${wranglerConfigPath}`
  }

  const entry = findBinding(scope, binding)
  if (!entry) {
    console.error(
      `[i18n] KV binding "${binding}" not found in ${where}` +
        (env !== undefined ? ' (wrangler does not inherit kv_namespaces into an environment).' : ''),
    )
    process.exit(1)
  }
  if (typeof entry.id !== 'string') {
    console.error(`[i18n] KV binding "${binding}" in ${where} has no id.`)
    process.exit(1)
  }

  const zoneId = scope.vars?.CLOUDFLARE_ZONE_ID
  const otherEnvs =
    env === undefined
      ? Object.keys(envs).filter((name) => {
          const other = findBinding(envs[name], binding)
          return other !== undefined && other.id !== entry.id
        })
      : []

  return {
    kvId: entry.id,
    previewId: typeof entry.preview_id === 'string' ? entry.preview_id : undefined,
    zoneId: typeof zoneId === 'string' && zoneId !== '' ? zoneId : undefined,
    otherEnvs,
  }
}

// ---------------------------------------------------------------------------
// Wrangler binary
// The CLI runs wrangler's JavaScript entry with the current Node binary, never through
// a shell (no `.cmd` shim on Windows, nothing for a shell to interpret).
// ---------------------------------------------------------------------------

/**
 * The absolute path of the project's wrangler entry (`bin.wrangler` in its package.json),
 * resolved from `root` as the project itself would resolve it. `wrangler/package.json` is
 * an exported subpath; `bin/` is not, hence the detour through the manifest. Throws when
 * the project has no wrangler or its manifest declares no `bin.wrangler`.
 */
export function resolveWranglerBin(root: string): string {
  const requireFromRoot = createRequire(path.join(root, 'package.json'))

  let manifestPath: string
  try {
    manifestPath = requireFromRoot.resolve('wrangler/package.json')
  } catch {
    throw new Error(
      `wrangler is not installed in ${root}. The CLI runs the project's own wrangler: install it there (npm i -D wrangler).`,
    )
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as { bin?: string | Record<string, string> }
  const bin = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.wrangler
  if (!bin) {
    throw new Error(`wrangler at ${path.dirname(manifestPath)} declares no bin.wrangler in its package.json.`)
  }

  return path.join(path.dirname(manifestPath), bin)
}
