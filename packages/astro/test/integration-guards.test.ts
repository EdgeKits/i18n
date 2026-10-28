import assert from 'node:assert/strict'
import test from 'node:test'

import type { I18nRouting } from '@edgekits/i18n-core'

import { edgekitsI18n } from '../src/integration/index.ts'
import config from './fixtures/i18n.config.ts'

/**
 * The Astro settings the middleware cannot work under, refused at config time:
 * `trailingSlash: 'never'` (Astro removes the slash the middleware adds), a `base` other
 * than `/`, and in 'prefix-except-default' a prerendered `[lang]` route (the default
 * locale's pages render through a rewrite, and a rewrite into a prerendered route is
 * Astro's ForbiddenRewrite).
 */

function setup(astroConfig: Record<string, unknown>, routing: I18nRouting = 'prefix-except-default'): void {
  const integration = edgekitsI18n({ ...config, routing })
  const hook = integration.hooks['astro:config:setup'] as (params: unknown) => void
  hook({
    config: { root: new URL('./', import.meta.url), ...astroConfig },
    updateConfig: () => {},
    addMiddleware: () => {},
  })
}

type Route = { pattern: string; isPrerendered: boolean; origin?: string }

function resolveRoutes(routes: Route[], routing: I18nRouting = 'prefix-except-default'): void {
  const integration = edgekitsI18n({ ...config, routing })
  const hook = integration.hooks['astro:routes:resolved'] as (params: unknown) => void
  hook({ routes: routes.map((route) => ({ origin: 'project', ...route })), logger: console })
}

test("trailingSlash: 'never' is refused, saying why; 'ignore' and 'always' are accepted", () => {
  for (const routing of ['prefix', 'prefix-except-default'] as const) {
    assert.throws(
      () => setup({ trailingSlash: 'never', base: '/' }, routing),
      (err: Error) =>
        err.message.startsWith("[@edgekits/astro-i18n] `trailingSlash: 'never'` is not supported") &&
        err.message.includes("'ignore'"),
      routing,
    )
    for (const trailingSlash of ['ignore', 'always', undefined]) {
      assert.doesNotThrow(() => setup({ trailingSlash, base: '/' }, routing), `${routing} ${trailingSlash}`)
    }
  }
})

test("a base other than '/' is refused, saying why", () => {
  for (const base of ['/docs', '/docs/', 'docs']) {
    assert.throws(
      () => setup({ trailingSlash: 'ignore', base }),
      (err: Error) =>
        err.message.startsWith(`[@edgekits/astro-i18n] \`base: ${JSON.stringify(base)}\` is not supported`),
      base,
    )
  }
  for (const base of ['/', undefined]) assert.doesNotThrow(() => setup({ trailingSlash: 'ignore', base }))
})

test("'prefix-except-default': a prerendered [lang] route is refused, naming it", () => {
  assert.throws(
    () =>
      resolveRoutes([
        { pattern: '/[lang]', isPrerendered: false },
        { pattern: '/[lang]/blog/[...slug]', isPrerendered: true },
      ]),
    (err: Error) =>
      err.message.startsWith('[@edgekits/astro-i18n] /[lang]/blog/[...slug] is prerendered') &&
      err.message.includes('export const prerender'),
  )
})

test('a prerendered root route, or prerendered [lang] routes in prefix mode, are accepted', () => {
  assert.doesNotThrow(() =>
    resolveRoutes([
      { pattern: '/robots.txt', isPrerendered: true },
      { pattern: '/[lang]', isPrerendered: false },
      { pattern: '/language/[x]', isPrerendered: true },
    ]),
  )
  assert.doesNotThrow(() => resolveRoutes([{ pattern: '/[lang]/blog/[...slug]', isPrerendered: true }], 'prefix'))
})
