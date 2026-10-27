import assert from 'node:assert/strict'
import test from 'node:test'

import { i18nMiddleware } from '../src/middleware/i18n.ts'

/**
 * Audit 2026-10-12 A02-1: redirects whose target depends on the visitor (cookie,
 * Accept-Language, country) are temporary and uncacheable; deterministic normalisations
 * stay permanent (301 outside `astro dev`; plain Node has no `import.meta.env`, which
 * counts as production). Driven with a small fake context; the fixture config has
 * en/de/es/ja, default en, cookie `lang`.
 */

type Fake = { cookie?: string; acceptLanguage?: string; country?: string }

type CookieSet = { name: string; value: string; options: Record<string, unknown> }

async function run(
  path: string,
  fake: Fake = {},
): Promise<{ response: Response; nextCalled: boolean; cookieSets: CookieSet[] }> {
  let nextCalled = false
  const cookieSets: CookieSet[] = []
  const headers = fake.acceptLanguage ? { 'Accept-Language': fake.acceptLanguage } : undefined
  const request = new Request(`https://example.com${path}`, { headers })
  Object.assign(request, { cf: fake.country ? { country: fake.country } : undefined })

  const context = {
    request,
    url: new URL(request.url),
    locals: {} as Record<string, unknown>,
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
    return new Response('<html></html>', { headers: { 'Content-Type': 'text/html' } })
  }

  const response = (await i18nMiddleware(context as never, next as never)) as Response
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
