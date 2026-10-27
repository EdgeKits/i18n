import assert from 'node:assert/strict'
import test from 'node:test'

import { markdownRedirectTarget } from '../src/markdown-path.ts'

/**
 * The middleware's `.md` normalisation (markdown-path.ts): with `markdownLocale` the
 * rule the first consumer ran with `/en/` hardcoded, now with the locale as config;
 * without it, no redirect at all.
 */

const LOCALES = ['en', 'de', 'ja']
const isLocale = (segment: string) => LOCALES.includes(segment)

const CASES: Array<[pathname: string, markdownLocale: string | undefined, expected: string | null]> = [
  // With markdownLocale 'en' (the old hardcoded behaviour).
  ['/en/blog/x.md', 'en', null],
  ['/en/blog/x.md/', 'en', '/en/blog/x.md'],
  ['/de/blog/x.md', 'en', '/en/blog/x.md'],
  ['/de/blog/x.md/', 'en', '/en/blog/x.md'],
  ['/blog/x.md', 'en', '/en/blog/x.md'],
  ['/foo.md', 'en', '/en/foo.md'],
  ['/en/x.md', 'en', null],
  // Another markdownLocale: the same rule, a different target.
  ['/en/blog/x.md', 'de', '/de/blog/x.md'],
  ['/de/blog/x.md', 'de', null],
  ['/blog/x.md/', 'ja', '/ja/blog/x.md'],
  // Not a .md path: never a target.
  ['/de/blog/x/', 'en', null],
  ['/de/blog/x.mdx', 'en', null],
  ['/de/readme.md.html', 'en', null],
  // No markdownLocale: .md paths are left alone.
  ['/de/blog/x.md', undefined, null],
  ['/blog/x.md/', undefined, null],
  ['/foo.md', undefined, null],
]

for (const [pathname, markdownLocale, expected] of CASES) {
  test(`${pathname} with markdownLocale ${markdownLocale ?? '(none)'} -> ${expected ?? 'no redirect'}`, () => {
    assert.equal(markdownRedirectTarget(pathname, { isLocale, markdownLocale }), expected)
  })
}

test('the redirect target is already canonical: following it redirects no further', () => {
  for (const [pathname, markdownLocale] of CASES) {
    const target = markdownRedirectTarget(pathname, { isLocale, markdownLocale })
    if (target) assert.equal(markdownRedirectTarget(target, { isLocale, markdownLocale }), null, target)
  }
})
