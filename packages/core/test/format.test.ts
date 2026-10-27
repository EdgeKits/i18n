import assert from 'node:assert/strict'
import test from 'node:test'

import { localizedPath, replaceLocaleInPath, type LocalizedPathOptions } from '../src/format.ts'

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
