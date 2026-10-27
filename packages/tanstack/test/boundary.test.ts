import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

/**
 * Boundary guard for the package: `src/` imports only `react`, `hono`, `hono/cookie`,
 * `@edgekits/i18n-core` and its own files. Nothing from `@tanstack/*` (the app declares its
 * server function), no `cloudflare:` module (the app hands in its bindings), no `astro`.
 * The two entries stay apart: the server entry never reaches React, and `./react` imports
 * no hono and no engine value (types only), so a client bundle carries no KV code and no
 * `FALLBACK_` dictionary.
 *
 * Specifiers are collected from `import … from`, side-effect `import '…'`,
 * `export … from` and `import('…')`, `import type` included.
 */

const SRC_DIR = path.resolve(import.meta.dirname, '..', 'src')

type Edge = { file: string; specifier: string; typeOnly: boolean }

// `[^;]*?` lets a multi-line `import {\n…\n} from '…'` still yield its specifier.
const IMPORT_FROM = /^[ \t]*import\b([^;]*?)\bfrom\s*['"]([^'"]+)['"]/gm
const IMPORT_SIDE_EFFECT = /^[ \t]*import\s*()['"]([^'"]+)['"]/gm
const EXPORT_FROM = /^[ \t]*export\b([^;]*?)\bfrom\s*['"]([^'"]+)['"]/gm
const IMPORT_CALL = /\bimport\(()\s*['"]([^'"]+)['"]\s*\)/g

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return walk(full)
    return /\.tsx?$/.test(entry.name) ? [full] : []
  })
}

function collectEdges(): Edge[] {
  return walk(SRC_DIR).flatMap((full) => {
    const source = readFileSync(full, 'utf8')
    const file = path.relative(SRC_DIR, full).split(path.sep).join('/')
    return [IMPORT_FROM, IMPORT_SIDE_EFFECT, EXPORT_FROM, IMPORT_CALL]
      .flatMap((pattern) => [...source.matchAll(pattern)])
      .map((match) => ({ file, specifier: match[2]!, typeOnly: /^\s*type\b/.test(match[1]!) }))
  })
}

const ALLOWED = new Set(['react', 'hono', 'hono/cookie', '@edgekits/i18n-core'])

function isViolation({ specifier }: Pick<Edge, 'specifier'>): boolean {
  return !specifier.startsWith('./') && !specifier.startsWith('../') && !ALLOWED.has(specifier)
}

// The files an entry reaches through relative imports, the entry included.
function closure(entry: string, edges: Edge[]): Set<string> {
  const seen = new Set<string>()
  const visit = (file: string) => {
    if (seen.has(file)) return
    seen.add(file)
    for (const edge of edges.filter((e) => e.file === file && e.specifier.startsWith('.'))) {
      visit(path.posix.normalize(path.posix.join(path.posix.dirname(file), edge.specifier)))
    }
  }
  visit(entry)
  return seen
}

const key = ({ file, specifier }: Edge) => `${file} -> ${specifier}`

test('src/ imports only react, hono, hono/cookie, the core and its own files', () => {
  assert.deepEqual(collectEdges().filter(isViolation).map(key), [])
})

test('the server entry never reaches react', () => {
  const edges = collectEdges()
  const files = closure('index.ts', edges)
  assert.ok(files.has('request-locale.ts'), 'the closure is followed')
  assert.deepEqual(edges.filter((e) => files.has(e.file) && e.specifier === 'react').map(key), [])
})

test('the react entry imports no hono and no engine value', () => {
  const edges = collectEdges()
  const files = closure('react/index.ts', edges)
  assert.ok(files.has('react/language-switcher.tsx'), 'the closure is followed')
  assert.deepEqual(
    edges
      .filter((e) => files.has(e.file))
      .filter((e) => e.specifier.startsWith('hono') || (e.specifier === '@edgekits/i18n-core' && !e.typeOnly))
      .map(key),
    [],
  )
})

test('the scanner sees the package (non-vacuous)', () => {
  const edges = collectEdges()
  assert.ok(
    edges.some((e) => key(e) === 'index.ts -> ./middleware.ts'),
    '`export … from` is scanned',
  )
  assert.ok(
    edges.some((e) => key(e) === 'request-locale.ts -> hono/cookie' && !e.typeOnly),
    'value import found',
  )
  assert.ok(
    edges.some((e) => key(e) === 'middleware.ts -> hono' && e.typeOnly),
    '`import type` is classified',
  )
  assert.ok(
    edges.some((e) => e.file.endsWith('.tsx') && e.specifier === 'react'),
    '.tsx files are scanned',
  )
})

test('the classifier rejects what the boundary forbids', () => {
  for (const specifier of [
    '@tanstack/react-start',
    '@tanstack/react-start/server',
    '@tanstack/react-router',
    'cloudflare:workers',
    'astro',
    'react-dom',
    'hono/utils/url',
    '@edgekits/i18n-core/format',
    'node:fs',
  ]) {
    assert.ok(isViolation({ specifier }), specifier)
  }
  for (const specifier of ['react', 'hono', 'hono/cookie', '@edgekits/i18n-core', './provider.tsx', '../loader.ts']) {
    assert.ok(!isViolation({ specifier }), specifier)
  }
})
