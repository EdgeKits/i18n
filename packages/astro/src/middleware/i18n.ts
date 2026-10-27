import type { AstroCookies, MiddlewareHandler } from 'astro'
import {
  localizedPath,
  MARKDOWN_PATH,
  markdownRedirectTarget,
  resolveFallbackLocale as resolveFallbackFrom,
  type I18nRouting,
} from '@edgekits/i18n-core'
import { LocaleSchema } from '../schema'
import { I18N_CONFIG } from '../config'
import { DEFAULT_LOCALE, type Locale } from '../constants'
import { readCookieLang, setCookieLang, type CookieLang } from '../cookie-storage'
import { resolveLocaleForTranslations } from '../resolve-locale'

// Regex to identify public static assets (images, fonts, scripts, etc.)
// These files should bypass i18n routing and locale detection.
const PUBLIC_FILE_REGEX = /\.(ico|png|jpg|jpeg|svg|webp|gif|css|js|map|txt|xml|json|woff2?|avif|md)$/i

// List of URL prefixes that should be ignored by the i18n middleware.
// Includes API endpoints, internal Astro paths, and standard static routes.
// The Vite dev-server prefixes (/@vite, /@id, /@fs, /src, /node_modules) make
// dev survive `run_worker_first: ["/*"]` being left on: without them every
// dev-module request fell through to the locale logic, got redirected to
// /<locale>/@vite/... and rendered a full 404 page (with its translation
// fetches) per module. Harmless in prod — no real route starts with these.
const IGNORED_PREFIXES = [
  '/api',
  '/assets',
  '/_astro',
  '/_image',
  '/_actions',
  '/favicon',
  '/@vite',
  '/@id',
  '/@fs',
  '/src',
  '/node_modules',
]

// Extracts the context type from Astro's MiddlewareHandler for cleaner function signatures.
type I18nMiddlewareContext = Parameters<MiddlewareHandler>[0]

/**
 * What the middleware reads: the resolved routing mode, the locale settings and the lang
 * cookie over Astro's cookies. `i18nMiddleware` below is built from the project's config
 * and instance; tests build one for either mode or a single locale.
 */
export type I18nMiddlewareDeps = {
  routing: I18nRouting
  defaultLocale: Locale
  markdownLocale: string | undefined
  countryToLocale: Record<string, string> | undefined
  // The locale when the value is a supported one, otherwise null.
  parseLocale: (value: unknown) => Locale | null
  resolveLocaleForTranslations: (locale: Locale) => Locale
  readCookieLang: (cookies: AstroCookies) => CookieLang
  setCookieLang: (cookies: AstroCookies, locale: Locale) => void
}

// Two kinds of redirect, by whether the target depends on the visitor.
//
// Deterministic normalisations (a missing trailing slash, a `.md` path moved to
// `markdownLocale`, the default locale's prefix dropped in 'prefix-except-default') always
// lead to the same URL, so they are permanent in production: 301 consolidates canonical
// signals in Google. They use REDIRECT_STATUS: 302 under `astro dev`
// (`import.meta.env.DEV`) so nothing gets cached while testing, 301 in any production build
// (incl. `astro preview` / `wrangler dev`). `?.`: plain Node (the tests) has no
// `import.meta.env`, which counts as production.
//
// Negotiated redirects (no locale or an invalid one in the URL: the target comes from the
// visitor's cookie, Accept-Language or country) are always temporary and uncacheable, in
// dev and production alike: see negotiatedRedirect(). A browser keeps a 301 and never asks
// the server again, so a language chosen later in the switcher would be bypassed on the
// next visit to `/`, and the URL-wins cookie sync below would then overwrite that choice.
//
// Both kinds, in both routing modes, keep the query string (`?utm=…`, `?sent=1`).
const REDIRECT_STATUS = import.meta.env?.DEV ? 302 : 301

// A redirect whose target depends on the visitor: temporary, never stored by a shared
// cache, and keyed on the request headers that chose it (the country is not a request
// header, hence `no-store` rather than relying on Vary alone). `vary` names only the
// headers that were consulted: the root of 'prefix-except-default' reads the cookie alone.
function negotiatedRedirect(target: string, vary = 'Cookie, Accept-Language'): Response {
  return new Response(null, {
    status: 302,
    headers: {
      Location: target,
      'Cache-Control': 'private, no-store',
      Vary: vary,
    },
  })
}

const isIgnoredPrefix = (pathname: string) => IGNORED_PREFIXES.some((p) => pathname.startsWith(p))

// The project's localized routes live under `src/pages/[lang]/`. `context.routePattern` is
// the route Astro matched for the original URL, before any rewrite: a locale-less
// `/rss.xml` matches `/[lang]` (lang = "rss.xml") or nothing (the 404 route), never a
// root route of its own, which `/sitemap.xml` does.
const isLangRoute = (routePattern: string | undefined) =>
  routePattern === '/[lang]' || !!routePattern?.startsWith('/[lang]/')

// The pattern of the route Astro falls back to when nothing matched (a custom `404.astro`
// or its built-in one): astro/dist/core/routing/internal/astro-designed-error-pages.js.
const NOT_FOUND_ROUTE = '/404'

// Determines if the current request path matches static assets or ignored prefixes.
// Returns true to skip i18n processing for this request.
function shouldBypassI18n(pathname: string): boolean {
  if (PUBLIC_FILE_REGEX.test(pathname)) return true
  if (isIgnoredPrefix(pathname)) return true
  // Markdown endpoints: /en/blog/slug.md/ (with or without trailing slash)
  if (MARKDOWN_PATH.test(pathname)) return true
  return false
}

// Constructs a standardized localized URL path ensuring a trailing slash.
// Example: buildLocalizedPath('en', ['about', 'team']) -> '/en/about/team/'
function buildLocalizedPath(locale: Locale, rest: string[]): string {
  const suffix = rest.join('/')
  return suffix ? `/${locale}/${suffix}/` : `/${locale}/`
}

/** The i18n middleware for one set of deps (one routing mode, one locale list). */
export function createI18nMiddleware(deps: I18nMiddlewareDeps): MiddlewareHandler {
  const isLocale = (segment: string) => deps.parseLocale(segment) !== null
  const pathOptions = { routing: deps.routing, defaultLocale: deps.defaultLocale, isLocale }

  // Resolves the most appropriate locale for the user based on a fallback cascade
  // (the core's locale-fallback.ts, where the order is documented and tested):
  // 1. User's saved cookie preference.
  // 2. The Accept-Language header, read here rather than through Astro (which drops
  //    regional tags before matching): each tag by q, full tag, then its language part.
  // 3. Only when no tag matched: the Cloudflare Geo-IP country, through the project's
  //    `countryToLocale` table (skipped when the config has none).
  // 4. Finally, falls back to the application's default locale.
  function resolveFallbackLocale(context: I18nMiddlewareContext): Locale {
    return resolveFallbackFrom<Locale>(
      {
        cookieLocale: () => deps.readCookieLang(context.cookies).locale,
        acceptLanguage: () => context.request.headers.get('accept-language'),
        // cf is undefined in local dev unless simulated
        country: () => context.request?.cf?.country,
      },
      {
        parseLocale: deps.parseLocale,
        defaultLocale: deps.defaultLocale,
        countryToLocale: deps.countryToLocale,
      },
    )
  }

  // The `.md` redirect target, or null. 'prefix': the core's markdown-path.ts as is.
  // 'prefix-except-default': the same target without the default locale's prefix (through
  // localizedPath, minus the trailing slash a `.md` path never has); a path already at
  // `/<default>/…` is redirected too, since that is no longer canonical.
  function markdownTarget(pathname: string): string | null {
    const target = markdownRedirectTarget(pathname, { isLocale, markdownLocale: deps.markdownLocale })
    if (deps.routing === 'prefix') return target
    if (!deps.markdownLocale || !MARKDOWN_PATH.test(pathname)) return null

    const localized = localizedPath(deps.markdownLocale, target ?? pathname, pathOptions).slice(0, -1)
    return localized === pathname ? null : localized
  }

  // A URL that carries a valid locale: cookie sync, locals, trailing-slash normalisation.
  async function serveLocalized(
    context: I18nMiddlewareContext,
    next: Parameters<MiddlewareHandler>[1],
    urlLocale: Locale,
    segments: string[],
  ): Promise<Response> {
    const url = new URL(context.request.url)
    const pathname = url.pathname
    // Keep the lang cookie in sync with the URL locale — but ONLY update an
    // EXISTING cookie that differs or does not parse. Rationale (HTML edge cache, P1/P2):
    //   - The old unconditional set emitted `Set-Cookie` on EVERY localized
    //     response, which made every response uncacheable (the edge cache
    //     refuses anything carrying Set-Cookie).
    //   - Cookie-less requests (first visits, crawlers, every PSI/GTmetrix run)
    //     must produce NO Set-Cookie at all, otherwise lab tests never hit the
    //     cache and the TTFB jitter (P2) stays. So a missing cookie is NOT
    //     created here — the explicit language choice is persisted client-side
    //     by the LanguageSwitcher, and an existing cookie is re-synced below
    //     when the user lands on a different locale by any other means.
    //   - A cookie that is present but invalid (a foreign value from another site
    //     on the same host, a locale this site does not have) is corrected to the
    //     URL locale too, so a stale value never outlives the next request.
    const cookie = deps.readCookieLang(context.cookies)
    if (cookie.present && cookie.locale !== urlLocale) {
      deps.setCookieLang(context.cookies, urlLocale)
    }
    // Set uiLocale to Astro locals
    context.locals.uiLocale = urlLocale
    // Define and set translationLocale to Astro locals
    const translationLocale = deps.resolveLocaleForTranslations(urlLocale)
    context.locals.translationLocale = translationLocale

    // Normalize trailing slash and structure
    const normalized = buildLocalizedPath(urlLocale, segments.slice(1))
    if (pathname !== normalized) {
      return context.redirect(normalized + url.search, REDIRECT_STATUS)
    }

    return await next()
  }

  // 'prefix-except-default': the default locale at the root, the others under their prefix.
  async function serveExceptDefault(
    context: I18nMiddlewareContext,
    next: Parameters<MiddlewareHandler>[1],
    segments: string[],
    firstSegment: string | null,
  ): Promise<Response> {
    const { pathname, search } = new URL(context.request.url)
    const urlLocale = firstSegment ? deps.parseLocale(firstSegment) : null

    // The default locale's prefix is not canonical: one permanent hop to the path without it.
    if (urlLocale === deps.defaultLocale) {
      return context.redirect(localizedPath(deps.defaultLocale, pathname, pathOptions) + search, REDIRECT_STATUS)
    }

    if (urlLocale) {
      return await serveLocalized(context, next, urlLocale, segments)
    }

    // A default-locale page (the root included). The URL names its language, so neither
    // Accept-Language nor the country is consulted; only a saved choice of another locale
    // leads away from it.
    context.locals.uiLocale = deps.defaultLocale
    context.locals.translationLocale = deps.resolveLocaleForTranslations(deps.defaultLocale)

    const cookie = deps.readCookieLang(context.cookies)
    if (cookie.present && cookie.locale !== deps.defaultLocale) {
      if (cookie.locale) {
        return negotiatedRedirect(localizedPath(cookie.locale, pathname, pathOptions) + search, 'Cookie')
      }
      // Present but invalid: corrected to the URL's locale, as serveLocalized does.
      deps.setCookieLang(context.cookies, deps.defaultLocale)
    }

    const normalized = localizedPath(deps.defaultLocale, pathname, pathOptions)
    if (pathname !== normalized) {
      return context.redirect(normalized + search, REDIRECT_STATUS)
    }

    // The project's pages live under `src/pages/[lang]/`: render `/<default>/…` while the
    // URL stays. `next(path)` rewrites without running the middleware again
    // (astro/dist/core/middleware/astro-middleware.js:33-40) and keeps `locals`;
    // `context.rewrite()` would re-run it (astro/dist/core/rewrites/handler.js:67-71).
    // The rewritten URL is built from the string alone (core/routing/rewrite.js:22), and
    // `context.url`, Astro.url and Actions' `?_action=` read it: the query goes in too.
    return await next(`/${deps.defaultLocale}${pathname}${search}`)
  }

  // Main i18n middleware handler. Intercepts incoming requests, manages routing,
  // sets locale context, and handles soft 404 protections for edge environments.
  return async (context, next) => {
    const url = new URL(context.request.url)
    const pathname = url.pathname

    // 1. Split the URL early to access its segments
    const segments = pathname.split('/').filter(Boolean) // "/es/about/" -> ["es", "about"]
    const firstSegment = segments[0] ?? null

    // 2. SAFETY NET (For static file 404 pages)
    // Attempt to infer the locale from the URL, or fallback to the default.
    let safeLocale = deps.defaultLocale
    if (firstSegment) {
      const parsed = deps.parseLocale(firstSegment)
      if (parsed !== null) {
        safeLocale = parsed
      }
    }

    // Inject the locale into the context BEFORE the bypass check!
    context.locals.uiLocale = safeLocale
    context.locals.translationLocale = deps.resolveLocaleForTranslations(safeLocale)

    // 3. Bypass static files and system paths (with Soft 404 protection)
    if (shouldBypassI18n(pathname)) {
      // .md endpoints: one redirect to the project's `markdownLocale`, no trailing slash
      // (the core's markdown-path.ts). Without `markdownLocale` they pass through untouched.
      const target = markdownTarget(pathname)
      if (target) {
        return context.redirect(target + url.search, REDIRECT_STATUS)
      }

      // 'prefix-except-default': the default locale's `[lang]` routes answer at the root,
      // whatever the extension. A `.md` path without a locale segment always belongs to one;
      // any other path outside the ignored prefixes when Astro matched it to a `[lang]`
      // route or to none, while a root route of its own (`/sitemap.xml`) is served as is.
      // The `/<default>/…` form of a `[lang]` route moves to the root, as a page's does
      // (`.md` excepted: markdownTarget() above decides those).
      let rewrite: string | undefined
      if (deps.routing !== 'prefix') {
        const markdown = MARKDOWN_PATH.test(pathname)
        if (firstSegment === deps.defaultLocale && !markdown && isLangRoute(context.routePattern)) {
          return context.redirect(pathname.slice(deps.defaultLocale.length + 1) + url.search, REDIRECT_STATUS)
        }
        const langRouteOrNone = isLangRoute(context.routePattern) || context.routePattern === NOT_FOUND_ROUTE
        if (
          (!firstSegment || !isLocale(firstSegment)) &&
          (markdown || (langRouteOrNone && !isIgnoredPrefix(pathname)))
        ) {
          rewrite = `/${deps.defaultLocale}${pathname}${url.search}`
        }
      }
      const response = rewrite ? await next(rewrite) : await next()

      const contentType = response.headers.get('content-type') || ''
      const isHtml = contentType.includes('text/html')
      const isRedirect = response.status >= 300 && response.status < 400

      // If Astro attempts to return HTML for a static/API request (and it's not a redirect),
      // it means the file wasn't found and Astro rendered a fallback page (404.astro or catch-all).
      // We strictly intercept this and return a lightweight text-based 404 instead.
      // Why? To mitigate Directory Bruteforcing / Fuzzing attacks and save resources.
      if (isHtml && !isRedirect) {
        // Aggressively save Worker CPU cycles for missing static files
        return new Response('Not found', {
          status: 404,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        })
      }

      return response
    }

    if (deps.routing !== 'prefix') {
      return await serveExceptDefault(context, next, segments, firstSegment)
    }

    const fallbackLocale = resolveFallbackLocale(context)

    // 1. No locale in URL — redirect to fallback locale root
    if (!firstSegment) {
      const target = buildLocalizedPath(fallbackLocale, [])
      if (pathname !== target) {
        return negotiatedRedirect(target + url.search)
      }
      return await next()
    }

    // 2. URL has first segment — validate as locale
    const urlLocale = deps.parseLocale(firstSegment)

    if (urlLocale) {
      return await serveLocalized(context, next, urlLocale, segments)
    }

    // 3. Invalid locale in URL -> treat the whole path as content missing the locale prefix.
    const target = buildLocalizedPath(fallbackLocale, segments)

    if (pathname !== target) {
      return negotiatedRedirect(target + url.search)
    }

    return await next()
  }
}

/** The project's middleware: its resolved config and its engine instance. */
export const i18nMiddleware: MiddlewareHandler = createI18nMiddleware({
  // The integration resolves an absent `routing` before serialising the config; the
  // fallback covers a config that reached the virtual module some other way.
  routing: I18N_CONFIG.routing ?? 'prefix-except-default',
  defaultLocale: DEFAULT_LOCALE,
  markdownLocale: I18N_CONFIG.markdownLocale,
  countryToLocale: I18N_CONFIG.countryToLocale,
  parseLocale: (value) => {
    const parsed = LocaleSchema.safeParse(value)
    return parsed.success ? parsed.data : null
  },
  resolveLocaleForTranslations,
  readCookieLang,
  setCookieLang,
})
