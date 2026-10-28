import assert from 'node:assert/strict'
import test from 'node:test'

import {
  isFilePath,
  localizedPath,
  plural,
  replaceLocaleInPath,
  toIetfTag,
  type LocalizedPathOptions,
} from '../src/format.ts'

/**
 * `localizedPath`: the page path in a locale for either routing mode. In 'prefix' it agrees
 * with `replaceLocaleInPath` on canonical paths (leading and trailing slash); in
 * 'prefix-except-default' the default locale drops its prefix.
 */

const LOCALES = ['en', 'de', 'ja']
const options = (routing: LocalizedPathOptions['routing']): LocalizedPathOptions => ({
  routing,
  defaultLocale: 'en',
  isLocale: (segment) => LOCALES.includes(segment),
})

test("'prefix': equals replaceLocaleInPath on canonical paths", () => {
  for (const path of ['/en/', '/en/about/', '/en/blog/post-1/']) {
    for (const target of LOCALES) {
      assert.equal(
        localizedPath(target, path, options('prefix')),
        replaceLocaleInPath(path, 'en', target),
        `${path} -> ${target}`,
      )
    }
  }
})

test("'prefix-except-default': the default locale at the root, the others prefixed", () => {
  const cases: Array<[locale: string, input: string, expected: string]> = [
    // The root
    ['en', '/', '/'],
    ['de', '/', '/de/'],
    // A bare default-locale page
    ['en', '/about/', '/about/'],
    ['de', '/about/', '/de/about/'],
    // A nested path
    ['ja', '/blog/post-1/', '/ja/blog/post-1/'],
    ['en', '/de/blog/post-1/', '/blog/post-1/'],
    // The default locale given a prefixed input (the rewritten URL, or a stale link)
    ['en', '/en/about/', '/about/'],
    ['en', '/en/', '/'],
    ['de', '/en/about/', '/de/about/'],
    // Non-canonical `/en`: the locale segment is stripped and a trailing slash added
    ['en', '/en', '/'],
    ['de', '/en', '/de/'],
  ]
  for (const [locale, input, expected] of cases) {
    assert.equal(localizedPath(locale, input, options('prefix-except-default')), expected, `${locale} ${input}`)
  }
})

test('routing absent means prefix-except-default', () => {
  assert.equal(localizedPath('en', '/de/about/', options(undefined)), '/about/')
  assert.equal(localizedPath('de', '/about/', options(undefined)), '/de/about/')
})

test("'prefix': a non-canonical /en gets the trailing slash replaceLocaleInPath does not add", () => {
  // No equality claim here: replaceLocaleInPath('/en', 'en', 'de') returns '/en' unchanged.
  assert.equal(localizedPath('de', '/en', options('prefix')), '/de/')
  assert.equal(localizedPath('en', '/about', options('prefix')), '/en/about/')
})

test('isFilePath: the last segment ends in an extension that starts with a letter', () => {
  const cases: Array<[path: string, expected: boolean]> = [
    ['/rss.xml', true],
    ['/feed.json', true],
    ['/x.webmanifest', true],
    ['/doc.pdf', true],
    ['/de/blog/x.md', true],
    ['/IMG.PNG', true],
    ['/blog/v2.0', false],
    ['/about/', false],
    ['/rss.xml/', false],
    ['/', false],
    ['/archive.tar.gz', true],
    ['/x.averyverylongext', false],
    ['/v1.2.3', false],
  ]
  for (const [path, expected] of cases) assert.equal(isFilePath(path), expected, path)
})

test('localizedPath: a file path keeps no trailing slash, in both modes', () => {
  const cases: Array<[routing: LocalizedPathOptions['routing'], locale: string, input: string, expected: string]> = [
    ['prefix-except-default', 'en', '/rss.xml', '/rss.xml'],
    ['prefix-except-default', 'de', '/rss.xml', '/de/rss.xml'],
    ['prefix-except-default', 'en', '/de/rss.xml', '/rss.xml'],
    ['prefix-except-default', 'en', '/en//evil.com/x.png', '/evil.com/x.png'],
    ['prefix', 'en', '/rss.xml', '/en/rss.xml'],
    ['prefix', 'de', '/en/blog/x.md', '/de/blog/x.md'],
    ['prefix-except-default', 'de', '/blog/v2.0', '/de/blog/v2.0/'],
  ]
  for (const [routing, locale, input, expected] of cases) {
    assert.equal(localizedPath(locale, input, options(routing)), expected, `${routing} ${locale} ${input}`)
  }
})

test('localizedPath: a backslash separates segments, so no result starts with // or /\\', () => {
  const cases: Array<[routing: LocalizedPathOptions['routing'], locale: string, input: string, expected: string]> = [
    ['prefix-except-default', 'en', '/\\evil.com/', '/evil.com/'],
    ['prefix-except-default', 'en', '/\\evil.com/x/', '/evil.com/x/'],
    ['prefix-except-default', 'en', '/de/\\evil.com/', '/evil.com/'],
    ['prefix-except-default', 'en', '/a\\b/', '/a/b/'],
    ['prefix-except-default', 'de', '/a\\b/', '/de/a/b/'],
    ['prefix', 'en', '/de\\about/', '/en/about/'],
    // A tab or newline is dropped, as the URL parser drops it: `/\t/evil.com/` is not `//evil.com/`.
    ['prefix-except-default', 'en', '/\t/evil.com/', '/evil.com/'],
    ['prefix-except-default', 'en', '/\n/evil.com/x/', '/evil.com/x/'],
    // Encoded, it is one segment and stays as sent.
    ['prefix-except-default', 'en', '/%5Cevil.com/', '/%5Cevil.com/'],
    ['prefix-except-default', 'en', '/%5C%5Cevil.com/x/', '/%5C%5Cevil.com/x/'],
  ]
  for (const [routing, locale, input, expected] of cases) {
    const result = localizedPath(locale, input, options(routing))
    assert.equal(result, expected, `${routing} ${locale} ${input}`)
    assert.equal(new URL(result, 'https://example.com').host, 'example.com', input)
  }
})

test('localizedPath: a ?query and a #hash in the input are kept after the path', () => {
  const cases: Array<[routing: LocalizedPathOptions['routing'], locale: string, input: string, expected: string]> = [
    ['prefix-except-default', 'de', '/about/?x=1#top', '/de/about/?x=1#top'],
    ['prefix-except-default', 'en', '/de/about?x=1', '/about/?x=1'],
    ['prefix-except-default', 'de', '/#top', '/de/#top'],
    ['prefix', 'ja', '/en/rss.xml?page=2', '/ja/rss.xml?page=2'],
    ['prefix', 'de', '/en/a/#b?c', '/de/a/#b?c'],
  ]
  for (const [routing, locale, input, expected] of cases) {
    assert.equal(localizedPath(locale, input, options(routing)), expected, `${routing} ${locale} ${input}`)
  }
})

test('toIetfTag: each subtag after the language cased by length', () => {
  const cases: Array<[input: string, expected: string]> = [
    ['en', 'en'],
    ['pt-br', 'pt-BR'],
    ['en-us', 'en-US'],
    ['zh-hant-tw', 'zh-Hant-TW'],
    ['zh-hant', 'zh-Hant'],
    ['es-419', 'es-419'],
    ['sr-latn-rs', 'sr-Latn-RS'],
  ]
  for (const [input, expected] of cases) assert.equal(toIetfTag(input), expected, input)
})

test('plural: both forms interpolate {count}', () => {
  const cases: Array<[count: number, expected: string]> = [
    [0, '0 items'],
    [1, '1 item'],
    [2, '2 items'],
  ]
  for (const [count, expected] of cases)
    assert.equal(plural(count, '{count} item', '{count} items'), expected, String(count))
  assert.equal(plural(1, 'one item', '{count} items'), 'one item', 'a form without {count} as is')
})
