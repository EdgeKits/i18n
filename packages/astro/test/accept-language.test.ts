import assert from 'node:assert/strict'
import test from 'node:test'

import { matchAcceptLanguage, parseAcceptLanguage } from '../src/accept-language.ts'

/**
 * The middleware's Accept-Language step, read by the package itself: Astro's
 * `preferredLocale` drops a regional tag (`es-MX`) before matching, so the language-part
 * fallback never ran. Each tag in `q` order, full tag then its language part; first hit wins.
 */

const parser =
  (locales: readonly string[]) =>
  (value: unknown): string | null =>
    typeof value === 'string' && locales.includes(value) ? value : null

const LOCALES = parser(['en', 'de', 'es', 'ja'])

test('a regional tag falls back to its language part', () => {
  assert.equal(matchAcceptLanguage('es-MX', LOCALES), 'es')
  assert.equal(matchAcceptLanguage('es-MX, en;q=0.8', LOCALES), 'es')
})

test('the tag order by q decides, not the first supported language', () => {
  assert.equal(matchAcceptLanguage('en-US, es;q=0.9', LOCALES), 'en')
  assert.equal(matchAcceptLanguage('fr-FR, de;q=0.7', LOCALES), 'de')
})

test('the full tag wins over the language part', () => {
  assert.equal(matchAcceptLanguage('pt-BR', parser(['en', 'pt-br'])), 'pt-br')
  assert.equal(matchAcceptLanguage('pt-BR', parser(['en', 'pt', 'pt-br'])), 'pt-br')
})

test('nothing supported, a wildcard, q=0 or no header: null', () => {
  assert.equal(matchAcceptLanguage('fr', LOCALES), null)
  assert.equal(matchAcceptLanguage('*', LOCALES), null)
  assert.equal(matchAcceptLanguage('en;q=0, de;q=0.5', LOCALES), 'de')
  assert.equal(matchAcceptLanguage(null, LOCALES), null)
  assert.equal(matchAcceptLanguage('', LOCALES), null)
})

test('a malformed q counts as 1', () => {
  assert.equal(matchAcceptLanguage('de;q=abc', LOCALES), 'de')
  assert.deepEqual(parseAcceptLanguage('ja;q=0.5, de;q=abc'), [
    { tag: 'de', q: 1 },
    { tag: 'ja', q: 0.5 },
  ])
})

test('parseAcceptLanguage: trimmed, q-sorted, header order kept among equals, q=0 and * dropped', () => {
  assert.deepEqual(parseAcceptLanguage(' fr-CH , fr;q=0.9, en;q=0.8, de;q=0.9, *;q=0.5, ja;q=0 '), [
    { tag: 'fr-CH', q: 1 },
    { tag: 'fr', q: 0.9 },
    { tag: 'de', q: 0.9 },
    { tag: 'en', q: 0.8 },
  ])
  assert.deepEqual(parseAcceptLanguage(null), [])
  assert.deepEqual(parseAcceptLanguage(''), [])
})

test('an underscore separates the language subtag too', () => {
  assert.equal(matchAcceptLanguage('es_MX', LOCALES), 'es')
})
