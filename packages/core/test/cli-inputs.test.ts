import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { collectTranslations } from '../src/cli/collect.ts'
import { parseDevVars } from '../src/cli/dev-vars.ts'

/**
 * The CLI's inputs: translation JSON files (BOM, parse errors, empty files, subfolders) and
 * `.dev.vars` (dotenv syntax, as wrangler reads it). Fake locale trees live under the OS
 * temp dir; paths in messages are shown through the caller's `display`.
 */

function withLocales(files: Record<string, string>, check: (dir: string) => void): void {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'ek-locales-'))
  try {
    for (const [file, content] of Object.entries(files)) {
      mkdirSync(path.dirname(path.join(dir, file)), { recursive: true })
      writeFileSync(path.join(dir, file), content)
    }
    check(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

// What the CLI shows: `locales/<locale>/<file>`, forward slashes.
const display = (dir: string) => (file: string) => ['locales', ...path.relative(dir, file).split(path.sep)].join('/')

test('collect: locales and namespaces come back sorted by code point, whatever the file system lists', () => {
  withLocales(
    {
      'pt-br/alpha.json': '{}',
      'pt/alpha.json': '{}',
      'en/alpha.json': '{}',
      'en/Zeta.json': '{}',
      'en/beta.json': '{}',
      'en/a-b.json': '{}',
      'en/a.json': '{}',
    },
    (dir) => {
      const { collected } = collectTranslations(dir, display(dir))
      assert.deepEqual(Object.keys(collected), ['en', 'pt', 'pt-br'])
      assert.deepEqual(Object.keys(collected.en!), ['Zeta', 'a', 'a-b', 'alpha', 'beta'])
    },
  )
})

test('collect: a leading BOM is stripped', () => {
  withLocales({ 'en/common.json': '\uFEFF{ "title": "Hello" }' }, (dir) => {
    assert.deepEqual(collectTranslations(dir, display(dir)).collected, { en: { common: { title: 'Hello' } } })
  })
})

test('collect: invalid JSON rethrows with <localesDir>/<locale>/<file> in the message', () => {
  withLocales({ 'en/common.json': '{ "title": "Hello", }' }, (dir) => {
    assert.throws(() => collectTranslations(dir, display(dir)), /^Error: locales\/en\/common\.json is not valid JSON: /)
  })
})

test('collect: an empty file (or a BOM alone) is an error naming the file', () => {
  for (const content of ['', '  \n', '\uFEFF']) {
    withLocales({ 'de/pricing.json': content }, (dir) => {
      assert.throws(
        () => collectTranslations(dir, display(dir)),
        /^Error: locales\/de\/pricing\.json is empty: write \{\} for a namespace with no keys yet\./,
        JSON.stringify(content),
      )
    })
  }
})

test('collect: JSON files in subfolders of a locale folder are listed as ignored, not read', () => {
  const files = {
    'en/common.json': '{}',
    'en/drafts/old.json': 'not json',
    'en/drafts/deep/older.json': '{}',
    'en/notes.txt': 'x',
  }
  withLocales(files, (dir) => {
    const { collected, ignored } = collectTranslations(dir, display(dir))
    assert.deepEqual(collected, { en: { common: {} } })
    assert.deepEqual(ignored.sort(), ['locales/en/drafts/deep/older.json', 'locales/en/drafts/old.json'])
  })
})

test('.dev.vars: dotenv syntax, as wrangler reads it', () => {
  assert.deepEqual(
    parseDevVars(
      [
        '# Cloudflare',
        'TOKEN="abc"',
        "SINGLE='q r'",
        'export ZONE=zzz # inline comment',
        'PLAIN = value ',
        'HASH="a#b"',
        '',
      ].join('\n'),
    ),
    { TOKEN: 'abc', SINGLE: 'q r', ZONE: 'zzz', PLAIN: 'value', HASH: 'a#b' },
  )
  assert.deepEqual(parseDevVars('\uFEFFTOKEN=abc\r\nOTHER=1\r\n'), { TOKEN: 'abc', OTHER: '1' })
})
