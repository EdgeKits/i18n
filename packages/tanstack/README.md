# @edgekits/tanstack-i18n

Edge-native i18n for TanStack Start on Cloudflare Workers, over the EdgeKits engine
[`@edgekits/i18n-core`](https://github.com/EdgeKits/astro-i18n/tree/main/packages/core#readme):
translations in Workers KV, a per-namespace edge cache, typed keys. For an app whose Worker
entry is a Hono app that hands the request to TanStack Start, and whose URLs carry no locale.

- `@edgekits/tanstack-i18n` (server): `i18nMiddleware` for the Hono chain (sets `c.var.locale`),
  `createTranslationsLoader` and `isNamespaceList` for the app's translations server function.
- `@edgekits/tanstack-i18n/react` (client-safe): `I18nProvider`, `useI18n`, `useT` and the
  headless `LanguageSwitcher`.

The locale of a request comes from the request alone, in this order: the lang cookie, the
user's saved preference (a hook you supply), `Accept-Language` (a regional tag such as `de-DE`
matches `de`), the default locale. The middleware and the loader run the same cascade, so Hono
and TanStack agree. Nothing here sets a cookie or redirects; the switcher writes the cookie.

## Install

```sh
npm install @edgekits/tanstack-i18n @edgekits/i18n-core
```

Peers: `hono` 4 and `react` 19. Write `edgekits-i18n.config.ts` and `locales/<locale>/<namespace>.json`
as the [core README](https://github.com/EdgeKits/astro-i18n/tree/main/packages/core#readme)
describes, bind the `TRANSLATIONS` KV namespace in `wrangler.jsonc`, then generate and seed:

```sh
npx edgekits-i18n seed
```

## 1. The instance: `src/i18n/instance.ts`

```ts
import { env, waitUntil } from 'cloudflare:workers'
import { createI18n, parseBooleanFlag } from '@edgekits/i18n-core'

import config from '../../edgekits-i18n.config'
import * as fallbacks from './fallbacks.generated'
import * as runtimeConstants from './runtime-constants'

export const i18n = createI18n(
  config,
  { fallbacks, runtimeConstants },
  {
    get kv() {
      return env.TRANSLATIONS
    },
    get cache() {
      return caches.default ?? null
    },
    waitUntil,
    get cacheEnabled() {
      return parseBooleanFlag(env.I18N_CACHE, true)
    },
    get debug() {
      return parseBooleanFlag(env.DEBUG_I18N, false)
    },
  },
)

// Optional: the user's saved locale, consulted after the cookie. Sync or async; return a
// locale string or null. The value is checked against your locales, never trusted.
export const userPreference = async (request: Request): Promise<string | null> => null
```

## 2. The middleware: `src/worker.ts`

```ts
import { Hono } from 'hono'
import handler from '@tanstack/react-start/server-entry'
import { i18nMiddleware, type I18nVariables } from '@edgekits/tanstack-i18n'

import { i18n, userPreference } from './i18n/instance'

const app = new Hono<{ Variables: I18nVariables /* & your own */ }>()

app.use(i18nMiddleware(i18n, { userPreference })) // before middleware that reads c.var.locale
// …your session and tenant middleware…
app.all('*', (c) => handler.fetch(c.req.raw, { context: {} }))

export default app
```

Hand `c.req.raw` to TanStack unchanged: server functions live under `/_serverFn/`, and that
path is case-sensitive.

## 3. The server function: `src/i18n/server.ts`

```ts
import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { createTranslationsLoader, isNamespaceList } from '@edgekits/tanstack-i18n'

import { i18n, userPreference } from './instance'

const isNamespaces = isNamespaceList(i18n)
const load = createTranslationsLoader(i18n, { userPreference })

export const getTranslations = createServerFn({ method: 'GET' })
  .validator((data: unknown) => {
    if (!isNamespaces(data)) throw new Error('Unknown namespace')
    return data
  })
  .handler(({ data }) => load(getRequest(), data))
```

The namespace list comes from the browser: `isNamespaceList` is true only for an array of
namespaces the CLI generated, and the server function rejects anything else, so an unknown
name never reaches a KV key. The package ships no server function of its own: Start compiles
one from a dependency too, but it is declared in the app so that the app's own request
helpers and kernel are in scope. The handler, the instance and the compiled fallbacks stay out
of the client bundle.

## 4. The root route: `src/routes/__root.tsx`

```tsx
import { Outlet, createRootRoute, HeadContent, Scripts } from '@tanstack/react-router'
import { localesOf } from '@edgekits/i18n-core'
import { I18nProvider } from '@edgekits/tanstack-i18n/react'

import config from '../../edgekits-i18n.config'
import { getTranslations } from '../i18n/server'

const { LANGUAGES } = localesOf(config)

export const Route = createRootRoute({
  loader: () => getTranslations({ data: ['common'] }),
  component: Root,
})

function Root() {
  const { locale, translations } = Route.useLoaderData()
  return (
    <html lang={locale}>
      <head>
        <HeadContent />
      </head>
      <body>
        <I18nProvider locale={locale} translations={translations} languages={LANGUAGES} cookie={config.cookie}>
          <Outlet />
        </I18nProvider>
        <Scripts />
      </body>
    </html>
  )
}
```

The config and `localesOf` are pure, safe to import on the client. `languages` and `cookie` are
given once, here.

## 5. A page: `src/routes/index.tsx`

```tsx
import { createFileRoute } from '@tanstack/react-router'
import { I18nProvider, useT } from '@edgekits/tanstack-i18n/react'

import { getTranslations } from '../i18n/server'

export const Route = createFileRoute('/')({
  loader: () => getTranslations({ data: ['home'] }),
  component: Page,
})

function Page() {
  return (
    <I18nProvider translations={Route.useLoaderData().translations}>
      <Home />
    </I18nProvider>
  )
}

function Home() {
  const common = useT('common') // from the root route
  const home = useT('home') // from this one
  return (
    <main>
      <h1>{common.title}</h1>
      <p>{home.hero}</p>
    </main>
  )
}
```

Providers nest: an inner one merges its namespaces over the ones above and inherits the locale,
`languages` and `cookie`. `useT(namespace)` returns the namespace object, typed from your
default locale's JSON; a namespace no route loader above has loaded throws. `useI18n()` returns
`{ locale, languages, translations }`. Each route's dehydrated loader data carries only its own
namespaces, in one locale.

## The language switcher

```tsx
import { useRouter } from '@tanstack/react-router'
import { LanguageSwitcher } from '@edgekits/tanstack-i18n/react'

function Header() {
  const router = useRouter()
  return <LanguageSwitcher classes={{ root: 'ls', trigger: 'ls-trigger', dropdown: 'ls-menu', item: 'ls-item', itemActive: 'is-active' }} texts={{ trigger: 'Switch language' }} afterChange={() => router.invalidate()} />
}
```

Headless: a trigger button and one item per language (the label carries `lang`, the active item
`aria-current`), class names only from `classes` (slots `root`, `trigger`, `triggerIcon`,
`dropdown`, `item`, `itemActive`, `itemLabel`), `data-ls-*` and `data-open` hooks for styling, no
styles. Escape and a click outside close it. Choosing a language writes the lang cookie
(`path=/`, `max-age` from `cookie.maxAge`, `SameSite=Lax; Secure`), then calls `afterChange`,
or reloads the page without one; `router.invalidate()` re-runs the loaders in place. With one
language it renders nothing.

## A narrowed `Locale` (optional)

`Locale` is `string` until you list your locales, in any `.d.ts` your tsconfig includes:

```ts
export {}

declare module '@edgekits/i18n-core' {
  interface I18nLocales {
    en: true
    de: true
    es: true
  }
}
```

`c.var.locale` is typed from the instance either way.

## Monorepo

One translations folder for several Workers: the config, `locales/` and the generated files live
in a shared package, and each app imports them from there. The CLI takes the two paths:

```sh
npx edgekits-i18n seed --config packages/i18n/edgekits-i18n.config.ts --wrangler apps/app/wrangler.jsonc
npx edgekits-i18n migrate --config packages/i18n/edgekits-i18n.config.ts --wrangler apps/app/wrangler.jsonc
```

See the core README's
[monorepo section](https://github.com/EdgeKits/astro-i18n/tree/main/packages/core#monorepo-one-translations-folder-several-workers).

## License

MIT © Gary Stupak. See [LICENSE](LICENSE).
