import fs from 'node:fs'
import path from 'node:path'

import type { CollectedData, TranslationTree } from './generate.ts'

// Code point order: the same on every machine, whatever the file system lists first.
const byCodePoint = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

/**
 * Read `<localesDir>/<locale>/<namespace>.json` into the collected tree. A locale is a
 * folder of `localesDir` with at least one JSON file directly in it; JSON files in its
 * subfolders are not read and come back in `ignored`. Locales and namespaces are inserted
 * sorted by code point, so the generated files and the KV bulk data come out the same on
 * every machine. Throws, naming the file through `display`, on a file that is empty or not
 * JSON (a leading BOM is stripped first).
 */
export function collectTranslations(
  localesDir: string,
  display: (file: string) => string,
): { collected: CollectedData; ignored: string[] } {
  const collected: CollectedData = {}
  const ignored: string[] = []

  const localeDirs = fs
    .readdirSync(localesDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort(byCodePoint)

  for (const locale of localeDirs) {
    const localeDir = path.join(localesDir, locale)
    // Namespace names (not file names: `a-b.json` sorts before `a.json`, `a` before `a-b`).
    const entries = fs
      .readdirSync(localeDir, { withFileTypes: true, recursive: true })
      .sort((a, b) => byCodePoint(path.basename(a.name, '.json'), path.basename(b.name, '.json')))

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue

      const file = path.join(entry.parentPath, entry.name)
      if (entry.parentPath !== localeDir) {
        ignored.push(display(file))
        continue
      }

      const namespace = path.basename(entry.name, '.json')
      if (!collected[locale]) collected[locale] = {}
      collected[locale][namespace] = readTranslationFile(file, display)
    }
  }

  return { collected, ignored }
}

function readTranslationFile(file: string, display: (file: string) => string): TranslationTree {
  const raw = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')

  if (raw.trim() === '') {
    throw new Error(`${display(file)} is empty: write {} for a namespace with no keys yet.`)
  }

  try {
    return JSON.parse(raw) as TranslationTree
  } catch (err) {
    throw new Error(`${display(file)} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`)
  }
}
