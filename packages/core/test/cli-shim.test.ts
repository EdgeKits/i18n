import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import test from 'node:test'

/**
 * The unscoped `edgekits-i18n` package (packages/cli) only imports `@edgekits/i18n-core/cli`.
 * Run through the workspace link, it reaches the compiled CLI in dist/ (the root `test`
 * script builds the core first).
 */

const SHIM = path.resolve(import.meta.dirname, '../../cli/bin.js')

test('the edgekits-i18n shim runs the core CLI', () => {
  const result = spawnSync(process.execPath, [SHIM, '--help'], { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /^Usage: edgekits-i18n <command> /)
})
