import assert from 'node:assert/strict'
import test from 'node:test'

import { defineI18nConfig, type I18nConfig } from '../src/types.ts'

/**
 * `routing` is optional in the core and one of two modes when set; the core reads none of
 * it (an adapter interprets it and rejects the modes it does not support).
 */

const BASE = {
  languages: { en: { name: 'English' }, de: { name: 'Deutsch' } },
  defaultLocale: 'en',
  cookie: { name: 'lang', maxAge: 60 },
  keyPrefix: 'example.test',
  missingTranslationBanner: false,
} as const

test('routing: absent, prefix and prefix-except-default are accepted', () => {
  assert.equal('routing' in defineI18nConfig(BASE), false)
  assert.equal(defineI18nConfig({ ...BASE, routing: 'prefix' }).routing, 'prefix')
  assert.equal(defineI18nConfig({ ...BASE, routing: 'prefix-except-default' }).routing, 'prefix-except-default')
})

test('routing: anything else throws, naming the value', () => {
  assert.throws(
    () => defineI18nConfig({ ...BASE, routing: 'suffix' } as unknown as I18nConfig),
    /`routing` "suffix" is not supported; use 'prefix' or 'prefix-except-default'\./,
  )
})
