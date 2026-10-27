import assert from 'node:assert/strict'
import test from 'node:test'

import { readCookieLang, setCookieLang, type CookieJar } from '@edgekits/i18n-core'

import { createI18nMiddleware, type I18nMiddlewareDeps } from '../src/middleware/i18n.ts'

/**
 * routing 'prefix-except-default': the default locale (en) at the root, the others under
 * their prefix. A middleware built for the mode with `createI18nMiddleware`, driven by a
 * fake context whose `next` records the rewrite payload it is handed. Plain Node has no
 * `import.meta.env`, so deterministic normalisations are 301.
 */

// `routePattern`: the route Astro matched for the original URL, before any rewrite.
type Fake = { cookie?: string; acceptLanguage?: string; country?: string; contentType?: string; routePattern?: string }
type CookieSet = { name: string; value: string }

function middleware(locales: string[], extra: Partial<I18nMiddlewareDeps> = {}) {
  const parseLocale = (value: unknown) => (typeof value === 'string' && locales.includes(value) ? value : null)
  const cookie = { name: 'lang', parseLocale }
  // Astro's cookies as the core's jar, as cookie-storage.ts does.
  const jar = (cookies: any): CookieJar => ({
    get: (name) => cookies.get(name)?.value,
    set: (name, value, options) => cookies.set(name, value, options),
  })
  return createI18nMiddleware({
    routing: 'prefix-except-default',
    defaultLocale: 'en',
    markdownLocale: undefined,
    countryToLocale: { DE: 'de' },
    parseLocale,
    resolveLocaleForTranslations: (locale) => locale,
    readCookieLang: (cookies) => readCookieLang(jar(cookies), cookie),
    setCookieLang: (cookies, locale) => setCookieLang(jar(cookies), locale, { ...cookie, maxAge: 60, secure: true }),
    ...extra,
  })
}

const FOUR = ['en', 'de', 'es', 'ja']

async function run(handler: ReturnType<typeof middleware>, path: string, fake: Fake = {}) {
  const cookieSets: CookieSet[] = []
  const nextCalls: Array<{ payload: unknown; locals: Record<string, unknown> }> = []
  const headers: Record<string, string> = {}
  if (fake.acceptLanguage) headers['Accept-Language'] = fake.acceptLanguage
  const request = new Request(`https://example.com${path}`, { headers })
  Object.assign(request, { cf: fake.country ? { country: fake.country } : undefined })

  const locals: Record<string, unknown> = {}
  const context = {
    request,
    url: new URL(request.url),
    routePattern: fake.routePattern,
    locals,
    cookies: {
      get: (name: string) => (name === 'lang' && fake.cookie !== undefined ? { value: fake.cookie } : undefined),
      set: (name: string, value: string) => void cookieSets.push({ name, value }),
    },
    redirect: (location: string, status = 302) => new Response(null, { status, headers: { Location: location } }),
  }
  const next = async (payload?: unknown) => {
    nextCalls.push({ payload, locals: { ...context.locals } })
    return new Response('<html></html>', { headers: { 'Content-Type': fake.contentType ?? 'text/html' } })
  }

  const response = (await handler(context as never, next as never)) as Response
  return { response, nextCalls, cookieSets, context }
}

function assertRedirect(response: Response, status: number, location: string): void {
  assert.equal(response.status, status)
  assert.equal(response.headers.get('Location'), location)
}

test('the default locale prefix normalises permanently to the path without it', async () => {
  const handler = middleware(FOUR)
  for (const [from, to] of [
    ['/en/about/', '/about/'],
    ['/en/', '/'],
    ['/en/about', '/about/'],
    ['/en', '/'],
  ]) {
    const { response, nextCalls } = await run(handler, from!, { cookie: 'de' })
    assertRedirect(response, 301, to!)
    assert.equal(response.headers.get('Vary'), null, from)
    assert.equal(nextCalls.length, 0, from)
  }
})

test("another locale's prefix: today's branch (served, locals, cookie sync, trailing slash)", async () => {
  const handler = middleware(FOUR)
  const served = await run(handler, '/de/about/', { cookie: 'ja' })
  assert.deepEqual(
    served.nextCalls.map((c) => c.payload),
    [undefined],
  )
  assert.deepEqual(served.context.locals, { uiLocale: 'de', translationLocale: 'de' })
  assert.deepEqual(served.cookieSets, [{ name: 'lang', value: 'de' }])

  assert.deepEqual((await run(handler, '/de/about/')).cookieSets, [], 'no cookie, no Set-Cookie')
  assertRedirect((await run(handler, '/de/about')).response, 301, '/de/about/')
})

test('a default-locale page renders by rewrite to /<default>/…, with the locals untouched', async () => {
  const handler = middleware(FOUR)
  for (const [path, payload] of [
    ['/', '/en/'],
    ['/about/', '/en/about/'],
    ['/blog/post-1/', '/en/blog/post-1/'],
  ]) {
    const { response, nextCalls, context } = await run(handler, path!)
    assert.equal(response.status, 200, path)
    assert.deepEqual(nextCalls, [{ payload, locals: { uiLocale: 'en', translationLocale: 'en' } }], path)
    // The same object the rewritten request renders with: nothing replaced it.
    assert.deepEqual(context.locals, { uiLocale: 'en', translationLocale: 'en' }, path)
  }
})

test('the root consults neither Accept-Language nor the country', async () => {
  const handler = middleware(FOUR)
  const { response, nextCalls } = await run(handler, '/', { acceptLanguage: 'de-DE', country: 'DE' })
  assert.equal(response.status, 200)
  assert.deepEqual(
    nextCalls.map((c) => c.payload),
    ['/en/'],
  )
})

test('a valid cookie for another locale: 302 to its localized path, keyed on Cookie only', async () => {
  const handler = middleware(FOUR)
  for (const [path, location] of [
    ['/', '/de/'],
    ['/about/', '/de/about/'],
    ['/about', '/de/about/'],
  ]) {
    const { response, nextCalls, cookieSets } = await run(handler, path!, { cookie: 'de', acceptLanguage: 'ja' })
    assertRedirect(response, 302, location!)
    assert.equal(response.headers.get('Cache-Control'), 'private, no-store')
    assert.equal(response.headers.get('Vary'), 'Cookie')
    assert.equal(nextCalls.length, 0)
    assert.deepEqual(cookieSets, [])
  }
})

test('a cookie equal to the default locale is left alone and the page renders', async () => {
  const { response, cookieSets, nextCalls } = await run(middleware(FOUR), '/about/', { cookie: 'en' })
  assert.equal(response.status, 200)
  assert.deepEqual(cookieSets, [])
  assert.deepEqual(
    nextCalls.map((c) => c.payload),
    ['/en/about/'],
  )
})

test('an invalid cookie is corrected to the default locale, and the page renders', async (t) => {
  t.mock.method(console, 'warn', () => {})
  for (const foreign of ['fr', 'dark-mode']) {
    const { response, cookieSets, nextCalls } = await run(middleware(FOUR), '/about/', { cookie: foreign })
    assert.equal(response.status, 200, foreign)
    assert.deepEqual(cookieSets, [{ name: 'lang', value: 'en' }], foreign)
    assert.deepEqual(
      nextCalls.map((c) => c.payload),
      ['/en/about/'],
      foreign,
    )
  }
})

test('no cookie: no Set-Cookie on a default-locale page', async () => {
  assert.deepEqual((await run(middleware(FOUR), '/about/')).cookieSets, [])
})

test('a default-locale path without its trailing slash: 301, then (next request) the rewrite', async () => {
  const { response, nextCalls } = await run(middleware(FOUR), '/about')
  assertRedirect(response, 301, '/about/')
  assert.equal(response.headers.get('Vary'), null)
  assert.equal(nextCalls.length, 0)
})

test('.md without markdownLocale: a root path is rewritten to the default locale, a prefixed one passes', async () => {
  const handler = middleware(FOUR)
  const md = { contentType: 'text/markdown' }
  assert.deepEqual(
    (await run(handler, '/blog/x.md', md)).nextCalls.map((c) => c.payload),
    ['/en/blog/x.md'],
  )
  assert.deepEqual(
    (await run(handler, '/de/blog/x.md', md)).nextCalls.map((c) => c.payload),
    [undefined],
  )
})

test('.md with markdownLocale equal to the default: no prefix in the target', async () => {
  const handler = middleware(FOUR, { markdownLocale: 'en' })
  const md = { contentType: 'text/markdown' }
  assertRedirect((await run(handler, '/en/blog/x.md', md)).response, 301, '/blog/x.md')
  assertRedirect((await run(handler, '/de/blog/x.md/', md)).response, 301, '/blog/x.md')
  assertRedirect((await run(handler, '/blog/x.md/', md)).response, 301, '/blog/x.md')
  const canonical = await run(handler, '/blog/x.md', md)
  assert.equal(canonical.response.status, 200)
  assert.deepEqual(
    canonical.nextCalls.map((c) => c.payload),
    ['/en/blog/x.md'],
  )
})

test('.md with another markdownLocale: its prefix, as in prefix mode', async () => {
  const handler = middleware(FOUR, { markdownLocale: 'de' })
  const md = { contentType: 'text/markdown' }
  assertRedirect((await run(handler, '/blog/x.md', md)).response, 301, '/de/blog/x.md')
  assertRedirect((await run(handler, '/ja/blog/x.md', md)).response, 301, '/de/blog/x.md')
  assert.deepEqual(
    (await run(handler, '/de/blog/x.md', md)).nextCalls.map((c) => c.payload),
    [undefined],
  )
})

test('one configured locale: the mode degenerates on its own', async (t) => {
  t.mock.method(console, 'warn', () => {})
  const handler = middleware(['en'])

  const root = await run(handler, '/')
  assert.equal(root.response.status, 200)
  assert.deepEqual(root.cookieSets, [])
  assert.deepEqual(
    root.nextCalls.map((c) => c.payload),
    ['/en/'],
  )

  assertRedirect((await run(handler, '/en/')).response, 301, '/')

  for (const cookie of ['en', 'de', 'xx']) {
    for (const path of ['/', '/about/']) {
      const { response, nextCalls } = await run(handler, path, { cookie, acceptLanguage: 'de' })
      assert.equal(response.status, 200, `${path} with cookie ${cookie}`)
      assert.equal(nextCalls.length, 1, `${path} with cookie ${cookie}`)
    }
  }
})

test('the query string survives every rewrite', async () => {
  const handler = middleware(FOUR)
  for (const [path, payload] of [
    ['/?sent=1', '/en/?sent=1'],
    ['/about/?_action=newsletter.subscribe', '/en/about/?_action=newsletter.subscribe'],
    ['/blog/x.md?x=1', '/en/blog/x.md?x=1'],
  ]) {
    const { nextCalls } = await run(handler, path!, { contentType: 'text/markdown' })
    assert.deepEqual(
      nextCalls.map((c) => c.payload),
      [payload],
      path,
    )
  }
})

test('the query string survives every redirect', async () => {
  const handler = middleware(FOUR)
  const cookie = await run(handler, '/?x=1', { cookie: 'de' })
  assertRedirect(cookie.response, 302, '/de/?x=1')
  assert.equal(cookie.response.headers.get('Vary'), 'Cookie')
  assertRedirect((await run(handler, '/en/?x=1')).response, 301, '/?x=1')
  assertRedirect((await run(handler, '/en/about?x=1')).response, 301, '/about/?x=1')
  assertRedirect((await run(handler, '/about?x=1')).response, 301, '/about/?x=1')
  assertRedirect((await run(handler, '/de/about?x=1')).response, 301, '/de/about/?x=1')
})

test('a locale-less path of a [lang] route is served for the default locale, whatever its extension', async () => {
  const handler = middleware(FOUR)
  const xml = { contentType: 'application/rss+xml' }
  // Astro matches `/rss.xml` against `/[lang]` (lang = "rss.xml"), or nothing (its 404 route).
  for (const routePattern of ['/[lang]', '/[lang]/rss.xml', '/404']) {
    const { response, nextCalls } = await run(handler, '/rss.xml?x=1', { ...xml, routePattern })
    assert.equal(response.status, 200, routePattern)
    assert.deepEqual(nextCalls, [{ payload: '/en/rss.xml?x=1', locals: { uiLocale: 'en', translationLocale: 'en' } }])
  }
  // Rewritten, then nothing renders but the 404 page: the soft 404.
  const missing = await run(handler, '/missing.xml', { routePattern: '/[lang]' })
  assert.equal(missing.response.status, 404)
  assert.equal(missing.response.headers.get('Content-Type'), 'text/plain; charset=utf-8')
})

test("a [lang] route's /<default>/… form normalises permanently, without a trailing slash", async () => {
  const handler = middleware(FOUR)
  const { response, nextCalls } = await run(handler, '/en/rss.xml?x=1', { routePattern: '/[lang]/rss.xml' })
  assertRedirect(response, 301, '/rss.xml?x=1')
  assert.equal(nextCalls.length, 0)
  // No [lang] route behind it: no redirect, the soft 404.
  assert.equal((await run(handler, '/en/missing.xml', { routePattern: '/404' })).response.status, 404)
})

test('root routes, ignored prefixes and other locales pass through unrewritten', async () => {
  const handler = middleware(FOUR)
  for (const [path, routePattern] of [
    ['/sitemap.xml', '/sitemap.xml'],
    ['/robots.txt', '/robots.txt'],
    ['/llms.txt', '/llms.txt'],
    ['/feeds/main.json', '/feeds/[id].json'],
    ['/favicon.ico', '/404'],
    ['/api/data.json', '/404'],
    ['/_astro/x.js', '/404'],
    ['/de/rss.xml', '/[lang]/rss.xml'],
  ]) {
    const { nextCalls } = await run(handler, path!, { contentType: 'application/xml', routePattern })
    assert.deepEqual(
      nextCalls.map((c) => c.payload),
      [undefined],
      path,
    )
  }
})
