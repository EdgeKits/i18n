import type { AstroConfig, AstroIntegration } from 'astro'
import { DEFAULT_GENERATED_DIR, defineI18nConfig, type I18nConfig, type I18nRouting } from '@edgekits/i18n-core'

import { i18nVitePlugin } from './vite-plugin.ts'
import { virtualModulesDeclaration } from './virtual-types.ts'

export type EdgekitsI18nOptions = {
  // 'auto' registers the i18n middleware; 'manual' leaves it to the project, which
  // then imports `i18nMiddleware` and places it in its own sequence.
  middleware?: 'auto' | 'manual'
}

const MIDDLEWARE_MODES = ['auto', 'manual'] as const

export const PACKAGE_NAME = '@edgekits/astro-i18n'

/**
 * The Astro integration. Build time only: it runs in Node while Astro loads its
 * config, so it reaches the engine's runtime modules through nothing but the Vite
 * plugin's virtual modules.
 */
export function edgekitsI18n(config: I18nConfig, options: EdgekitsI18nOptions = {}): AstroIntegration {
  const i18nConfig = resolveConfig(config)
  const middleware = options.middleware ?? 'auto'

  if (!MIDDLEWARE_MODES.includes(middleware)) {
    throw new Error(
      `[@edgekits/astro-i18n] \`middleware\` "${String(middleware)}" is not supported; use 'auto' or 'manual'.`,
    )
  }

  return {
    name: '@edgekits/astro-i18n',
    hooks: {
      'astro:config:setup': ({ config: astroConfig, updateConfig, addMiddleware }) => {
        const generatedDir = new URL(
          `${trimSlashes(i18nConfig.generatedDir ?? DEFAULT_GENERATED_DIR)}/`,
          astroConfig.root,
        )

        assertAstroRouting(astroConfig)

        // Astro sets `Astro.currentLocale` (read by `resolveLocale`) only with an `i18n`
        // block: set it when the project has none, check it when it has one.
        if (astroConfig.i18n) assertAstroI18n(astroConfig.i18n, i18nConfig)

        updateConfig({
          vite: {
            plugins: [i18nVitePlugin(i18nConfig, generatedDir)],
            // The runtime ships as source and imports the virtual modules above: Vite
            // must process it rather than hand it to Node as an external dependency.
            ssr: { noExternal: [PACKAGE_NAME] },
          },
          ...(astroConfig.i18n ? {} : { i18n: astroI18n(i18nConfig) }),
        })

        if (middleware === 'auto') {
          addMiddleware({ entrypoint: '@edgekits/astro-i18n/middleware', order: 'pre' })
        }
      },
      'astro:routes:resolved': ({ routes }) => {
        assertNoPrerendered404(routes)
        if (i18nConfig.routing === 'prefix-except-default') assertNoPrerenderedLangRoute(routes)
      },
      'astro:config:done': ({ injectTypes }) => {
        injectTypes({ filename: 'locales.d.ts', content: localesDeclaration(Object.keys(i18nConfig.languages)) })
        // The shipped runtime imports the virtual modules; a consumer's program needs their
        // declarations too. A separate file: these must not sit in a module (see virtual-types.ts).
        injectTypes({ filename: 'virtual-modules.d.ts', content: virtualModulesDeclaration(PACKAGE_NAME) })
      },
    },
  }
}

/**
 * The validated config with `routing` resolved: absent means 'prefix-except-default', the
 * mode for new projects. Resolved here, before the Vite plugin serialises it, so the
 * virtual config (and `I18N_CONFIG`) always carries the mode the middleware runs.
 */
export function resolveConfig(config: I18nConfig): I18nConfig & { routing: I18nRouting } {
  const validated = defineI18nConfig(config)
  return { ...validated, routing: validated.routing ?? 'prefix-except-default' }
}

// Each entry that exports `I18nLocales`: both re-export the core's interface (root through
// dist/types.d.ts, runtime through the shipped src/types.ts), so either augmentation
// merges into it; both are kept so neither entry depends on how the other resolves.
const LOCALE_MODULES = ['@edgekits/astro-i18n', '@edgekits/astro-i18n/runtime']

/**
 * Augments `I18nLocales` with the configured locales, so `Locale` narrows from
 * `string` to their union in the project, through both entries. The `export {}` keeps
 * the file a module: without it `declare module` would replace the package's types
 * instead of merging.
 */
export function localesDeclaration(locales: readonly string[]): string {
  const members = locales.map((locale) => `    ${JSON.stringify(locale)}: true`)

  return [
    'export {}',
    ...LOCALE_MODULES.flatMap((specifier) => [
      '',
      `declare module '${specifier}' {`,
      '  interface I18nLocales {',
      ...members,
      '  }',
      '}',
    ]),
    '',
  ].join('\n')
}

/**
 * The Astro settings the middleware cannot work under, refused at config time:
 * - `trailingSlash: 'never'`: Astro removes a trailing slash before the middleware runs
 *   (astro/dist/core/routing/handler.js:105-107, Astro 7.4.2), and the middleware adds it
 *   back: every page would redirect forever. `'ignore'` (the default) and `'always'` work.
 * - a `base` other than `/`: the middleware's paths and redirects assume the site's root.
 */
export function assertAstroRouting(astroConfig: Pick<AstroConfig, 'trailingSlash' | 'base'>): void {
  if (astroConfig.trailingSlash === 'never') {
    throw new Error(
      "[@edgekits/astro-i18n] `trailingSlash: 'never'` is not supported: Astro removes the trailing slash " +
        'before the middleware runs, and the middleware adds it back to every page, so each request would ' +
        "redirect forever. Use 'ignore' (the default) or 'always'.",
    )
  }
  if (astroConfig.base !== undefined && astroConfig.base !== '/') {
    throw new Error(
      `[@edgekits/astro-i18n] \`base: ${JSON.stringify(astroConfig.base)}\` is not supported: the middleware's ` +
        'locale paths and redirects are built from the site root. Serve the site at the root of its host ' +
        '(remove `base`, or set it to "/").',
    )
  }
}

/**
 * In 'prefix-except-default' the default locale's pages render through a rewrite to
 * `/<default>/…`, and Astro refuses a rewrite from an on-demand request into a
 * prerendered route (ForbiddenRewrite, a 500: astro/dist/core/rewrites/handler.js:29-33,
 * Astro 7.4.2). Every `[lang]` route must be on-demand.
 */
export function assertNoPrerenderedLangRoute(routes: ReadonlyArray<{ pattern: string; isPrerendered: boolean }>): void {
  const prerendered = routes.find(
    (route) => route.isPrerendered && (route.pattern === '/[lang]' || route.pattern.startsWith('/[lang]/')),
  )
  if (prerendered) {
    throw new Error(
      `[@edgekits/astro-i18n] ${prerendered.pattern} is prerendered: with routing 'prefix-except-default' the ` +
        "default locale's pages render through a rewrite to /<default>/…, and Astro refuses a rewrite into a " +
        "prerendered route (ForbiddenRewrite). Remove `export const prerender = true` from that page, or use routing 'prefix'.",
    )
  }
}

/**
 * A prerendered 404 page, in either mode: Astro serves it as a static file without the
 * middleware (no locale in `locals`), and a page's `Astro.rewrite('/404')` into it from an
 * on-demand request is a ForbiddenRewrite, a 500 (astro/dist/core/rewrites/handler.js:29-33,
 * Astro 7.4.2). Only the project's own route counts: Astro's built-in 404 is on-demand.
 */
export function assertNoPrerendered404(
  routes: ReadonlyArray<{ pattern: string; isPrerendered: boolean; origin?: string; entrypoint?: string }>,
): void {
  const page = routes.find((route) => route.pattern === '/404' && route.isPrerendered && route.origin === 'project')
  if (page) {
    throw new Error(
      `[@edgekits/astro-i18n] ${page.entrypoint ?? 'src/pages/404.astro'} is prerendered: Astro serves a prerendered ` +
        "404 page without the middleware, so it never gets the visitor's locale, and a page's `Astro.rewrite('/404')` " +
        'into it is refused (ForbiddenRewrite, a 500). Remove `export const prerender = true` from the 404 page.',
    )
  }
}

/**
 * The Astro `i18n` block set when the project has none: locales and default from the
 * config; routed as locale-prefixed in both modes (the middleware redirects `/` itself in
 * 'prefix', so Astro does not). Complete, `fallbackType` included: Astro does not
 * re-validate what `updateConfig` merges, so its schema defaults never fill a partial block.
 *
 * `prefixDefaultLocale: true` in 'prefix-except-default' too: Astro's own i18n check runs
 * after the middleware, on the rewritten URL (astro/dist/core/routing/handler.js:167-169,
 * Astro 7.4.2), and with `prefixDefaultLocale: false` the strategy
 * `pathname-prefix-other-locales` answers notFound to any path carrying the default locale
 * (astro/dist/i18n/router.js:107-124) — the rewritten `/<default>/about/` is exactly that. With `true` the check
 * passes and `Astro.currentLocale` works on root pages.
 */
export function astroI18n(config: I18nConfig): NonNullable<AstroConfig['i18n']> {
  return {
    locales: Object.keys(config.languages),
    defaultLocale: config.defaultLocale,
    routing: { prefixDefaultLocale: true, redirectToDefaultLocale: false, fallbackType: 'redirect' },
  }
}

/**
 * A project's own Astro `i18n` block must cover every configured locale (as a string
 * entry, a `path` or one of its `codes`), share the default locale, and route as
 * `astroI18n` does (`prefixDefaultLocale: true`, `redirectToDefaultLocale: false`).
 */
export function assertAstroI18n(block: NonNullable<AstroConfig['i18n']>, config: I18nConfig): void {
  const declared = new Set(
    block.locales.flatMap((entry) => (typeof entry === 'string' ? [entry] : [entry.path, ...entry.codes])),
  )
  const missing = Object.keys(config.languages).filter((locale) => !declared.has(locale))

  if (missing.length > 0) {
    throw new Error(
      `[@edgekits/astro-i18n] Astro \`i18n.locales\` is missing ${missing.join(', ')} from \`languages\`. ` +
        'Add them, or remove the `i18n` block from astro.config and the integration sets it for you.',
    )
  }
  if (block.defaultLocale !== config.defaultLocale) {
    throw new Error(
      `[@edgekits/astro-i18n] Astro \`i18n.defaultLocale\` "${block.defaultLocale}" differs from \`defaultLocale\` "${config.defaultLocale}". ` +
        'Make them equal, or remove the `i18n` block from astro.config and the integration sets it for you.',
    )
  }
  // Absent values are Astro's schema defaults (both false): `redirectToDefaultLocale` left
  // out is fine, `prefixDefaultLocale` left out is not.
  const routing = typeof block.routing === 'object' ? block.routing : undefined
  if (routing?.prefixDefaultLocale !== true || routing.redirectToDefaultLocale === true) {
    throw new Error(
      '[@edgekits/astro-i18n] Astro `i18n.routing` must set `prefixDefaultLocale: true` and `redirectToDefaultLocale: false` ' +
        `(found ${JSON.stringify(block.routing)}): the middleware handles the default locale itself, and Astro's ` +
        'own check would otherwise answer 404 or redirect the pages it serves. Set them, or remove the `i18n` block from astro.config and the integration sets it for you.',
    )
  }
}

function trimSlashes(path: string): string {
  return path.replace(/^\/+|\/+$/g, '')
}
