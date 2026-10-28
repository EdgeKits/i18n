import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { localizedPath, type I18nRouting } from '@edgekits/i18n-core'
import ts from 'typescript'

/**
 * The switcher's client script inlines the core's `localizedPath` (a client script imports
 * types only). The inlined function is lifted out of the component's source, transpiled
 * and compared with the core's on canonical URLs of both modes, file paths included. The
 * navigation keeps the query string.
 */

const SOURCE = readFileSync(
  path.resolve(import.meta.dirname, '..', 'src', 'components', 'LanguageSwitcher.astro'),
  'utf8',
)

type Inlined = (
  pathname: string,
  targetLang: string,
  currentLang: string,
  routing: string,
  defaultLocale: string,
) => string

function inlined(): Inlined {
  const match = /^ {2}function localizedPathOf\([\s\S]*?^ {2}\}$/m.exec(SOURCE)
  assert.ok(match, 'function localizedPathOf in the script')
  const js = ts.transpileModule(match[0], { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  return new Function(`${js}\nreturn localizedPathOf`)() as Inlined
}

const LOCALES = ['en', 'de', 'ja']

test('the inlined localizedPath equals the core on canonical URLs, both modes', () => {
  const fn = inlined()
  for (const routing of ['prefix', 'prefix-except-default'] as I18nRouting[]) {
    const options = { routing, defaultLocale: 'en', isLocale: (s: string) => LOCALES.includes(s) }
    const canonical = (locale: string, rest: string) => localizedPath(locale, rest, options)
    for (const current of LOCALES) {
      for (const rest of ['/', '/about/', '/blog/post-1/', '/rss.xml', '/blog/x.md', '/blog/v2.0/']) {
        const pathname = canonical(current, rest)
        for (const target of LOCALES) {
          assert.equal(
            fn(pathname, target, current, routing, 'en'),
            localizedPath(target, pathname, options),
            `${routing}: ${pathname} (${current}) -> ${target}`,
          )
        }
      }
    }
  }
})

test('the switcher navigates to the localized path with the query string, without the hash', () => {
  assert.match(
    SOURCE,
    /window\.location\.href =\s*localizedPathOf\(\s*window\.location\.pathname,[\s\S]*?\) \+ window\.location\.search/,
  )
  assert.doesNotMatch(SOURCE, /location\.hash/)
})
