import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

/**
 * Headless guard for the package's `.astro` components: they carry structure, behaviour
 * and data-* hooks; every class comes from the consumer through the `classes` prop.
 *
 *   (a) no static class: no `class="…"` / `class='…'` literal, a `class={…}` expression
 *       is a bare `classes.<slot>` reference, and a `class:list` holds only those
 *       (plus a boolean guard such as `isActive && classes.itemActive`);
 *   (b) the client script toggles nothing through `classList`;
 *   (c) the documented data hooks are all present.
 */

const COMPONENTS_DIR = path.resolve(import.meta.dirname, '..', 'src', 'components')
const read = (name: string) => readFileSync(path.join(COMPONENTS_DIR, name), 'utf8')

const SWITCHER = 'LanguageSwitcher.astro'
const BANNER = 'MissingTranslationBanner.astro'

const SLOT_REF = /^classes\??\.[A-Za-z]+$/

function staticClassViolations(source: string): string[] {
  const violations: string[] = []

  for (const m of source.matchAll(/\bclass=(["'])(.*?)\1/g)) {
    if (m[2]!.trim() !== '') violations.push(`static class literal: ${m[0]}`)
  }

  for (const m of source.matchAll(/\bclass=\{([^}]*)\}/g)) {
    if (!SLOT_REF.test(m[1]!.trim())) violations.push(`class expression is not a slot: ${m[0]}`)
  }

  for (const m of source.matchAll(/\bclass:list=\{\[([\s\S]*?)\]\}/g)) {
    for (const entry of m[1]!.split(',')) {
      const item = entry.trim()
      if (!item) continue
      // A guarded entry (`cond && classes.slot`) is judged by its last operand.
      const operand = item.split('&&').at(-1)!.trim()
      if (/['"`]/.test(item) || !SLOT_REF.test(operand)) {
        violations.push(`class:list entry is not a slot: ${item}`)
      }
    }
  }

  return violations
}

function clientScript(source: string): string {
  return [...source.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join('\n')
}

for (const name of [SWITCHER, BANNER]) {
  test(`${name}: no static class names`, () => {
    assert.deepEqual(staticClassViolations(read(name)), [])
  })
}

test(`${SWITCHER}: the script toggles no class`, () => {
  const script = clientScript(read(SWITCHER))
  assert.ok(script.length > 0, 'expected a client <script>')
  assert.doesNotMatch(script, /\bclassList\b/)
})

test(`${SWITCHER}: visibility is the hidden attribute, data-open and aria-expanded`, () => {
  const source = read(SWITCHER)
  assert.match(source, /<div\s[^>]*\bdata-ls-dropdown\b[^>]*\shidden\b/)
  const script = clientScript(source)
  assert.match(script, /\.dropdown\.hidden\s*=/)
  assert.match(script, /\.dataset\.open\s*=/)
  assert.match(script, /setAttribute\('aria-expanded'/)
})

test(`${SWITCHER}: data hooks present`, () => {
  const source = read(SWITCHER)
  for (const hook of [
    'data-current-lang=',
    'data-cookie-name=',
    'data-cookie-max-age=',
    'data-open=',
    'data-ls-trigger',
    'data-ls-dropdown',
    'data-ls-item',
    'data-lang=',
    'data-active=',
  ]) {
    assert.ok(source.includes(hook), `missing ${hook}`)
  }
})

test(`${BANNER}: data hooks present`, () => {
  assert.ok(read(BANNER).includes('data-missing='), 'missing data-missing=')
})
