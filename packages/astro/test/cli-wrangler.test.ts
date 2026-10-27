import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { resolveWranglerBin } from '../src/cli/wrangler.ts'

/**
 * The CLI runs the consumer's own wrangler entry with `process.execPath`, no shell
 * (RA129c). The resolver finds it from the project root through wrangler's exported
 * `package.json` and its `bin.wrangler`. Fake roots live under the OS temp dir: inside
 * this repository, resolution would walk up to its own node_modules/wrangler. Nothing
 * is spawned.
 */

function fakeRoot(wranglerManifest?: Record<string, unknown>): string {
  const root = mkdtempSync(path.join(os.tmpdir(), 'ek-wrangler-'))
  writeFileSync(path.join(root, 'package.json'), '{ "name": "consumer", "private": true }\n')
  if (wranglerManifest) {
    const dir = path.join(root, 'node_modules', 'wrangler')
    mkdirSync(dir, { recursive: true })
    writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'wrangler', ...wranglerManifest }))
  }
  return root
}

function withRoot(manifest: Record<string, unknown> | undefined, check: (root: string) => void): void {
  const root = fakeRoot(manifest)
  try {
    check(root)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

test('resolves bin.wrangler inside the project’s wrangler package', () => {
  withRoot(
    {
      bin: { 'cf-wrangler': './bin/cf-wrangler.js', wrangler: './bin/wrangler.js' },
      exports: { '.': './index.js', './package.json': './package.json' },
    },
    (root) => {
      assert.equal(resolveWranglerBin(root), path.join(root, 'node_modules', 'wrangler', 'bin', 'wrangler.js'))
    },
  )
})

test('a string `bin` is the wrangler entry too', () => {
  withRoot({ bin: './cli.js' }, (root) => {
    assert.equal(resolveWranglerBin(root), path.join(root, 'node_modules', 'wrangler', 'cli.js'))
  })
})

test('a project without wrangler fails, saying to install it there', () => {
  withRoot(undefined, (root) => {
    assert.throws(
      () => resolveWranglerBin(root),
      (err: Error) =>
        err.message.startsWith(`wrangler is not installed in ${root}.`) && err.message.includes('npm i -D wrangler'),
    )
  })
})

test('a wrangler manifest without bin.wrangler fails, naming it', () => {
  withRoot({ bin: { other: './x.js' } }, (root) => {
    assert.throws(() => resolveWranglerBin(root), /declares no bin\.wrangler/)
  })
})
