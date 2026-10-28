import assert from 'node:assert/strict'
import test from 'node:test'

import { Hono } from 'hono'
import { getPath } from 'hono/utils/url'

import { createTranslationsLoader, i18nMiddleware, isNamespaceList, type I18nVariables } from '../src/index.ts'
import { createFixture, LOCALE_CASES, preferenceOf, type FixtureLocale } from './fixtures/i18n.ts'

/**
 * The server entry: the Hono middleware through `app.request()`, the translations loader
 * over a Map-backed KV, and the namespace validator. One table of requests drives both the
 * middleware and the loader, so they cannot disagree.
 */

const { i18n } = createFixture()

function appWith(options: Parameters<typeof i18nMiddleware>[1]) {
  const app = new Hono<{ Variables: I18nVariables<FixtureLocale> }>()
  app.use(i18nMiddleware(i18n, options))
  app.get('/', (c) => c.text(c.var.locale))
  return app
}

for (const testCase of LOCALE_CASES) {
  test(`middleware and loader agree: ${testCase.name} -> ${testCase.expected}`, async () => {
    const middleware = preferenceOf(testCase)
    const response = await appWith(middleware.options).request('/', { headers: testCase.headers })
    assert.equal(response.status, 200)
    assert.equal(await response.text(), testCase.expected)
    assert.equal(response.headers.get('set-cookie'), null, 'the middleware never sets a cookie')

    const loader = preferenceOf(testCase)
    const load = createTranslationsLoader(i18n, loader.options)
    const { locale } = await load(new Request('https://app.test/', { headers: testCase.headers }), [])
    assert.equal(locale, testCase.expected)

    assert.equal(middleware.calls.length, loader.calls.length, 'userPreference consulted alike')
  })
}

test('userPreference is not called when the cookie is valid, and receives the request otherwise', async () => {
  const valid = preferenceOf({ name: '', headers: {}, preference: 'es', expected: 'en' })
  await appWith(valid.options).request('/', { headers: { cookie: 'lang=de' } })
  assert.equal(valid.calls.length, 0)

  const invalid = preferenceOf({ name: '', headers: {}, preference: 'es', expected: 'en' })
  await appWith(invalid.options).request('/path', { headers: { cookie: 'lang=xx' } })
  assert.equal(invalid.calls.length, 1)
  assert.equal(new URL(invalid.calls[0]!.url).pathname, '/path')
})

test('the middleware hands on: later middleware and the handler run, nothing is redirected', async () => {
  const app = new Hono<{ Variables: I18nVariables<FixtureLocale> & { seen: string } }>()
  app.use(i18nMiddleware(i18n))
  app.use(async (c, next) => {
    c.set('seen', `after:${c.var.locale}`)
    await next()
  })
  app.all('*', (c) => c.text(c.var.seen))

  const response = await app.request('/de/anything', { headers: { 'accept-language': 'es' } })
  assert.equal(response.status, 200)
  assert.equal(await response.text(), 'after:es')
})

test('c.var.locale is typed by the instance; the app needs only `Variables` added', () => {
  const app = new Hono<{ Variables: I18nVariables<FixtureLocale> }>()
  app.use(i18nMiddleware(i18n))
  app.get('/', (c) => {
    const locale: FixtureLocale = c.var.locale
    // @ts-expect-error a locale is not narrower than the config's keys
    const narrow: 'en' = c.var.locale
    return c.text(locale + narrow)
  })

  // A consumer's app: Bindings, its own Variables, a lower-casing getPath, a path pattern.
  type Env = { Bindings: { TRANSLATIONS: unknown }; Variables: I18nVariables & { session: string | null } }
  const consumer = new Hono<Env>({ getPath: (request) => getPath(request).toLowerCase() })
  consumer.use(i18nMiddleware(i18n, { userPreference: async () => null }))
  consumer.use('*', i18nMiddleware(i18n))
  consumer.get('/', (c) => c.text(`${c.var.locale}${c.var.session ?? ''}${typeof c.env.TRANSLATIONS}`))
  assert.ok(app && consumer)
})

test('the loader returns the namespaces asked for, read from KV in the resolved locale', async () => {
  const fixture = createFixture({
    'common:de': { title: 'Hallo' },
    'home:de': { hero: 'Willkommen' },
    'common:en': { title: 'Hello' },
  })
  const load = createTranslationsLoader(fixture.i18n)

  const de = await load(new Request('https://app.test/', { headers: { cookie: 'lang=de' } }), ['common', 'home'])
  assert.deepEqual(de, {
    locale: 'de',
    translationLocale: 'de',
    translations: { common: { title: 'Hallo' }, home: { hero: 'Willkommen' } },
  })
  assert.deepEqual(fixture.reads, [['tanstack.test:common:de', 'tanstack.test:home:de']])

  const en = await load(new Request('https://app.test/'), ['common'])
  assert.deepEqual(en, { locale: 'en', translationLocale: 'en', translations: { common: { title: 'Hello' } } })
})

test('isNamespaceList accepts only arrays of generated namespaces', () => {
  const isNamespaces = isNamespaceList(i18n)

  assert.equal(isNamespaces(['common']), true)
  assert.equal(isNamespaces(['common', 'home']), true)
  assert.equal(isNamespaces(['home', 'common']), true, 'any order')

  assert.equal(isNamespaces(['blog']), false, 'unknown namespace')
  assert.equal(isNamespaces(['common', 'blog']), false, 'one unknown among known')
  assert.equal(isNamespaces(['__proto__']), false)
  assert.equal(isNamespaces(['common:de']), false, 'no KV key fragments')
  assert.equal(isNamespaces('common'), false, 'a string is not a list')
  assert.equal(isNamespaces([1]), false)
  assert.equal(isNamespaces([['common']]), false)
  assert.equal(isNamespaces(null), false)
  assert.equal(isNamespaces(undefined), false)
  assert.equal(isNamespaces({ 0: 'common', length: 1 }), false)
})

test('isNamespaceList bounds the list: not empty, no repeats, no longer than NAMESPACE_KEYS', () => {
  const isNamespaces = isNamespaceList(i18n)

  assert.equal(isNamespaces([]), false, 'an empty list asks for nothing')
  assert.equal(isNamespaces(['common', 'common']), false, 'a repeat')
  assert.equal(isNamespaces(['home', 'common', 'home']), false, 'a repeat among distinct names')
  // Longer than the two generated namespaces: past the 100-key KV batch, one cache lookup each.
  assert.equal(isNamespaces(Array.from({ length: 101 }, () => 'common')), false, 'oversized')
  assert.equal(isNamespaces(['common', 'home', 'blog']), false, 'one more than NAMESPACE_KEYS')
})

test('the loader drops repeats before reading KV, for a caller that skips the validator', async () => {
  const fixture = createFixture({ 'common:de': { title: 'Hallo' } })
  const load = createTranslationsLoader(fixture.i18n)

  const result = await load(new Request('https://app.test/', { headers: { cookie: 'lang=de' } }), [
    'common',
    'common',
    'common',
  ])
  assert.deepEqual(result, { locale: 'de', translationLocale: 'de', translations: { common: { title: 'Hallo' } } })
  assert.deepEqual(fixture.reads, [['tanstack.test:common:de']], 'one key, once')
})

test('the loader reads the translation locale and keeps the UI locale', async () => {
  // `es` has no bundle: its UI renders with the default locale's translations.
  const fixture = createFixture({ 'common:en': { title: 'Hello' }, 'common:es': { title: 'Hola' } }, ['en', 'de'])
  const load = createTranslationsLoader(fixture.i18n)

  const es = await load(new Request('https://app.test/', { headers: { cookie: 'lang=es' } }), ['common'])
  assert.deepEqual(es, { locale: 'es', translationLocale: 'en', translations: { common: { title: 'Hello' } } })
  assert.deepEqual(fixture.reads, [['tanstack.test:common:en']])
})

const FAILING_HOOKS = [
  [
    'throwing',
    () => {
      throw new Error('preferences store down')
    },
  ],
  [
    'rejecting',
    async () => {
      throw new Error('preferences store down')
    },
  ],
] as const

for (const [kind, userPreference] of FAILING_HOOKS) {
  test(`a ${kind} userPreference: onUserPreferenceError once per request, then Accept-Language`, async () => {
    const errors: [unknown, Request][] = []
    const options = {
      userPreference,
      onUserPreferenceError: (error: unknown, request: Request) => void errors.push([error, request]),
    }
    const headers = { 'accept-language': 'de' }

    const response = await appWith(options).request('/?from=hook', { headers })
    assert.equal(response.status, 200)
    assert.equal(await response.text(), 'de')
    assert.equal(errors.length, 1, 'the middleware reports once')
    assert.equal((errors[0]![0] as Error).message, 'preferences store down')
    assert.equal(new URL(errors[0]![1].url).search, '?from=hook', 'the request is handed on')

    const { locale } = await createTranslationsLoader(i18n, options)(new Request('https://app.test/', { headers }), [])
    assert.equal(locale, 'de')
    assert.equal(errors.length, 2, 'the loader reports once')
  })

  test(`a ${kind} userPreference without onUserPreferenceError: one console.warn per request`, async (t) => {
    const warn = t.mock.method(console, 'warn', () => {})
    const options = { userPreference }
    const headers = { 'accept-language': 'es' }

    const response = await appWith(options).request('/', { headers })
    assert.equal(await response.text(), 'es')
    assert.equal(warn.mock.callCount(), 1)
    assert.deepEqual(warn.mock.calls[0]!.arguments.slice(0, 1), [
      '[@edgekits/tanstack-i18n] userPreference failed; falling back to Accept-Language',
    ])
    assert.equal((warn.mock.calls[0]!.arguments[1] as Error).message, 'preferences store down')

    const { locale } = await createTranslationsLoader(i18n, options)(new Request('https://app.test/', { headers }), [])
    assert.equal(locale, 'es')
    assert.equal(warn.mock.callCount(), 2)
  })
}
