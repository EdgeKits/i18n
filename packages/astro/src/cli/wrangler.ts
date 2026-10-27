import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

import { parse as parseJsonc, printParseErrorCode, type ParseError } from 'jsonc-parser'

// ---------------------------------------------------------------------------
// Wrangler config reader
// Parses wrangler.jsonc to extract KV namespace IDs and vars by key.
// Single source of truth — no hardcoded IDs or zone IDs in package.json.
// ---------------------------------------------------------------------------

export const KV_BINDING = 'TRANSLATIONS'

function readWranglerConfig(root: string): Record<string, unknown> {
  const wranglerConfigPath = path.join(root, 'wrangler.jsonc')

  if (!fs.existsSync(wranglerConfigPath)) {
    console.error(`[i18n] wrangler.jsonc not found at ${wranglerConfigPath}`)
    process.exit(1)
  }

  const raw = fs.readFileSync(wranglerConfigPath, 'utf8')

  const errors: ParseError[] = []
  const config = parseJsonc(raw, errors, { allowTrailingComma: true })

  if (!config || typeof config !== 'object') {
    console.error('[i18n] Failed to parse wrangler.jsonc — result is empty.')
    for (const err of errors) {
      const snippet = raw.slice(Math.max(0, err.offset - 10), err.offset + 20)
      console.error(`  ${printParseErrorCode(err.error)} at offset ${err.offset}: ...${JSON.stringify(snippet)}...`)
    }
    process.exit(1)
  }

  return config
}

export function getKvNamespaceId(root: string, binding: string): string {
  const config = readWranglerConfig(root)
  const kvNamespaces = config.kv_namespaces as
    | Array<{
        binding: string
        id: string
      }>
    | undefined

  const entry = kvNamespaces?.find((kv) => kv.binding === binding)

  if (!entry) {
    console.error(`[i18n] KV binding "${binding}" not found in wrangler.jsonc`)
    process.exit(1)
  }

  return entry.id
}

export function getWranglerVar(root: string, key: string): string | undefined {
  const config = readWranglerConfig(root)
  const vars = config.vars as Record<string, string> | undefined
  return vars?.[key]
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
