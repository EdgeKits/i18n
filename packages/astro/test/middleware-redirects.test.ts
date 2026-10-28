import assert from 'node:assert/strict'
import test from 'node:test'

import type { MiddlewareHandler } from 'astro'
import { readCookieLang, setCookieLang, type CookieJar } from '@edgekits/i18n-core'

import { createI18nMiddleware, i18nMiddleware } from '../src/middleware/i18n.ts'

/**
 * Audit 2026-10-12 A02-1: redirects whose target depends on the visitor (cookie,
 * Accept-Language, country) are temporary and uncacheable; deterministic normalisations
 * stay permanent (301 outside `astro dev`; plain Node has no `import.meta.env`, which
 * counts as production). Driven with a small fake context; the fixture config has
 * en/de/es/ja, default en, cookie `lang`.
 */

type Fake = {
  cookie?: string
  acceptLanguage?: string
  country?: string
  method?: string
  status?: number
  routePattern?: string
  locals?: Record<string, unknown>
}

type CookieSet = { name: string; value: string; options: Record<string, unknown> }

async function run(
  path: string,
  fake: Fake = {},
  handler: MiddlewareHandler = i18nMiddleware,
): Promise<{ response: Response; nextCalled: boolean; cookieSets: CookieSet[] }> {
  let nextCalled = false
  const cookieSets: CookieSet[] = []
  const headers = fake.acceptLanguage ? { 'Accept-Language': fake.acceptLanguage } : undefined
  const request = new Request(`https://example.com${path}`, { headers, method: fake.method ?? 'GET' })
  Object.assign(request, { cf: fake.country ? { country: fake.country } : undefined })

  const context = {
    request,
    url: new URL(request.url),
    routePattern: fake.routePattern,
    locals: { ...fake.locals } as Record<string, unknown>,
    // Astro's value is not an input: the middleware reads the header itself. For a
    // regional tag (`de-DE`, `es-MX`) undefined is what Astro returns, since it filters
    // Accept-Language down to exact matches of its `i18n.locales` before picking one.
    preferredLocale: undefined,
    cookies: {
      get: (name: string) => (name === 'lang' && fake.cookie ? { value: fake.cookie } : undefined),
      set: (name: string, value: string, options: Record<string, unknown>) => {
        cookieSets.push({ name, value, options })
      },
    },
    redirect: (location: string, status = 302) => new Response(null, { status, headers: { Location: location } }),
  }
  const next = async () => {
    nextCalled = true
    return new Response('<html></html>', { status: fake.status ?? 200, headers: { 'Content-Type': 'text/html' } })
  }

  const response = (await handler(context as never, next as never)) as Response
  return { response, nextCalled, cookieSets }
}

function assertNegotiated(response: Response, location: string): void {
  assert.equal(response.status, 302)
  assert.equal(response.headers.get('Location'), location)
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store')
  assert.equal(response.headers.get('Vary'), 'Cookie, Accept-Language')
}

test('no locale in the URL: 302 to the negotiated locale, not cacheable', async () => {
  assertNegotiated((await run('/', { acceptLanguage: 'de' })).response, '/de/')
  assertNegotiated((await run('/', { cookie: 'ja', acceptLanguage: 'de' })).response, '/ja/')
  assertNegotiated((await run('/')).response, '/en/')
})

test('a regional Accept-Language tag negotiates its language (es-MX -> /es/)', async () => {
  assertNegotiated((await run('/', { acceptLanguage: 'es-MX' })).response, '/es/')
})

test('an invalid locale in the URL: 302 to the negotiated locale with the path kept, not cacheable', async () => {
  assertNegotiated((await run('/zz/about/', { cookie: 'es' })).response, '/es/zz/about/')
  assertNegotiated((await run('/blog/post', { acceptLanguage: 'de-DE' })).response, '/de/blog/post/')
})

test('trailing-slash normalisation stays permanent and carries no negotiation headers', async () => {
  const { response } = await run('/de/about', { acceptLanguage: 'en' })
  assert.equal(response.status, 301)
  assert.equal(response.headers.get('Location'), '/de/about/')
  assert.equal(response.headers.get('Vary'), null)
})

test('a canonical localized URL is served, not redirected', async () => {
  const { response, nextCalled } = await run('/de/about/', { acceptLanguage: 'en' })
  assert.equal(nextCalled, true)
  assert.equal(response.status, 200)
})

// The lang cookie sync on a URL that carries a valid locale (URL wins). The cache rule:
// a cookie-less request never gets a Set-Cookie.
test('no lang cookie: no Set-Cookie on a localized page', async () => {
  const { response, cookieSets } = await run('/de/about/')
  assert.equal(response.status, 200)
  assert.deepEqual(cookieSets, [])
})

test('a lang cookie equal to the URL locale is left alone', async () => {
  assert.deepEqual((await run('/de/about/', { cookie: 'de' })).cookieSets, [])
})

test('a valid lang cookie that differs from the URL locale is synced to it', async () => {
  const { cookieSets } = await run('/de/about/', { cookie: 'ja' })
  assert.deepEqual(
    cookieSets.map(({ name, value }) => ({ name, value })),
    [{ name: 'lang', value: 'de' }],
  )
})

test('an invalid lang cookie (foreign value, unknown locale) is corrected to the URL locale', async (t) => {
  t.mock.method(console, 'warn', () => {}) // the dev warning for an invalid cookie
  for (const foreign of ['fr', 'dark-mode', ' ']) {
    const { cookieSets } = await run('/es/', { cookie: foreign })
    assert.deepEqual(
      cookieSets.map(({ name, value }) => ({ name, value })),
      [{ name: 'lang', value: 'es' }],
      `cookie ${JSON.stringify(foreign)}`,
    )
  }
})

test('the lang cookie is not httpOnly', async () => {
  // Two writers by design: the LanguageSwitcher's client script (`document.cookie`) and
  // this sync. An httpOnly copy could never be overwritten by the switcher again, so a
  // stale value would disable it for good.
  const [set] = (await run('/de/', { cookie: 'en' })).cookieSets
  assert.equal(set?.options.httpOnly, false)
  assert.equal(set?.options.sameSite, 'lax')
  assert.equal(set?.options.path, '/')
})

// The fixture's middleware with `markdownLocale: 'en'`, the fixture has none.
function withMarkdownLocale(): MiddlewareHandler {
  const locales = ['en', 'de', 'es', 'ja']
  const parseLocale = (value: unknown) => (typeof value === 'string' && locales.includes(value) ? value : null)
  const cookie = { name: 'lang', parseLocale }
  const jar = (cookies: any): CookieJar => ({
    get: (name) => cookies.get(name)?.value,
    set: (name, value, options) => cookies.set(name, value, options),
  })
  return createI18nMiddleware({
    routing: 'prefix',
    defaultLocale: 'en',
    markdownLocale: 'en',
    countryToLocale: undefined,
    parseLocale,
    resolveLocaleForTranslations: (locale) => locale,
    readCookieLang: (cookies) => readCookieLang(jar(cookies), cookie),
    setCookieLang: (cookies, locale) => setCookieLang(jar(cookies), locale, { ...cookie, maxAge: 60, secure: true }),
  })
}

// The query string survives every redirect.
test('query kept: no locale in the URL', async () => {
  assertNegotiated((await run('/?utm=x')).response, '/en/?utm=x')
})

test('query kept: no locale in the URL, a lang cookie', async () => {
  assertNegotiated((await run('/?utm=x', { cookie: 'de' })).response, '/de/?utm=x')
})

test('query kept: an invalid first segment', async () => {
  assertNegotiated((await run('/about?x=1')).response, '/en/about/?x=1')
})

test('query kept: trailing-slash normalisation', async () => {
  const { response } = await run('/de/blog?x=1')
  assert.equal(response.status, 301)
  assert.equal(response.headers.get('Location'), '/de/blog/?x=1')
  assert.equal(response.headers.get('Vary'), null)
})

test('query kept: a .md path moved to markdownLocale', async () => {
  const { response } = await run('/de/x.md?x=1', {}, withMarkdownLocale())
  assert.equal(response.status, 301)
  assert.equal(response.headers.get('Location'), '/en/x.md?x=1')
})

// Lane 3 (0.3.0) in 'prefix': error pages, methods, case, the bypass list.

test('prefix: /404 and /500 pass through untouched, with the default locale in locals', async () => {
  for (const path of ['/404', '/404/', '/500']) {
    const { response, nextCalled } = await run(path, { status: 404, cookie: 'de' })
    assert.equal(nextCalled, true, path)
    assert.equal(response.status, 404, path)
    assert.equal(await response.text(), '<html></html>', path)
  }
  const de = await run('/de/404/')
  assert.equal(de.nextCalled, true)
})

test('prefix: the error page re-entry (the original path, routePattern /404 or /500) is served, not redirected', async () => {
  for (const [path, routePattern] of [
    ['/missing/', '/404'],
    ['/zz/about/', '/404'],
    ['/de/broken/', '/500'],
  ]) {
    const locals = { uiLocale: 'de', translationLocale: 'de' }
    const { response, nextCalled } = await run(path!, { routePattern, status: 404, locals, acceptLanguage: 'ja' })
    assert.equal(nextCalled, true, path)
    assert.equal(response.status, 404, path)
    assert.equal(response.headers.get('Location'), null, path)
  }
})

test('prefix: POST without a locale is 307, a missing trailing slash 308', async () => {
  const root = (await run('/', { method: 'POST', acceptLanguage: 'de' })).response
  assert.equal(root.status, 307)
  assert.equal(root.headers.get('Location'), '/de/')
  assert.equal(root.headers.get('Cache-Control'), 'private, no-store')
  const slash = (await run('/de/contact', { method: 'POST' })).response
  assert.equal(slash.status, 308)
  assert.equal(slash.headers.get('Location'), '/de/contact/')
  assert.equal((await run('/', { method: 'HEAD' })).response.status, 302)
})

test('prefix: a locale segment in another case is one permanent redirect', async () => {
  for (const [path, location] of [
    ['/DE/about/', '/de/about/'],
    ['/EN/', '/en/'],
    ['/Ja/blog/x', '/ja/blog/x/'],
  ]) {
    const { response } = await run(path!)
    assert.equal(response.status, 301, path)
    assert.equal(response.headers.get('Location'), location, path)
  }
})

test('prefix: islands, .well-known and /api/ pass; /apis/ is negotiated', async () => {
  for (const path of ['/_server-islands/Greeting?e=1', '/.well-known/webfinger', '/api/x']) {
    const { response, nextCalled } = await run(path)
    assert.equal(nextCalled, true, path)
    assert.equal(response.status, 200, path)
  }
  assertNegotiated((await run('/apis/')).response, '/en/apis/')
})
