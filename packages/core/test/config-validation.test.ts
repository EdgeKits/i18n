import assert from 'node:assert/strict'
import test from 'node:test'

import { defineI18nConfig } from '../src/types.ts'

const BASE = {
  languages: { en: { countryCode: 'us', name: 'English' }, de: { countryCode: 'de', name: 'Deutsch' } },
  defaultLocale: 'en',
  cookie: { name: 'lang', maxAge: 60 },
  keyPrefix: 'example.test',
  missingTranslationBanner: false,
  routing: 'prefix',
} as const

test('countryToLocale: a table of uppercase codes onto configured locales is accepted', () => {
  const config = defineI18nConfig({ ...BASE, countryToLocale: { US: 'en', DE: 'de', AT: 'de' } })
  assert.deepEqual(config.countryToLocale, { US: 'en', DE: 'de', AT: 'de' })
  assert.equal('countryToLocale' in defineI18nConfig(BASE), false, 'the field is optional')
})

test('countryToLocale: a value outside `languages` throws, naming the country', () => {
  assert.throws(
    // @ts-expect-error: 'ja' is not one of the config's languages
    () => defineI18nConfig({ ...BASE, countryToLocale: { US: 'en', JP: 'ja' } }),
    /`countryToLocale` maps "JP" to "ja", which is not one of `languages`: en, de\./,
  )
})

test('countryToLocale: a key that is not an uppercase alpha-2 code throws, naming it', () => {
  assert.throws(
    () => defineI18nConfig({ ...BASE, countryToLocale: { us: 'en' } }),
    /`countryToLocale` key "us" is not an uppercase ISO 3166-1 alpha-2 country code\./,
  )
  assert.throws(() => defineI18nConfig({ ...BASE, countryToLocale: { USA: 'en' } }), /key "USA"/)
})

test('markdownLocale: one of `languages` is accepted; the field is optional', () => {
  assert.equal(defineI18nConfig({ ...BASE, markdownLocale: 'de' }).markdownLocale, 'de')
  assert.equal('markdownLocale' in defineI18nConfig(BASE), false)
})

test('markdownLocale: a value outside `languages` throws, naming it', () => {
  assert.throws(
    // @ts-expect-error: 'ja' is not one of the config's languages
    () => defineI18nConfig({ ...BASE, markdownLocale: 'ja' }),
    /`markdownLocale` "ja" is not one of `languages`: en, de\./,
  )
})

test('languages: a key that is not all-lowercase throws, naming it; a lowercase region tag passes', () => {
  assert.throws(
    () => defineI18nConfig({ ...BASE, languages: { en: { name: 'English' }, 'pt-BR': { name: 'Português' } } }),
    /`languages` key "pt-BR" is not lowercase \(use "pt-br"\)\./,
  )
  const config = defineI18nConfig({ ...BASE, languages: { en: { name: 'English' }, 'pt-br': { name: 'Português' } } })
  assert.deepEqual(Object.keys(config.languages), ['en', 'pt-br'])
})

test('countryCode is optional: a locale with only a name validates', () => {
  const config = defineI18nConfig({ ...BASE, languages: { en: { name: 'English' }, eo: { name: 'Esperanto' } } })
  assert.deepEqual(config.languages.eo, { name: 'Esperanto' })
})
