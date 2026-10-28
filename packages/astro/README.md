# @edgekits/astro-i18n

Edge-native i18n for Astro on Cloudflare Workers. Translations live as data in Workers KV, one
JSON value per locale and namespace, so the server renders every page in its language and
nothing ships to the client; changing a string is a KV write, not a redeploy. Each namespace is
cached at the edge under its own URL, and `edgekits-i18n migrate` purges only the namespaces
whose content changed through the Cloudflare Purge API. The default locale's JSON files define a
typed schema: the CLI generates the `I18n.Schema` declaration, so `t.common.hero.title` is
checked by TypeScript and a missing key is a compile error.

The design is explained in the edgekits.dev series:
[Stop Shipping Translations to the Client, Part 1](https://edgekits.dev/en/blog/edge-native-i18n-astro-cloudflare-part-1/),
[Part 2](https://edgekits.dev/en/blog/edge-native-i18n-astro-cloudflare-part-2/) and
[Stop Redeploying to Update Translations (Part 3)](https://edgekits.dev/en/blog/granular-edge-cache-purge-astro-cloudflare-part-3/).

## Requirements

- Astro `^7.4` with `output: 'server'` and the `@astrojs/cloudflare` adapter `^14.4`.
- wrangler `^4.152`, installed in the project (a peer dependency: the CLI runs the project's own
  wrangler for its KV writes).
- A `wrangler.jsonc` (the CLI reads that file; `wrangler.toml` and `wrangler.json` are not read).
- Node `>=22`.
- A Workers KV namespace bound as `TRANSLATIONS`.
- For `migrate` only: the site on a proxied Cloudflare zone, its zone ID, and an API token with
  the Zone › Cache Purge permission. Zone › Zone › Read is optional; with it, `migrate` checks
  `keyPrefix` against the zone's name.

## Quick start

### 1. Install

```sh
npm i @edgekits/astro-i18n
```

### 2. Bind a KV namespace

```sh
npx wrangler kv namespace create TRANSLATIONS
```

Add the namespace to `wrangler.jsonc` under the binding name `TRANSLATIONS`:

```jsonc
{
  "compatibility_date": "2026-09-01",
  "kv_namespaces": [{ "binding": "TRANSLATIONS", "id": "<the id wrangler printed>" }],
}
```

### 3. Write `edgekits-i18n.config.ts`

At the project root. Both the integration and the CLI read it.

```ts
// edgekits-i18n.config.ts
import { defineI18nConfig } from '@edgekits/astro-i18n/config'

export default defineI18nConfig({
  // The keys are the locales; the only list of languages there is.
  languages: {
    en: { countryCode: 'us', name: 'English' },
    de: { countryCode: 'de', name: 'Deutsch' },
  },
  defaultLocale: 'en',
  // The language cookie: set by the LanguageSwitcher, kept in sync by the middleware.
  cookie: { name: 'lang', maxAge: 60 * 60 * 24 * 365 },
  // Prefix of every KV key and the host of every edge-cache URL: use your site's domain.
  keyPrefix: 'example.com',
  // Whether MissingTranslationBanner may render.
  missingTranslationBanner: true,
  // Every URL starts with its locale (/en/, /de/about/). Leave it out for the default,
  // 'prefix-except-default': the default locale at the root (see Routing modes).
  routing: 'prefix',
})
```

| Field                      | Required | Default                   | Meaning                                                                                                                                                                                                                                                      |
| -------------------------- | -------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `languages`                | yes      |                           | `{ [locale]: { name, countryCode? } }`; `countryCode` is optional: the code your flag component receives                                                                                                                                                     |
| `defaultLocale`            | yes      |                           | one of `languages`; its JSON files define the schema                                                                                                                                                                                                         |
| `cookie`                   | yes      |                           | `{ name, maxAge }` (seconds) of the language cookie                                                                                                                                                                                                          |
| `keyPrefix`                | yes      |                           | a hostname of your zone, or a unique name without a dot, written as a URL host (lowercase, no scheme or path): KV keys are `<keyPrefix>:<namespace>:<locale>` and every cache URL is `https://<keyPrefix>/…` (see [Deployment targets](#deployment-targets)) |
| `missingTranslationBanner` | yes      |                           | enables `MissingTranslationBanner`                                                                                                                                                                                                                           |
| `routing`                  | no       | `'prefix-except-default'` | `'prefix-except-default'`: the default locale at the root (`/about/`), the others prefixed (`/de/about/`); `'prefix'`: every URL starts with its locale (`/en/about/`). See [Routing modes](#routing-modes)                                                  |
| `localesDir`               | no       | `'locales'`               | where the CLI reads `<locale>/<namespace>.json`                                                                                                                                                                                                              |
| `generatedDir`             | no       | `'src/i18n'`              | where the CLI writes `runtime-constants.ts` and `fallbacks.generated.ts`                                                                                                                                                                                     |
| `countryToLocale`          | no       | none                      | geo-IP step of the locale fallback (see Reference)                                                                                                                                                                                                           |
| `markdownLocale`           | no       | none                      | the locale `.md` endpoints are served in (see Reference)                                                                                                                                                                                                     |

Locale codes (the keys of `languages`) are lowercase everywhere: the config, the `locales/`
folders and the URLs (`pt-br`, not `pt-BR`). `toIetfTag()` from `./format` gives the IETF form
(`pt-BR`) where one is needed, such as `<html lang>` and hreflang.

The config is validated when it loads: an empty `languages`, a `defaultLocale` or
`markdownLocale` outside it, or a bad `countryToLocale` entry throws with a message naming the
field.

### 4. Add the integration

```js
// astro.config.mjs
import { defineConfig } from 'astro/config'
import cloudflare from '@astrojs/cloudflare'
import { edgekitsI18n } from '@edgekits/astro-i18n'

import i18nConfig from './edgekits-i18n.config'

export default defineConfig({
  output: 'server',
  adapter: cloudflare(),
  integrations: [edgekitsI18n(i18nConfig)],
})
```

The integration sets up:

- a Vite plugin serving the config and your generated files to the runtime as virtual modules;
- `vite.ssr.noExternal` for the package, whose runtime ships as source;
- Astro's `i18n` block, when `astro.config` has none: `locales` from `languages`, your
  `defaultLocale`, `routing: { prefixDefaultLocale: true, redirectToDefaultLocale: false }` in
  both modes. Astro needs it to set `Astro.currentLocale`, which `resolveLocale` reads. If you
  keep your own block, its `locales` must include every configured locale, its `defaultLocale`
  must match, and its `routing` must be that one, or the build stops with a message saying which;
- the `Locale` type: the union of your locales, for the package's exports;
- type declarations for its virtual modules, so `tsc` and `astro check` accept the package's
  runtime source in your program;
- the locale-routing middleware, with `edgekitsI18n(i18nConfig)` or
  `edgekitsI18n(i18nConfig, { middleware: 'auto' })`. With `{ middleware: 'manual' }` nothing is
  registered and you place it in your own `sequence()`:

  ```ts
  // src/middleware.ts
  import { sequence } from 'astro:middleware'
  import { onRequest as i18n } from '@edgekits/astro-i18n/middleware'

  export const onRequest = sequence(i18n, yourOwnMiddleware)
  ```

In `'prefix'` the middleware redirects a URL without a locale (`/`, `/about/`) to a localized
one; in `'prefix-except-default'` such a URL is a default-locale page (see
[Routing modes](#routing-modes)). Either way it sets `Astro.locals.uiLocale` (the URL's locale)
and `Astro.locals.translationLocale` (the locale to fetch translations for) on every request.

### 5. Write translations

One JSON file per locale and namespace, under `localesDir`:

```
locales/
  en/
    common.json
  de/
    common.json
```

```json
// locales/en/common.json
{ "hero": { "title": "Hello, world" } }
```

```json
// locales/de/common.json
{ "hero": { "title": "Hallo, Welt" } }
```

The default locale's files define the schema: their namespaces and keys are the types. Another
locale may leave keys out; the default locale's text fills the gaps.

Values are typed as written: strings, numbers and booleans. Lists are allowed and typed:
`["a", "b"]` is `string[]`, a list of objects is `Array<…>`, the union of its element shapes,
and a locale that has the list replaces it whole. `null` is rejected: leave the key out to fall
back to the default locale's text.

### 6. Generate and seed

```sh
npx edgekits-i18n seed
```

The `edgekits-i18n` command comes from `@edgekits/i18n-core`, which this package depends on, so
it is in your project's `node_modules/.bin` with no extra install.

| Command                            | Writes                                                                                                              | Then                                                                                                                                            |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `edgekits-i18n bundle`             | `i18n-data.json` (the KV payload), `src/i18n.generated.d.ts` (the schema), `<generatedDir>/runtime-constants.ts`    | nothing else                                                                                                                                    |
| `edgekits-i18n bundle --fallbacks` | the above and `<generatedDir>/fallbacks.generated.ts` (the default locale compiled in, served if KV is unreachable) | nothing else                                                                                                                                    |
| `edgekits-i18n seed`               | the same as `bundle --fallbacks`                                                                                    | pushes every value to local KV (`wrangler kv bulk put --local`; the binding's `preview_id` when set)                                            |
| `edgekits-i18n migrate`            | the same as `bundle --fallbacks`                                                                                    | pushes to production KV, deletes the keys of removed files, purges the changed namespaces' edge-cache entries twice, writes `.i18n-hashes.json` |

The generated files are ordinary project files: commit them, and run the CLI again after you
edit a JSON file.

`.i18n-hashes.json` holds, per KV namespace id, one content hash per namespace and locale as
of the last successful `migrate`; the next `migrate` purges exactly the entries whose hash
changed, and deletes the KV keys of files removed since. Rules:

- Only `migrate` writes it, and only after both purges succeeded (or nothing changed). `seed`
  never touches it: local KV is not production.
- Commit it after every `migrate`. It is the record of what production holds.
- `migrate` refuses to run while the file has uncommitted changes, since a wrong baseline would
  skip purges silently. When that git check cannot run (no `git` on the PATH, or not a git work
  tree), `migrate` warns and proceeds without the purge-baseline check.

`migrate` reads the zone ID from `CLOUDFLARE_ZONE_ID` (a var in `wrangler.jsonc` or the
environment) and the token from `CLOUDFLARE_CACHEPURGE_API_TOKEN` (the environment or
`.dev.vars`). It purges, waits 65 s for KV to settle (`--purge-delay`), and purges again.
Without the zone ID or token, or when a purge fails, it still pushes to KV but exits 1 and
leaves `.i18n-hashes.json` alone, so the next run retries. `--env <name>` reads the binding and
the zone ID from `env.<name>`. All flags:
[the core's CLI reference](https://github.com/EdgeKits/i18n/tree/main/packages/core#cli).

### 7. Use translations in a page

```astro
---
// src/pages/[lang]/index.astro
import { fetchTranslations } from '@edgekits/astro-i18n/runtime'

const { common } = await fetchTranslations(Astro.locals.translationLocale, ['common'])
---

<h1>{common.hero.title}</h1>
```

`fetchTranslations(locale, namespaces)` returns one object per namespace, typed from the
schema: `common.hero.title` is a `string`, a key that does not exist is a type error. Run
`npx astro dev` and open `/de/`: the heading reads "Hallo, Welt", served from local KV. Before
you edit and re-seed, see `I18N_CACHE` below.

`npx astro check` passes on this setup as is. `tsc` also checks the package's runtime source
when a `.ts` file of yours imports it, and that source reads `cloudflare:workers` and a
`KVNamespace` binding: generate the Workers types once with `npx wrangler types` (it needs the
`compatibility_date` above) and `tsc` passes too.

`@edgekits/astro-i18n/runtime` also exports `fmt` (`{placeholder}` interpolation), `plural` and
`pluralIcu`, the locale constants (`DEFAULT_LOCALE`, `SUPPORTED_LOCALES`, `LANGUAGES`) and the
`Locale` type.

### 8. Runtime switches

Both are optional `vars` in `wrangler.jsonc` (or `.dev.vars` locally), read as `on`/`off`
(`true`/`false` and `1`/`0` work too):

| Var          | Default | Effect                                                          |
| ------------ | ------- | --------------------------------------------------------------- |
| `I18N_CACHE` | `on`    | `off` reads KV on every request and skips the edge cache        |
| `DEBUG_I18N` | `off`   | `on` logs cache hits, misses and KV reads to the Worker console |

While you edit translations locally, put `I18N_CACHE=off` in `.dev.vars`. `astro dev` runs your
Worker with a local Cache API, which keeps the first value it served for each namespace: after
a second `seed` the page still shows the old text. With the cache off, a `seed` shows on the
next request. `.dev.vars` is read when the dev server starts: restart it after you
add the line.

## Reference

### Which entry to import

| Entry                               | Where it runs              | What it holds                                                                                                  |
| ----------------------------------- | -------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `@edgekits/astro-i18n`              | `astro.config` (Node)      | `edgekitsI18n()` (the integration) and `defineI18nConfig`                                                      |
| `@edgekits/astro-i18n/config`       | anywhere, Node-safe        | `defineI18nConfig`, `localesOf(config)` (`DEFAULT_LOCALE`, `SUPPORTED_LOCALES`, `LANGUAGES`), the types        |
| `@edgekits/astro-i18n/format`       | anywhere, Node-safe        | `fmt`, `plural`, `pluralIcu`, `toIetfTag`, `replaceLocaleInPath`, `getLangFromUrl`                             |
| `@edgekits/astro-i18n/runtime`      | workerd only (pages, APIs) | `fetchTranslations`, the locale constants from the integration's config, locale resolution, the format helpers |
| `@edgekits/astro-i18n/middleware`   | workerd only               | the i18n middleware (`onRequest`); registered for you unless `middleware: 'manual'`                            |
| `@edgekits/astro-i18n/components/*` | `.astro` pages             | `LanguageSwitcher`, `MissingTranslationBanner`                                                                 |

Node-safe entries import nothing from `cloudflare:workers` and no virtual module, so unit tests
under Node and `src/content.config.ts` (evaluated by `astro sync`) can use them. `./runtime` and
`./middleware` need the integration's Vite setup and the Workers runtime.

### Geo-IP locale fallback: `countryToLocale`

When a request's URL has no locale, the middleware picks one in this order: the language
cookie, then the `Accept-Language` header (each tag in `q` order, the full tag, then its
language part, so `es-MX` reaches `es`; the first tag that names one of your `languages` wins),
then, only when no tag matched, the visitor's country (`request.cf.country`) through your
`countryToLocale` table, and finally `defaultLocale`. The middleware reads the header itself;
Astro's `preferredLocale` is not used.

```ts
// edgekits-i18n.config.ts
export default defineI18nConfig({
  languages: { en: { … }, de: { … }, es: { … }, ja: { … } },
  defaultLocale: 'en',
  // ISO 3166-1 alpha-2 (uppercase) → one of `languages`; checked at config time.
  countryToLocale: { US: 'en', GB: 'en', DE: 'de', AT: 'de', CH: 'de', ES: 'es', MX: 'es', JP: 'ja' },
  // …
})
```

Without `countryToLocale` the geo step is skipped: the package ships no country table of its
own, so a visitor with no cookie and no preferred locale gets `defaultLocale`.

### Markdown endpoints: `markdownLocale`

The middleware leaves paths ending in `.md` (or `.md/`) out of locale routing. With
`markdownLocale` set, it also gives them one canonical form: `/<markdownLocale>/<rest>` with no
trailing slash, reached in a single redirect. A leading locale segment is replaced; any other
leading segment is kept.

```ts
// edgekits-i18n.config.ts
export default defineI18nConfig({
  // …
  markdownLocale: 'en', // one of `languages`; checked at config time
})
```

| Request          | With `markdownLocale: 'en'` | Without `markdownLocale` |
| ---------------- | --------------------------- | ------------------------ |
| `/de/blog/x.md/` | redirect to `/en/blog/x.md` | passed through as is     |
| `/blog/x.md`     | redirect to `/en/blog/x.md` | passed through as is     |
| `/en/blog/x.md`  | served                      | passed through as is     |

Use it when your markdown endpoints exist in one locale only. Without it, the package assumes
nothing about them.

In `'prefix-except-default'` the default locale has no prefix here either: with
`markdownLocale: 'en'` (the default locale) the canonical form is `/blog/x.md`, and
`/en/blog/x.md` redirects to it. A `.md` path without a locale segment is served from
`src/pages/[lang]/` as the default locale's, like any root page.

### Routing modes

`routing` decides where the default locale lives. Pages stay in `src/pages/[lang]/…` in both.

- `'prefix-except-default'` (the default when `routing` is left out): the default locale at the
  root (`/`, `/about/`), every other locale under its prefix (`/de/about/`). The middleware
  serves a root URL by rewriting it internally to `/<defaultLocale>/…`, so the URL stays;
  `/en/about/` redirects permanently to `/about/`. An endpoint under `src/pages/[lang]/`
  answers at the root too (`/rss.xml`, and `/en/rss.xml` redirects to it), while a root route
  of its own (`sitemap.xml`, `robots.txt`) is served as is. A root URL consults neither
  Accept-Language nor the country: only a lang cookie for another locale (the visitor chose it
  in the switcher) redirects, temporarily, to that locale.
- `'prefix'`: every URL starts with its locale (`/en/about/`); `/` and a URL without a locale
  redirect to the visitor's locale (cookie, Accept-Language, country, default). Projects that
  set `routing: 'prefix'` keep exactly this by leaving their config alone.

In both modes, rewrites and redirects keep the query string (`/?utm=x` redirects to
`/en/?utm=x` in `'prefix'`, and renders `/` with `?utm=x` in `'prefix-except-default'`).

In `'prefix-except-default'`, build canonical and hreflang URLs from `Astro.originPathname`
(the URL the visitor requested; `Astro.url` is the rewritten `/<defaultLocale>/…`) through
`localizedPath` from `/runtime`. Astro's own `astro:i18n` URL helpers prefix the default locale
here, so `localizedPath` is the one to use:

```astro
---
import { DEFAULT_LOCALE, I18N_CONFIG, SUPPORTED_LOCALES, localizedPath, toIetfTag } from '@edgekits/astro-i18n/runtime'

const options = {
  routing: I18N_CONFIG.routing,
  defaultLocale: DEFAULT_LOCALE,
  isLocale: (segment: string) => (SUPPORTED_LOCALES as readonly string[]).includes(segment),
}
const path = Astro.originPathname
---

<link rel="canonical" href={new URL(localizedPath(Astro.locals.uiLocale, path, options), Astro.site)} />
{SUPPORTED_LOCALES.map((locale) => <link rel="alternate" hreflang={toIetfTag(locale)} href={new URL(localizedPath(locale, path, options), Astro.site)} />)}
<link rel="alternate" hreflang="x-default" href={new URL(localizedPath(DEFAULT_LOCALE, path, options), Astro.site)} />
```

Two limits:

- A root path whose first segment equals a locale code is read as that locale: a default-locale
  page at `/de/` (a content slug `de`) cannot exist next to the German site.
- A shared HTML cache in front of the site must key root paths on the lang cookie, or skip
  caching requests that carry one: the same URL renders for a cookie-less visitor and
  redirects one whose cookie names another locale. Every default-locale page response carries
  `Vary: Cookie`, but Cloudflare's cache ignores `Vary: Cookie`: a Cache Rule must bypass
  requests with the lang cookie, or include it in the cache key. Under `'prefix'`, `/en/` is in
  the same situation: it answers a visitor whose cookie names another locale with a `Set-Cookie`.

#### What the middleware leaves alone, and the rules it keeps (both modes)

- **Files and system paths pass through.** A path whose last segment ends in an extension that
  starts with a letter is a file (`/rss.xml`, `/doc.pdf`, `/site.webmanifest`; `/blog/v2.0` is
  a page), and so is everything under `/api`, `/assets`, `/_astro`, `/_image`, `/_actions`,
  `/_server-islands`, `/.well-known` and `/favicon.ico`, each matched on a segment boundary
  (`/apis/` is a page). When Astro answers such a request with its 404 page, the middleware
  sends a plain-text 404 instead; any other response passes unchanged.
- **Server islands** (`server:defer`) are fetched from `/_server-islands/…`, a URL without a
  locale: in the island, `Astro.locals.uiLocale` is the default locale. Pass the page's locale
  to the island as a prop.
- **Error pages stay at the root**: `src/pages/404.astro` (and `500.astro`), not under
  `[lang]`. `/404` and `/500` pass through untouched, and the page reads the locale from
  `Astro.locals` (the visitor's, when Astro renders it for a missing page under `/de/`). In a
  page, answer a missing entry with `return Astro.rewrite('/404')`.
- **Redirects keep the method.** For a request other than GET or HEAD (a form POST), a
  permanent normalisation is a 308 and a negotiated redirect a 307, so the body is resent.
- **The locale segment is lower case.** `/DE/about/` and `/pt-BR/` redirect permanently, in one
  hop, to the canonical lower-case URL (`/de/about/`, `/pt-br/`; the default locale without its
  prefix in `'prefix-except-default'`).
- **A response that sets the lang cookie is `Cache-Control: private`** (the URL wins over a
  stale cookie, and the corrected cookie is this visitor's); an existing `no-store` stays.

The integration refuses three Astro settings at build time, each with the reason:
`trailingSlash: 'never'` (Astro strips the slash the middleware adds: every page would
redirect forever; `'ignore'` and `'always'` work), a `base` other than `/` (the middleware's
paths assume the site root), and in `'prefix-except-default'` a prerendered `[lang]` route
(`export const prerender = true`): root URLs render through a rewrite, and Astro refuses a
rewrite into a prerendered route.

### Styling the components

`LanguageSwitcher` and `MissingTranslationBanner` are headless: they carry structure, behaviour
and `data-*` hooks, and every class comes from you. The package ships no CSS and needs no
Tailwind. Pass classes per element through the `classes` prop; a slot you leave out renders no
`class` attribute at all.

`LanguageSwitcher` slots:

| Slot          | Element                                                                  |
| ------------- | ------------------------------------------------------------------------ |
| `root`        | the wrapper `div` inside `<language-switcher>`                           |
| `trigger`     | the toggle `button`                                                      |
| `triggerIcon` | the trigger icon (your `triggerIcon` component or the inline default)    |
| `dropdown`    | the menu `div`                                                           |
| `item`        | each language `button`                                                   |
| `itemActive`  | appended to `item` on the current language                               |
| `itemLabel`   | the `span` holding the flag and the language name                        |
| `activeIcon`  | the current-language marker (your `activeIcon` component or the default) |

`LanguageSwitcher` has one string of its own, the trigger's `aria-label`, `Switch language` by
default. Translate it through `texts={{ trigger: … }}`, from a namespace you fetch yourself (the
package fetches nothing for its components). Each language name renders with `lang` set to its
locale, so a screen reader says `Deutsch` or `日本語` in that language.

`MissingTranslationBanner` has one slot, `root` (the banner `div`).

Hooks rendered whether or not you pass `classes`, for CSS or your own scripts:

| Hook                                                           | Where                              | Meaning                          |
| -------------------------------------------------------------- | ---------------------------------- | -------------------------------- |
| `data-open="true\|false"`                                      | `<language-switcher>`              | the menu is open                 |
| `data-current-lang`, `data-cookie-name`, `data-cookie-max-age` | `<language-switcher>`              | config the client script reads   |
| `data-ls-trigger`                                              | the toggle button                  | also carries `aria-expanded`     |
| `data-ls-dropdown`                                             | the menu                           | `hidden` attribute while closed  |
| `data-ls-item`, `data-lang`                                    | each language button               | `data-lang` is the item's locale |
| `data-active="true"`                                           | the current language's button only | that button is also `disabled`   |
| `data-missing="content\|ui"`                                   | the banner                         | which of your `texts` is showing |

The menu opens and closes through the `hidden` HTML attribute, `data-open` on the element and
`aria-expanded` on the trigger; the script adds or removes no class. The browser's default
`[hidden] { display: none }` hides the menu. A display class on the `dropdown` slot (`flex`,
`grid`, `block`) can override that default, so either leave display alone there or restate it,
as the CSS example below does.

With Tailwind:

```astro
<LanguageSwitcher
  classes={{
    root: 'relative',
    trigger: 'rounded-full p-2 hover:bg-muted',
    triggerIcon: 'size-5',
    dropdown: 'absolute right-8 z-50 -mt-8 w-44 overflow-hidden rounded-lg border bg-card shadow-lg',
    item: 'flex w-44 items-center justify-between px-4 py-2 text-sm hover:bg-muted',
    itemActive: 'bg-background cursor-default',
    itemLabel: 'flex items-center gap-3',
    activeIcon: 'size-6',
  }}
/>
<MissingTranslationBanner texts={bannerTexts} classes={{ root: 'mx-6 mt-6 border px-4 py-2 text-center' }} />
```

With plain CSS on the hooks, no `classes` needed:

```css
language-switcher > div {
  position: relative;
}
[data-ls-dropdown] {
  position: absolute;
  right: 0;
  display: flex;
  flex-direction: column;
}
[data-ls-dropdown][hidden] {
  display: none; /* the UA default, restated because the rule above sets display */
}
[data-ls-item][data-active] {
  font-weight: 600;
}
[data-missing='content'] {
  border-left: 3px solid orange;
}
```

#### Flags

The package ships no flag images. To show flags in the switcher, pass your own Astro component
as `flag`: each item renders it as `<Flag code={countryCode} size={16} />` before the language
name. A locale without a `countryCode` gets the name alone, and so does every locale when you
pass no `flag`. A recipe that copies only the SVGs your locales use from the `flag-icons` npm
package is under [Flags in the switcher](#flags-in-the-switcher) in "Using the skill".

### Deployment targets

**Workers Free or Paid, on your own zone.** Everything on this page applies as written.

**Cloudflare for SaaS.** The Worker is the SaaS zone's fallback origin on a `*/*` route. It is
a regular Worker: `request.cf`, `caches.default` and `env` behave as usual, and the host-only
language cookie and the relative redirects keep visitors on their custom hostname. Two
constraints:

- `keyPrefix` is the host of every cache URL that `migrate` purges from the zone
  `CLOUDFLARE_ZONE_ID` names. Recommended: a hostname of that zone (the zone name or a
  subdomain). A unique name without a dot works too: single-file purge from your zone reaches
  any URL whose hostname is no proxied Cloudflare zone. Never another domain that is a proxied
  Cloudflare zone: its URLs can be purged only from that zone, by its owner, and the Purge API
  reports success anyway. When the token can read the zone (Zone › Zone › Read), `migrate`
  warns about a dotted `keyPrefix` outside the zone.
- One tenant per build. `keyPrefix`, the locales, `defaultLocale` and `countryToLocale` are
  build-time constants, so one Worker serving many custom hostnames serves the same translation
  set to all of them.

**Workers for Platforms, trusted namespace.** `request.cf` and `caches.default` are available.
The Cache API is shared across the namespace and the cache URL is `https://<keyPrefix>/…`, so
`keyPrefix` must be unique per tenant, or two tenants read each other's translations from the
cache.

**Workers for Platforms, untrusted namespace.** `request.cf` is absent, so the country step of
the locale cascade never runs. `caches.default` is disabled, so every render reads its
namespaces from KV in one bulk read: the output is correct, only the cache layer and its KV
savings are gone. Set `I18N_CACHE=off` so the behaviour is explicit, and expect one bulk KV read
per render.

<!-- skill-guide:start -->

## Using the skill

`astro-i18n` is a free agent skill that sets up `@edgekits/astro-i18n` in your project and keeps
working with it afterwards. It runs in Claude Code as a plugin, and in Cursor, OpenCode or any other
coding agent that reads `SKILL.md`. Its source is in
[`plugins/edgekits-i18n`](https://github.com/EdgeKits/i18n/tree/main/plugins/edgekits-i18n).

### What it does

The skill adopts `@edgekits/astro-i18n` in an existing Astro project that runs on Cloudflare
Workers through `@astrojs/cloudflare`. It asks the questions only you can answer, follows the
package README in order, and checks the result against a checklist. After the setup it handles
the follow-up work: new keys, locales and namespaces, production copy, localized forms and
multilingual SEO.

It does not create an Astro project, and it stops if the project has no Cloudflare adapter: the
package depends on Workers KV. It copies no engine code into your project; everything it writes
uses the package's exports.

What changes in your project during the setup:

- dependencies: `@edgekits/astro-i18n`, and `flag-icons` as a dev dependency if you want flags;
- `astro.config`: the `edgekitsI18n()` integration;
- `wrangler.jsonc`: a `TRANSLATIONS` KV binding;
- new files: `edgekits-i18n.config.ts`, `locales/<locale>/*.json`, the generated files, and a
  `Flag.astro` with its SVGs;
- `src/pages/`: your pages move under `src/pages/[lang]/`;
- your base layout: `<html lang>` from the request's locale, hreflang tags, the language
  switcher.

### Installing it

In Claude Code, add the EdgeKits marketplace once, then install the plugin:

```
/plugin marketplace add EdgeKits/skills
/plugin install edgekits-i18n@edgekits
```

That installs it for you, in every project. To set it up for everyone working on one
repository, run these in the repository and commit `.claude/settings.json`:

```sh
claude plugin marketplace add EdgeKits/skills --scope project
claude plugin install edgekits-i18n@edgekits --scope project
```

The first command declares the EdgeKits marketplace in `.claude/settings.json`; the second
turns the plugin on there, under `enabledPlugins` (`"edgekits-i18n@edgekits": true`). Claude Code
honours those entries for a teammate once they trust the folder, but it does not download the
plugin for them: each teammate runs the same `claude plugin install … --scope project` once.

A marketplace added from the `/plugin` panel, or with `/plugin marketplace add`, is stored in
your user settings, even when you then install the plugin at project scope, so the committed
`.claude/settings.json` holds only `enabledPlugins`. On a fresh clone a teammate therefore first
adds the marketplace: `/plugin marketplace add EdgeKits/skills`, or the CLI line with
`--scope project` above. Declaring it in `.claude/settings.json` under `extraKnownMarketplaces`,
keyed by the marketplace's name as in the block below, spares them that step once they trust the
folder. In both cases the plugin itself is still installed once per contributor with
`claude plugin install edgekits-i18n@edgekits --scope project`, as the paragraph above says.

```json
{
  "extraKnownMarketplaces": {
    "edgekits": {
      "source": { "source": "github", "repo": "EdgeKits/skills" }
    }
  },
  "enabledPlugins": {
    "edgekits-i18n@edgekits": true
  }
}
```

Any other agent, with the [skills CLI](https://skills.sh):

```sh
npx skills add EdgeKits/i18n --skill astro-i18n
```

### Prerequisites

- An Astro `^7.4` project with `output: 'server'` and the `@astrojs/cloudflare` adapter `^14.4`.
  For a new site: `npm create astro@latest`, then `npx astro add cloudflare`, then set
  `output: 'server'` in `astro.config`.
- wrangler `^4.152` installed in the project (`npm i -D wrangler`) and a `wrangler.jsonc`. The
  package's CLI runs the project's own wrangler, never a global one.
- A git repository (`git init`): the generated files and the purge baseline
  (`.i18n-hashes.json`) are committed, and `migrate` checks the baseline against git (outside
  a repository it skips that check, with a warning).
- A Cloudflare account. Local development needs none until you create the real KV namespace.
- For `edgekits-i18n migrate` (pushing copy to production): the site on a proxied Cloudflare
  zone (orange cloud), that zone's ID, and an API token with the Zone › Cache Purge permission.
  Zone › Zone › Read on the same token is optional: with it, `migrate` checks `keyPrefix`
  against the zone's name.

### First run on a fresh site

#### What to say

Open the project in your agent and ask for the result you want, for example:

- "Add i18n to this site: English as the default, German and Brazilian Portuguese."
- "Make the site multilingual with en and es, and send visitors from Spain and Mexico to
  Spanish."
- "Install @edgekits/astro-i18n and set it up."

#### The questions it asks

The skill asks before it writes any code, and waits for the answers:

| Question                                                                     | Example answer                                |
| ---------------------------------------------------------------------------- | --------------------------------------------- |
| Which locales, and which is the default?                                     | `en` (default), `de`, `pt-br`                 |
| Does the site serve markdown endpoints (`/blog/x.md`)? In which locale?      | No (or: yes, `en`)                            |
| Should a visitor's country pick the locale when nothing else does? How?      | `DE`, `AT`, `CH` → `de`; `BR` → `pt-br`       |
| Middleware: registered by the integration (`auto`), or in your own sequence? | `auto`                                        |
| Flags in the language switcher?                                              | Yes: `en` → `us`, `de` → `de`, `pt-br` → `br` |
| Routing: the default locale at the root, or every locale prefixed?           | At the root                                   |

For flags, a regional locale takes its region (`pt-br` → `br`, `en-gb` → `gb`), and for a
language-only locale the skill proposes the obvious country (`en` → `us`) for you to confirm. It
shows the full list back before it writes the config. If you have no preference on any of
these, it uses the defaults: no geo table, no markdown locale, `auto` middleware, flags on.

For routing, the default locale at the root (`/`, `/about/`; other locales prefixed) is
`routing: 'prefix-except-default'`, the default; every locale prefixed (`/en/about/`) is
`routing: 'prefix'`. The skill asks only with two or more locales; with one, the root mode is
the only sensible one and needs no question.

#### What it creates

- `edgekits-i18n.config.ts` with your answers, and the integration in `astro.config`.
- `locales/<default>/common.json` and `messages.json` (the banner texts and form error codes),
  and the same files for each other locale.
- The generated files, written by `npx edgekits-i18n seed`: `i18n-data.json`,
  `src/i18n.generated.d.ts`, `src/i18n/runtime-constants.ts`, `src/i18n/fallbacks.generated.ts`.
  Commit them.
- The route layout: `src/pages/about.astro` becomes `src/pages/[lang]/about.astro`, and so on.
  The root `index.astro` moves too: in `'prefix'` the middleware redirects `/` to
  `/<locale>/`, and in `'prefix-except-default'` it serves the default locale's page there.
  Endpoints that are not localized (`robots.txt`, `sitemap.xml`, `/api/*`) and `public/` stay
  where they are.
- `src/components/Flag.astro` and one SVG per flag in `public/flags/`, if you chose flags (the
  recipe is below).
- The language switcher and the hreflang tags work in both routing modes: the hreflang
  component builds its URLs with `localizedPath`, which knows the mode.
- A KV namespace on your Cloudflare account (`wrangler kv namespace create`). The skill asks
  before it runs that command. Until then, local development works with a placeholder id of 32
  hexadecimal characters, such as `00000000000000000000000000000000`: the CLI checks the id's
  shape before it runs wrangler.

#### Flags in the switcher

The package ships no flag images; `LanguageSwitcher` takes your flag component as its `flag`
prop and passes it each locale's `countryCode`. The skill's recipe, which you can also follow by
hand:

1. `npm i -D flag-icons` (MIT).
2. Copy the SVG of each configured `countryCode`, and only those, into `public/flags/`, and
   commit them:

   ```sh
   mkdir -p public/flags
   for code in us de br; do cp node_modules/flag-icons/flags/4x3/$code.svg public/flags/; done
   ```

3. Add `src/components/Flag.astro`. It serves the file through an `<img>` instead of inlining
   the SVG: some flag-icons files are large (`es.svg` with its coat of arms is about 80 KB), and
   an `<img>` is one cached request per flag instead of that markup in every page.

   ```astro
   ---
   // src/components/Flag.astro
   interface Props {
     code?: string
     size?: number
   }
   const { code, size = 16 } = Astro.props
   ---

   {code && <img src={`/flags/${code}.svg`} width={(size * 4) / 3} height={size} alt="" loading="lazy" decoding="async" />}
   ```

4. Pass it to the switcher: `<LanguageSwitcher flag={Flag} />`.

A locale without a `countryCode` shows its name alone. A `countryCode` whose SVG is missing from
`public/flags/` shows a broken image, so copy one file per code. The flag belongs to the
`countryCode`, not the language, so `pt` and `pt-br` can show different flags.

#### How it checks the result

Before it reports back, the skill runs its adoption checklist: the config matches your answers
and every locale code is lowercase; `seed` writes the generated files and leaves
`.i18n-hashes.json` alone; `astro check` passes; under `astro dev`, `/` redirects to a locale,
each locale renders its own copy (or the default locale's, if it has no JSON yet), an unknown
first segment such as `/zz/` is prefixed rather than crashing, `<html lang>` reads `pt-BR` on a
`pt-br` page, hreflang tags cover every locale plus `x-default`, and the switcher changes the
URL and sets the language cookie. It also checks that no page is left at `src/pages/*.astro`
(the error pages `404.astro` and `500.astro` excepted) and that every `countryCode` has its SVG.

### Everyday work

Ask in plain words: "add a key for the footer note", "add French", "add a `pricing`
namespace", "change the hero title in production". What the skill does:

- **A key or a value.** It adds a new key to the default locale first, since the default
  locale's JSON is the type schema, then to the other locales, and runs `npx edgekits-i18n
seed`. A key that exists only in another locale is not typed.
- **A locale.** It adds the locale to `languages` (and its SVG, with flags on), optionally
  writes `locales/<new>/`, runs `seed` and restarts the dev server. A locale without JSON is
  routable already: it shows the default locale's copy and the missing-translation banner.
- **A namespace.** It creates `locales/<default>/<namespace>.json` and the same file in each
  other locale, runs `seed`, and fetches the namespace only on the pages that render it.
- **Production copy.** Edit the JSON, then: `seed` and check it locally; run the project's
  checks (`astro check`, tests, build); `npx edgekits-i18n migrate`, which pushes to production
  KV and purges only the changed namespaces; commit the JSON together with
  `.i18n-hashes.json`. No redeploy is needed unless the config or code changed too.

`.i18n-hashes.json` records what production KV holds. Only a successful `migrate` writes it,
it is committed right after, and nothing else edits it. `migrate` refuses to run while that
file has uncommitted changes.

### Forms and SEO

**Forms.** Ask for "a localized contact form with name, email and message", or "localize this
form". The skill asks for the fields and their rules, where the form submits (an Astro Action
by default) and where it renders. What comes back: stable error codes (`INVALID_EMAIL`) with a
message for every code in every locale's `messages.json`; a server schema that emits the codes;
an Astro Action; and a `.astro` form with an inline script. By default the browser side uses
no framework and no zod: it validates with a small hand-written mirror of the server schema, so
the form works with a strict Content Security Policy and without JavaScript. Ask for React or a
form library and the skill uses it, with the same error codes and still no zod in the browser.

**SEO.** Ask for "hreflang tags", "a sitemap for every locale", "an RSS feed per locale",
"`llms.txt`" or "`robots.txt` that blocks staging". The skill writes them as your project's
code, using the package's locale constants and helpers: a `SeoHreflangs` component and
`<html lang>` in the base layout, `sitemap.xml`, `[lang]/rss.xml`, `llms.txt` and `robots.txt`
endpoints.
For a blog in several languages, ask to "list every post in every locale": an untranslated
post is listed and shown in the default locale with the banner, and its page points its
canonical at the original instead of using `noindex`.

### Rules the agent follows

- Locale codes are lowercase everywhere: config keys, `locales/` folders, URLs (`pt-br`). Only
  `toIetfTag()` produces `pt-BR`, for `<html lang>` and hreflang.
- Generated files (`*.generated.*`, `runtime-constants.ts`, `i18n-data.json`) come from the CLI
  and are never edited by hand.
- `@edgekits/astro-i18n/runtime` and `/middleware` run only in workerd. Anything Node loads
  (`astro.config`, `src/content.config.ts`, unit tests) uses the Node-safe `/config` and
  `/format` entries instead.
- No engine code is copied into the project. If the package lacks something, the skill says so
  rather than re-implementing it.
- Secrets (`.dev.vars`, `.env*`, API tokens) never enter git, and anything that touches your
  Cloudflare account is asked first.

### Troubleshooting

- **Edited translations do not show under `astro dev`.** The local Cache API keeps the first
  value it served. Put `I18N_CACHE=off` in `.dev.vars`, restart the dev server, run `seed`.
- **A new key is a type error.** It was added only to a non-default locale, or the CLI has not
  run since. Add it to the default locale and run `seed` (or `bundle`); if the editor still
  shows the error, restart its TypeScript server.
- **`Cannot find module 'cloudflare:workers'` in `tsc`.** Run `npx wrangler types`.
- **`migrate` refuses to run.** `.i18n-hashes.json` has uncommitted changes. If the last
  `migrate` wrote it, commit it. If anything else changed it, discard the change with
  `git checkout .i18n-hashes.json` and run `migrate` again. Never edit or delete it to get
  past the check.
- **`migrate` exits 1 after "KV is updated; the edge cache is not".** The purge was skipped or
  failed: the zone ID or token is missing, or the Purge API refused. Fix it and run `migrate`
  again; it retries the same purge. If it exited 0 and the site still shows old copy, the zone
  is not proxied.
- **npm 12: `esbuild` or `workerd` did not install.** npm 12 blocks dependency install
  scripts by default and lists the skipped packages at the end of `npm install`. Both need
  theirs: run `npm install-scripts approve esbuild workerd`, then
  `npm rebuild esbuild workerd`. The approval is the `allowScripts` field in `package.json`;
  `approve` pins the installed versions (`"esbuild@0.28.2": true`), and a name-only entry
  allows later versions too:

  ```json
  "allowScripts": { "esbuild": true, "workerd": true }
  ```

- **The language switcher has no effect (before 0.1.3).** A `lang` cookie from another site on
  the same host (every `localhost` port shares one set of cookies) could not be overwritten by
  the switcher. Since 0.1.3 the middleware replaces a `lang` value that is not one of your
  locales with the URL's locale on the next request, and the switcher can write it again.
- **Windows.** Local KV (`seed`) can fail with "Network connection lost" or "internal error"
  when the project sits in a deep folder: the local Workers runtime hits the path length
  limit, so keep the project at a short path. Stopping `astro dev` can leave `workerd.exe`
  running and holding `.wrangler/state`; end it before the next `seed`. In PowerShell, copy
  the flags with
  `foreach ($c in 'us','de','br') { Copy-Item node_modules/flag-icons/flags/4x3/$c.svg public/flags/ }`.

### Privacy

This plugin collects, stores and sends no data. It contains no code, no hooks and no MCP servers, only
instructions (`SKILL.md`, its reference pages and two starter translation files). The commands it asks your agent
to run (`npm install`, `wrangler`, the package's `edgekits-i18n` CLI) talk to npm and to your own Cloudflare account
under their own terms. EdgeKits runs no service behind this plugin.

<!-- skill-guide:end -->

## How it works

A request reaches the middleware, which settles the URL's locale (redirecting when there is
none) and sets `uiLocale` and `translationLocale` on `Astro.locals`. A page asks
`fetchTranslations` for the namespaces it renders. Each namespace is looked up in the Workers
Cache API under `https://<keyPrefix>/…`; the misses are read from KV in batches of up to 100
keys, and their KV values are written back to the cache in the background. Every namespace,
cached or fresh, is merged over the compiled default-locale fallbacks when it is read, so a new
default-locale key shows in every locale on the next deploy. A cached value lives for a year
(`s-maxage=31536000, immutable`): `migrate` purges the ones whose content changed, and leaves
the rest warm. A namespace KV does not have is cached as missing for 60 seconds. If KV cannot be reached, the compiled fallbacks render the
default locale's text instead of an error.

## License

MIT © Gary Stupak. See [LICENSE](LICENSE).
