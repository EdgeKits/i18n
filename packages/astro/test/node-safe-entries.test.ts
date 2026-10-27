import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import test from 'node:test'
import { pathToFileURL } from 'node:url'

import { localesOf, type LocaleOf } from '../src/config.entry.ts'

/**
 * `./config` and `./format` must load under plain Node: a project's unit tests and its
 * `src/content.config.ts` (evaluated by `astro sync`) import them. This suite's own
 * process maps the virtual ids and `cloudflare:workers` to fixtures (test/register.mjs),
 * which would hide exactly the failure this guards against, so the entries are loaded in
 * a child `node --import tsx` with no mapping at all.
 */

const ROOT = path.resolve(import.meta.dirname, '..')
const entryUrl = (file: string) => pathToFileURL(path.join(ROOT, 'src', file)).href

function loadInPlainNode(code: string): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '--eval', code], {
    cwd: ROOT,
    encoding: 'utf8',
  })
  return { status: result.status, stdout: result.stdout, stderr: result.stderr }
}

test('./config and ./format load under plain Node and work', () => {
  const { status, stdout, stderr } = loadInPlainNode(`
    const config = await import(${JSON.stringify(entryUrl('config.entry.ts'))})
    const format = await import(${JSON.stringify(entryUrl('format.ts'))})
    const locales = config.localesOf({
      languages: { en: { countryCode: 'us', name: 'English' }, de: { countryCode: 'de', name: 'Deutsch' } },
      defaultLocale: 'de',
      cookie: { name: 'lang', maxAge: 60 },
      keyPrefix: 'example.test',
      missingTranslationBanner: false,
      routing: 'prefix',
    })
    console.log(JSON.stringify({ locales, fmt: format.fmt('Hi {name}', { name: '<b>' }), tag: format.toIetfTag('pt-br') }))
  `)

  assert.equal(status, 0, `child failed:\n${stderr}`)
  assert.deepEqual(JSON.parse(stdout), {
    locales: {
      DEFAULT_LOCALE: 'de',
      SUPPORTED_LOCALES: ['en', 'de'],
      LANGUAGES: { en: { countryCode: 'us', name: 'English' }, de: { countryCode: 'de', name: 'Deutsch' } },
    },
    fmt: 'Hi &lt;b&gt;',
    tag: 'pt-BR',
  })
})

test('./format warning paths warn under plain Node instead of throwing', () => {
  const { status, stdout, stderr } = loadInPlainNode(`
    const format = await import(${JSON.stringify(entryUrl('format.ts'))})
    console.log(JSON.stringify({ fmt: format.fmt(null), pluralIcu: format.pluralIcu(2, 'en', { one: '{count} item' }) }))
  `)

  assert.equal(status, 0, `child failed:\n${stderr}`)
  assert.deepEqual(JSON.parse(stdout), { fmt: '', pluralIcu: '' })
  assert.match(stderr, /\[i18n\] fmt\(\) called with null\/undefined template/)
  assert.match(stderr, /\[i18n\] pluralIcu\(\): missing "other" pattern/)
})

const CONFIG = {
  languages: { en: { countryCode: 'us', name: 'English' }, ja: { countryCode: 'jp', name: '日本語' } },
  defaultLocale: 'ja',
  cookie: { name: 'lang', maxAge: 60 },
  keyPrefix: 'example.test',
  missingTranslationBanner: false,
  routing: 'prefix',
} as const

test('localesOf types the constants by the config’s own keys and validates at run time', () => {
  const { DEFAULT_LOCALE, SUPPORTED_LOCALES, LANGUAGES } = localesOf(CONFIG)

  // Compile-time: the literal union, with no I18nLocales augmentation in play.
  const exact: [LocaleOf<typeof CONFIG>] extends ['en' | 'ja'] ? true : false = true
  const defaultLocale: 'en' | 'ja' = DEFAULT_LOCALE
  const first: 'en' | 'ja' = SUPPORTED_LOCALES[0]
  assert.ok(exact)

  assert.equal(defaultLocale, 'ja')
  assert.equal(first, 'en')
  assert.equal(LANGUAGES.ja.name, '日本語')

  // @ts-expect-error: 'fr' is not one of the config's languages
  assert.throws(() => localesOf({ ...CONFIG, defaultLocale: 'fr' }), /`defaultLocale` "fr"/)
})
