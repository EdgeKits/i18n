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
// `status` and `cacheControl` shape the response `next` returns; `locals`, what an earlier
// pass of the middleware left (Astro re-runs it for an error page).
type Fake = {
  cookie?: string
  acceptLanguage?: string
  country?: string
  contentType?: string
  routePattern?: string
  method?: string
  status?: number
  cacheControl?: string
  locals?: Record<string, unknown>
}
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
  const request = new Request(`https://example.com${path}`, { headers, method: fake.method ?? 'GET' })
  Object.assign(request, { cf: fake.country ? { country: fake.country } : undefined })

  const locals: Record<string, unknown> = { ...fake.locals }
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
    const responseHeaders: Record<string, string> = { 'Content-Type': fake.contentType ?? 'text/html' }
    if (fake.cacheControl) responseHeaders['Cache-Control'] = fake.cacheControl
    return new Response('<html></html>', { status: fake.status ?? 200, headers: responseHeaders })
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
  const missing = await run(handler, '/missing.xml', { routePattern: '/[lang]', status: 404 })
  assert.equal(missing.response.status, 404)
  assert.equal(missing.response.headers.get('Content-Type'), 'text/plain; charset=utf-8')
})

test("a [lang] route's /<default>/… form normalises permanently, without a trailing slash", async () => {
  const handler = middleware(FOUR)
  const { response, nextCalls } = await run(handler, '/en/rss.xml?x=1', { routePattern: '/[lang]/rss.xml' })
  assertRedirect(response, 301, '/rss.xml?x=1')
  assert.equal(nextCalls.length, 0)
  // No [lang] route behind it: no redirect, the soft 404.
  assert.equal((await run(handler, '/en/missing.xml', { routePattern: '/404', status: 404 })).response.status, 404)
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

// ---------------------------------------------------------------------------
// Lane 3 (0.3.0): files, islands, open redirect, error pages, responses, methods, case.
// ---------------------------------------------------------------------------

const payloads = (calls: Array<{ payload: unknown }>) => calls.map((c) => c.payload)

test('server islands and .well-known pass through untouched, their 200 HTML kept', async () => {
  const handler = middleware(FOUR)
  for (const [path, routePattern] of [
    ['/_server-islands/Greeting?e=x&p=y&s=z', '/_server-islands/[name]'],
    ['/_server-islands/Greeting/', '/_server-islands/[name]'],
    ['/.well-known/webfinger?resource=acct:a@example.com', '/404'],
    ['/.well-known/security.txt', '/.well-known/security.txt'],
  ]) {
    const { response, nextCalls } = await run(handler, path!, { routePattern })
    assert.deepEqual(payloads(nextCalls), [undefined], path)
    assert.equal(response.status, 200, path)
    assert.equal(await response.text(), '<html></html>', path)
  }
})

test('an ignored prefix matches on a segment boundary: /apis/ is a page', async () => {
  const handler = middleware(FOUR)
  assert.deepEqual(payloads((await run(handler, '/apis/')).nextCalls), ['/en/apis/'])
  assert.deepEqual(payloads((await run(handler, '/assets-guide/')).nextCalls), ['/en/assets-guide/'])
  assert.deepEqual(payloads((await run(handler, '/api', { contentType: 'application/json' })).nextCalls), [undefined])
  assert.deepEqual(payloads((await run(handler, '/api/x', { contentType: 'application/json' })).nextCalls), [undefined])
})

test('a file path is bypassed whatever its extension; a dotted page is not', async () => {
  const handler = middleware(FOUR)
  for (const path of ['/site.webmanifest', '/doc.pdf', '/feed.atom']) {
    const { response, nextCalls } = await run(handler, path, { contentType: 'application/octet-stream' })
    assert.equal(response.status, 200, path)
    assert.deepEqual(payloads(nextCalls), [undefined], path)
  }
  assertRedirect((await run(handler, '/blog/v2.0')).response, 301, '/blog/v2.0/')
})

test('the /<default>/… form of a [lang] file route is built from segments: never a // or /\\ Location', async () => {
  const handler = middleware(FOUR)
  for (const [path, location] of [
    ['/en//evil.com/x.png', '/evil.com/x.png'],
    ['/en/%5Cevil.com/x.png', '/%5Cevil.com/x.png'],
    ['/en/rss.xml', '/rss.xml'],
  ]) {
    const { response } = await run(handler, path!, { routePattern: '/[lang]/[...slug]', contentType: 'image/png' })
    assertRedirect(response, 301, location!)
    assert.doesNotMatch(response.headers.get('Location')!, /^\/[/\\]/, path)
  }
})

test('/404 and /500 pass through untouched; /de/404/ is served as a page', async () => {
  const handler = middleware(FOUR)
  for (const path of ['/404', '/404/', '/500']) {
    const { response, nextCalls, context } = await run(handler, path, {
      routePattern: '/404',
      status: 404,
      cookie: 'de',
    })
    assert.equal(response.status, 404, path)
    assert.equal(await response.text(), '<html></html>', `${path}: the page itself, not the soft 404`)
    assert.deepEqual(payloads(nextCalls), [undefined], path)
    assert.deepEqual(context.locals, { uiLocale: 'en', translationLocale: 'en' }, path)
  }
  const de = await run(handler, '/de/404/', { routePattern: '/[lang]/[...slug]' })
  assert.deepEqual(payloads(de.nextCalls), [undefined])
  assert.deepEqual(de.context.locals, { uiLocale: 'de', translationLocale: 'de' })
})

test('the error page re-entry (routePattern /404, pathname /404) keeps the locals and is not rewritten', async () => {
  const handler = middleware(FOUR)
  const locals = { uiLocale: 'de', translationLocale: 'de' }
  const { nextCalls, context } = await run(handler, '/404', { routePattern: '/404', status: 404, locals })
  assert.deepEqual(payloads(nextCalls), [undefined])
  assert.deepEqual(context.locals, locals)
})

test('the soft 404 replaces only a 404 HTML response', async () => {
  const handler = middleware(FOUR)
  const ok = await run(handler, '/api/x', { routePattern: '/api/[x]' })
  assert.equal(ok.response.status, 200)
  assert.equal(await ok.response.text(), '<html></html>')
  const error = await run(handler, '/api/x', { routePattern: '/api/[x]', status: 500 })
  assert.equal(error.response.status, 500)
  const missing = await run(handler, '/api/missing', { routePattern: '/404', status: 404 })
  assert.equal(missing.response.status, 404)
  assert.equal(missing.response.headers.get('Content-Type'), 'text/plain; charset=utf-8')
})

test('a default-locale page response carries Vary: Cookie (merged with an existing Vary)', async () => {
  const handler = middleware(FOUR)
  for (const path of ['/', '/about/', '/about/?x=1']) {
    assert.equal((await run(handler, path)).response.headers.get('Vary'), 'Cookie', path)
  }
  assert.equal((await run(handler, '/about/', { cookie: 'en' })).response.headers.get('Vary'), 'Cookie')
  assert.equal((await run(handler, '/de/about/')).response.headers.get('Vary'), null, 'another locale: no cookie read')
  assert.equal(
    (await run(handler, '/rss.xml', { routePattern: '/[lang]', contentType: 'application/xml' })).response.headers.get(
      'Vary',
    ),
    null,
  )
})

test('a response that writes the lang cookie is Cache-Control: private, merged, never weakening no-store', async (t) => {
  t.mock.method(console, 'warn', () => {})
  const handler = middleware(FOUR)
  const cases: Array<[path: string, cookie: string, given: string | undefined, expected: string | null]> = [
    ['/de/about/', 'ja', undefined, 'private'],
    ['/de/about/', 'ja', 'public, max-age=60, s-maxage=600', 'private, max-age=60'],
    ['/de/about/', 'ja', 'no-store', 'private, no-store'],
    ['/de/about', 'ja', undefined, 'private'],
    ['/about/', 'dark-mode', 'public, s-maxage=60', 'private'],
    ['/de/about/', 'de', 'public, max-age=60', 'public, max-age=60'],
  ]
  for (const [path, cookie, given, expected] of cases) {
    const { response } = await run(handler, path, { cookie, cacheControl: given })
    assert.equal(response.headers.get('Cache-Control'), expected, `${path} cookie=${cookie} ${given}`)
  }
})

test('POST, PUT, DELETE: permanent normalisations are 308, the cookie redirect 307', async () => {
  const handler = middleware(FOUR)
  for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) {
    assertRedirect((await run(handler, '/de/contact', { method })).response, 308, '/de/contact/')
    assertRedirect((await run(handler, '/en/contact/', { method })).response, 308, '/contact/')
    assertRedirect((await run(handler, '/contact', { method })).response, 308, '/contact/')
    assertRedirect((await run(handler, '/contact/', { method, cookie: 'de' })).response, 307, '/de/contact/')
  }
  for (const method of ['GET', 'HEAD']) {
    assertRedirect((await run(handler, '/de/contact', { method })).response, 301, '/de/contact/')
    assertRedirect((await run(handler, '/contact/', { method, cookie: 'de' })).response, 302, '/de/contact/')
  }
  const action = await run(handler, '/?_action=newsletter.subscribe', { method: 'POST' })
  assert.deepEqual(
    payloads(action.nextCalls),
    ['/en/?_action=newsletter.subscribe'],
    'a POST to a canonical URL is served',
  )
})

test('a locale segment in another case: one permanent redirect to the lower-case form', async () => {
  const handler = middleware(FOUR)
  for (const [path, location] of [
    ['/DE/about/', '/de/about/'],
    ['/De/about', '/de/about/'],
    ['/EN/about/', '/about/'],
    ['/JA/?x=1', '/ja/?x=1'],
    ['/DE/rss.xml', '/de/rss.xml'],
  ]) {
    const { response, nextCalls } = await run(handler, path!)
    assertRedirect(response, 301, location!)
    assert.equal(nextCalls.length, 0, path)
  }
  const regional = middleware(['en', 'pt-br'])
  assertRedirect((await run(regional, '/pt-BR/about/')).response, 301, '/pt-br/about/')
  assertRedirect((await run(handler, '/DE/about/', { method: 'POST' })).response, 308, '/de/about/')
})
