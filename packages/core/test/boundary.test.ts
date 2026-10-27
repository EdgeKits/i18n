import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

/**
 * Boundary guard for the core: it is free of any framework and platform module, so an
 * adapter for any framework can carry it. No file under `src/` imports `astro` (or
 * `astro/*`), a `cloudflare:` module, a `virtual:` id or `zod`; `node:*` only under
 * `src/cli/` (the CLI runs in Node; the rest also runs in workerd).
 *
 * Specifiers are collected from `import … from`, side-effect `import '…'`,
 * `export … from` and `import('…')`, `import type` included.
 */

const SRC_DIR = path.resolve(import.meta.dirname, '..', 'src')

type Edge = { file: string; specifier: string }

// `[^;]*?` lets a multi-line `import {\n…\n} from '…'` still yield its specifier.
const IMPORT_FROM = /^[ \t]*import\b[^;]*?\bfrom\s*['"]([^'"]+)['"]/gm
const IMPORT_SIDE_EFFECT = /^[ \t]*import\s*['"]([^'"]+)['"]/gm
const EXPORT_FROM = /^[ \t]*export\b[^;]*?\bfrom\s*['"]([^'"]+)['"]/gm
const IMPORT_CALL = /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return walk(full)
    return entry.name.endsWith('.ts') ? [full] : []
  })
}

function collectEdges(): Edge[] {
  return walk(SRC_DIR).flatMap((full) => {
    const source = readFileSync(full, 'utf8')
    const file = path.relative(SRC_DIR, full).split(path.sep).join('/')
    return [IMPORT_FROM, IMPORT_SIDE_EFFECT, EXPORT_FROM, IMPORT_CALL]
      .flatMap((pattern) => [...source.matchAll(pattern)])
      .map((match) => ({ file, specifier: match[1]! }))
  })
}

const FORBIDDEN = [/^astro($|\/)/, /^cloudflare:/, /^virtual:/, /^zod($|\/)/]

function isViolation({ file, specifier }: Edge): boolean {
  if (FORBIDDEN.some((pattern) => pattern.test(specifier))) return true
  if (specifier.startsWith('node:')) return !file.startsWith('cli/')
  return false
}

const key = ({ file, specifier }: Edge) => `${file} -> ${specifier}`

test('src/ imports no framework, platform, virtual module or zod; node:* only in cli/', () => {
  assert.deepEqual(collectEdges().filter(isViolation).map(key), [])
})

test('the scanner sees the package (non-vacuous)', () => {
  const edges = collectEdges()
  assert.ok(
    edges.some((e) => e.file.startsWith('cli/') && e.specifier.startsWith('node:')),
    'cli node: edge found',
  )
  assert.ok(
    edges.some((e) => e.specifier.startsWith('.')),
    'relative edge found',
  )
  assert.ok(
    edges.some((e) => key(e) === 'index.ts -> ./create-i18n.ts'),
    '`export … from` is scanned',
  )
})

test('the classifier rejects what the boundary forbids', () => {
  assert.ok(isViolation({ file: 'fetcher.ts', specifier: 'cloudflare:workers' }))
  assert.ok(isViolation({ file: 'create-i18n.ts', specifier: 'virtual:@edgekits/astro-i18n/config' }))
  assert.ok(isViolation({ file: 'types.ts', specifier: 'astro' }))
  assert.ok(isViolation({ file: 'types.ts', specifier: 'astro/zod' }))
  assert.ok(isViolation({ file: 'types.ts', specifier: 'zod' }))
  assert.ok(isViolation({ file: 'cli/index.ts', specifier: 'astro' }), 'cli/ is not exempt from the framework rule')
  assert.ok(isViolation({ file: 'fetcher.ts', specifier: 'node:fs' }))
  assert.ok(isViolation({ file: 'clients.ts', specifier: 'node:fs' }), 'only the cli/ folder')
  assert.ok(!isViolation({ file: 'cli/index.ts', specifier: 'node:child_process' }))
  assert.ok(!isViolation({ file: 'cli/wrangler.ts', specifier: 'jsonc-parser' }))
  assert.ok(!isViolation({ file: 'assemble.ts', specifier: './deep-merge.ts' }))
  assert.ok(!isViolation({ file: 'types.ts', specifier: 'astronomy' }), 'a prefix alone is not astro')
})
