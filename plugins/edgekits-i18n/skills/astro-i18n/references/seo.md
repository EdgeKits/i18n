# Using translations, the package components, and multilingual SEO

How pages consume `@edgekits/astro-i18n`, how to place its two components, and the SEO pieces
the agent adds to the project. Imports come from the package entries:

| Entry                               | Where                               | Holds (used here)                                                                                                                                       |
| ----------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@edgekits/astro-i18n/runtime`      | pages, layouts, endpoints (workerd) | `fetchTranslations`, `DEFAULT_LOCALE`, `SUPPORTED_LOCALES`, `LANGUAGES`, `I18N_CONFIG`, `fmt`, `pluralIcu`, `toIetfTag`, `localizedPath`, `type Locale` |
| `@edgekits/astro-i18n/format`       | anywhere, Node-safe                 | `fmt`, `plural`, `pluralIcu`, `toIetfTag`, `localizedPath`, `getLangFromUrl`                                                                            |
| `@edgekits/astro-i18n/config`       | anywhere, Node-safe                 | `localesOf(config)` → `DEFAULT_LOCALE`, `SUPPORTED_LOCALES`, `LANGUAGES`                                                                                |
| `@edgekits/astro-i18n/components/*` | `.astro` files                      | `LanguageSwitcher`, `MissingTranslationBanner`                                                                                                          |

`./runtime` runs only in workerd. A module that Node loads (`src/content.config.ts` under
`astro sync`, unit tests, anything imported by `astro.config`) takes its locale values from
`localesOf(i18nConfig)` and its helpers from `./format`, never from `./runtime`.

---

## Fetching translations in a page

`fetchTranslations(translationLocale, [...namespaces])`, with `translationLocale` from
`Astro.locals` (the middleware sets it). Load only the namespaces the page renders: each one is
cached on its own.

```astro
---
// src/pages/[lang]/index.astro
import BaseLayout from '../../layouts/BaseLayout.astro'
import { fetchTranslations } from '@edgekits/astro-i18n/runtime'

const { translationLocale } = Astro.locals

const { common, landing } = await fetchTranslations(translationLocale, ['common', 'landing'])
---

<BaseLayout title={common.seo.title} description={common.seo.description}>
  <h1>{landing.hero.heading}</h1>
</BaseLayout>
```

Localized pages live under `src/pages/[lang]/…`. Read the locale from `Astro.locals.uiLocale`
(set by the middleware in both modes), not from `Astro.params.lang`: in
`'prefix-except-default'` a root URL has no locale segment.

### Route layout

Adopting the package on an existing site moves its pages; nothing else changes their paths.
The layout is the same in both routing modes (the config's `routing`, the A0 answer):

```
before                          after
src/pages/                      src/pages/
  index.astro                     [lang]/
  about.astro                       index.astro         (was index.astro)
  blog/[slug].astro                 about.astro
  robots.txt.ts                     blog/[slug].astro
  api/subscribe.ts                robots.txt.ts         (stays: not localized)
                                  api/subscribe.ts      (stays)
```

- Every page moves under `src/pages/[lang]/` with the same relative path; relative imports in a
  moved file gain one `../`.
- No `src/pages/index.astro` remains at the root, in either mode. In `'prefix'` the middleware
  redirects `/` to `/<locale>/`. In `'prefix-except-default'` it serves a root URL (`/`,
  `/about/`) by rewriting it internally to `/<defaultLocale>/…`: the visitor's URL stays, the
  `[lang]` page renders.
- Endpoints that are not localized stay at the root: `robots.txt`, `sitemap.xml`, `llms.txt`,
  `/api/*`. Files in `public/` are served as they are.
- The error pages stay at the root too: `src/pages/404.astro` (and `500.astro`), never under
  `[lang]`, and on-demand (a prerendered 404 stops the build). They read the locale from
  `Astro.locals` (the middleware lets `/404` through untouched, and keeps the visitor's locale
  when Astro renders it for a missing page).
- A page whose last segment contains a dot (`/team/john.doe/`) is linked with its trailing
  slash: `/team/john.doe` is a file path, which the middleware leaves alone (no redirect, no
  locale). `localizedPath` keeps the slash for a path that ends in `/`.
- `Astro.originPathname` is the path the visitor requested; `Astro.url.pathname` is the path
  that rendered, which in the root mode is the rewritten `/<defaultLocale>/…`. Canonical,
  hreflang and links come from `localizedPath` over `Astro.originPathname`, never from
  `Astro.url.pathname` directly.
- Links inside pages go through `localizedPath`: `localizedPath(uiLocale, '/about/', pathOptions)`
  is `/about/` for the default locale in the root mode and `/<locale>/about/` otherwise.
  `pathOptions` is one small project module:

  ```ts
  // src/lib/paths.ts
  import { DEFAULT_LOCALE, I18N_CONFIG, SUPPORTED_LOCALES } from '@edgekits/astro-i18n/runtime'

  // The options `localizedPath` takes, from the config: the mode lives here, not in components.
  export const pathOptions = {
    routing: I18N_CONFIG.routing,
    defaultLocale: DEFAULT_LOCALE,
    isLocale: (segment: string) => (SUPPORTED_LOCALES as readonly string[]).includes(segment),
  }
  ```

- The base layout sets `<html lang={toIetfTag(uiLocale)}>` (see "SEO suite" below); a layout
  with a hard-coded `lang` is the most common leftover.

### Passing translations to a component

Components receive typed slices as props; nothing re-fetches and nothing hydrates. `I18n.Schema`
is a global namespace generated by the CLI, so it needs no import:

```astro
---
// src/components/Hero.astro
interface Props {
  t: I18n.Schema['landing']
}
const { t } = Astro.props
---

<p>{t.hero.subHeading}</p>
```

```astro
<Hero t={landing} />
```

Pass `uiLocale` (from `Astro.locals`) alongside when the component needs locale-aware logic
(dates, numbers, plurals). Interactive parts stay island-free: Astro markup plus a bundled
`<script>`, see `forms.md`.

---

## Interpolation and plurals (`fmt`, `pluralIcu`)

Keep HTML structure and placeholders in the JSON; inject only values with `fmt()`, which
HTML-escapes them, and render with `set:html`.

```json
// locales/en/common.json
{
  "ui": {
    "emphasis": "Please note: <strong>{content}</strong>",
    "learnMore": "Read our <a href='{url}'>{label}</a>."
  }
}
```

```astro
---
import { fmt } from '@edgekits/astro-i18n/runtime'
const msg = fmt(common.ui.emphasis, { content: 'wrangler.jsonc' })
---

<p set:html={msg} />
```

Plurals: ICU-style patterns per locale in JSON, selected with `Intl.PluralRules`:

```json
{ "counter": { "patterns": { "zero": "No items", "one": "{count} item", "other": "{count} items" } } }
```

```ts
import { pluralIcu } from '@edgekits/astro-i18n/runtime'
pluralIcu(count, translationLocale, blog.counter.patterns)
```

---

## `LanguageSwitcher`

The package's switcher: a small custom element that sets the language cookie and swaps the
URL's locale segment. It is headless: it renders no class unless you pass one, and takes the
project's own UI as props (all optional):

- `flag`: an Astro component `({ code, size })` rendering a flag for `LANGUAGES[locale].countryCode`;
  without it, or for a locale without a `countryCode`, items are label-only (recipe below);
- `triggerIcon`, `activeIcon`: Astro components for the toggle and the current-language marker;
  without them, small inline SVGs render;
- `classes`: one class string per slot (`root`, `trigger`, `triggerIcon`, `dropdown`, `item`,
  `itemActive`, `itemLabel`, `activeIcon`). The slot table, the `data-*` hooks and a plain-CSS
  example are in the package README, "Styling the components";
- `texts`: `{ trigger }`, the toggle's `aria-label` (default `Switch language`). The package
  fetches nothing for it: the project fetches `common` and passes `common.switchLanguage`.
  Each language name already carries `lang` with its locale.

```astro
---
// src/components/Header.astro
import LanguageSwitcher from '@edgekits/astro-i18n/components/LanguageSwitcher'
import { fetchTranslations } from '@edgekits/astro-i18n/runtime'
import Flag from './Flag.astro' // the project's own flag component, if any

const { common } = await fetchTranslations(Astro.locals.translationLocale, ['common'])
---

<LanguageSwitcher
  flag={Flag}
  texts={{ trigger: common.switchLanguage }}
  classes={{
    root: 'relative',
    dropdown: 'absolute right-0 z-50 w-44 rounded-lg border bg-white shadow-lg',
    item: 'flex w-full items-center justify-between px-4 py-2 text-sm',
    itemActive: 'font-semibold',
    itemLabel: 'flex items-center gap-3',
  }}
/>
```

The menu opens and closes through the `hidden` attribute. A display utility (`flex`, `grid`) on
the `dropdown` slot overrides the browser's `[hidden] { display: none }`; leave display off that
slot or restate the rule.

### Flags

The package ships no flag images. The flag of a locale is its `countryCode` (ISO 3166-1
alpha-2, lowercase), not the locale: `pt` and `pt-br` are one language and can carry two flags
(`pt`, `br`). The SVGs come from the [`flag-icons`](https://www.npmjs.com/package/flag-icons)
npm package (MIT) unless the project has its own.

1. `npm i -D flag-icons`.
2. Copy one SVG per configured `countryCode`, and only those, into `public/flags/`; commit
   them. The build then never reads `node_modules/flag-icons`.

   ```sh
   mkdir -p public/flags
   for code in us de br; do cp node_modules/flag-icons/flags/4x3/$code.svg public/flags/; done
   ```

3. `src/components/Flag.astro`: an `<img>` of `/flags/<code>.svg` at `size`, nothing when there
   is no code. Not an inlined SVG: some flag-icons files are large (`es.svg` with its coat of
   arms is about 80 KB) and inlining puts that into every page; an `<img>` is one cached
   request per flag. That the file exists is the project's to ensure (the adoption checklist
   checks it).

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

4. `flag={Flag}` on the switcher (example above).

Adding a locale later is its `countryCode` in the config plus one SVG in that folder.
`flags/4x3/` holds the classic 4:3 flags; `flags/1x1/` holds square ones (render them with
`width={size}`).

---

## `MissingTranslationBanner`

Renders a notice when the UI locale is not fully translated (`ui`) or a page fell back to
default-locale content (`content`); renders nothing otherwise, and nothing at all when the
config's `missingTranslationBanner` is `false`. It fetches nothing: pass both texts from the
project's own translations (the starter `messages.json` has them).

```astro
---
// src/layouts/BaseLayout.astro (excerpt)
import MissingTranslationBanner from '@edgekits/astro-i18n/components/MissingTranslationBanner'
import { fetchTranslations } from '@edgekits/astro-i18n/runtime'

const { translationLocale } = Astro.locals
const { messages } = await fetchTranslations(translationLocale, ['messages'])
---

<MissingTranslationBanner
  texts={{
    content: messages.errors.ui.MISSING_TRANSLATED_CONTENT,
    ui: messages.errors.ui.MISSING_TRANSLATED_UI,
  }}
  classes={{ root: 'mx-6 mt-6 border px-4 py-2 text-center' }}
/>
<slot />
```

`content` mode is the page's call: set `Astro.locals.isMissingContent` when it falls back.
The banner's root carries `data-missing="content|ui"` for styling.

### Content fallback: the helpers

Content entries are keyed `<locale>/<slug>` (`en/architecture`). Two helpers serve the post
page and the list page; `draft` and `pubDate` stand for the collection's own fields.

```ts
// src/lib/blog.ts
import { getCollection, type CollectionEntry } from 'astro:content'

type Post = CollectionEntry<'blog'>

export function splitId(id: string): { locale: string; slug: string } {
  const [locale = '', ...rest] = id.split('/')
  return { locale, slug: rest.join('/') }
}

const getPublishedPosts = () => getCollection('blog', ({ data }) => !data.draft)

// slug -> the locales the post exists in (its hreflang set).
export async function getPostLocales(): Promise<Map<string, string[]>> {
  const bySlug = new Map<string, string[]>()
  for (const post of await getPublishedPosts()) {
    const { locale, slug } = splitId(post.id)
    bySlug.set(slug, [...(bySlug.get(slug) ?? []), locale])
  }
  return bySlug
}

// Every default-locale post, each replaced by its `locale` version when one exists.
export async function getPostsWithFallback(locale: string, defaultLocale: string): Promise<{ post: Post; isFallback: boolean }[]> {
  const published = await getPublishedPosts()
  const translated = new Map(published.filter((post) => splitId(post.id).locale === locale).map((post) => [splitId(post.id).slug, post]))
  return published
    .filter((post) => splitId(post.id).locale === defaultLocale)
    .map((base) => {
      const post = translated.get(splitId(base.id).slug)
      return post ? { post, isFallback: false } : { post: base, isFallback: true }
    })
    .sort((a, b) => b.post.data.pubDate.valueOf() - a.post.data.pubDate.valueOf())
}
```

### Fallback post: canonical to the original, no robots meta

A post opened in a locale it was not written in renders the default-locale post with the
banner. The page stays 200, its `<link rel="canonical">` points at the default-locale URL of the
same post, it carries **no robots meta**, and its hreflang set lists only the locales the post
exists in, plus `x-default`. Never `noindex` it: `noindex` next to a canonical sends search
engines conflicting signals, and the canonical alone consolidates the fallback URL into the
original.

```astro
---
// src/pages/[lang]/blog/[...slug].astro
import { getEntry, render } from 'astro:content'
import { DEFAULT_LOCALE, localizedPath } from '@edgekits/astro-i18n/runtime'
import BaseLayout from '../../../layouts/BaseLayout.astro'
import { getPostLocales } from '../../../lib/blog'
import { pathOptions } from '../../../lib/paths'

const { uiLocale } = Astro.locals
const slug = Astro.params.slug ?? ''

const altLocales = (await getPostLocales()).get(slug) ?? []
const contentLocale = altLocales.includes(uiLocale) ? uiLocale : DEFAULT_LOCALE
const post = altLocales.includes(contentLocale) ? await getEntry('blog', `${contentLocale}/${slug}`) : undefined
// The 404 page stays at the root (src/pages/404.astro, not under [lang]) and reads the
// locale from Astro.locals: the middleware lets /404 through untouched, in both modes.
if (!post) return Astro.rewrite('/404')

const isFallback = contentLocale !== uiLocale
Astro.locals.isMissingContent = isFallback // the banner shows in 'content' mode
const origin = import.meta.env.PROD ? 'https://example.com' : Astro.url.origin // as in the layout
const canonicalOverride = isFallback ? origin + localizedPath(DEFAULT_LOCALE, `/blog/${slug}/`, pathOptions) : undefined
const { Content } = await render(post)
---

<BaseLayout title={post.data.title} altLocales={altLocales} canonicalOverride={canonicalOverride}>
  <article lang={isFallback ? contentLocale : undefined}><Content /></article>
</BaseLayout>
```

The layout takes the override and keeps the self-canonical for every other page (the full
layout is under "SEO suite" below):

```astro
---
// src/layouts/BaseLayout.astro (excerpt)
interface Props {
  title?: string
  // The locales this page exists in (hreflang). Default: every supported locale.
  altLocales?: readonly string[]
  // Absolute canonical URL when it is not this page (a fallback post points at the original).
  canonicalOverride?: string
}
const { altLocales, canonicalOverride } = Astro.props
const canonical = canonicalOverride ?? currentOrigin + localizedPath(uiLocale, Astro.originPathname, pathOptions)
---

<link rel="canonical" href={canonical} />
<SeoHreflangs currentLang={uiLocale} currentOrigin={currentOrigin} altLocales={altLocales} />
```

### List pages: show every post

A list page (the blog index) shows every post in every locale, not only the translated ones:
every published default-locale post, replaced by the URL locale's version where one exists,
sorted. If any listed post is a fallback, the page sets `isMissingContent` (the banner in
`content` mode) and marks that card: a locale badge and a `lang` attribute on the card. Every
card links to the URL-locale path; the post page falls back.

```astro
---
// src/pages/[lang]/blog/index.astro
import { DEFAULT_LOCALE, fetchTranslations, localizedPath } from '@edgekits/astro-i18n/runtime'
import BaseLayout from '../../../layouts/BaseLayout.astro'
import { getPostsWithFallback, splitId } from '../../../lib/blog'
import { pathOptions } from '../../../lib/paths'

const { uiLocale, translationLocale } = Astro.locals
const { blog } = await fetchTranslations(translationLocale, ['blog'])

const posts = await getPostsWithFallback(uiLocale, DEFAULT_LOCALE)
Astro.locals.isMissingContent = posts.some(({ isFallback }) => isFallback)
---

<BaseLayout title={blog.title}>
  <ul>
    {
      posts.map(({ post, isFallback }) => {
        const { locale, slug } = splitId(post.id)
        return (
          <li>
            <article lang={isFallback ? locale : undefined}>
              <h2>
                <a href={localizedPath(uiLocale, `/blog/${slug}/`, pathOptions)}>{post.data.title}</a>
              </h2>
              {isFallback && (
                <span lang={uiLocale} title={blog.untranslated}>
                  <span aria-hidden="true">{locale.toUpperCase()}</span>
                  <span class="sr-only">{blog.untranslated}</span>
                </span>
              )}
              <p>{post.data.description}</p>
            </article>
          </li>
        )
      })
    }
  </ul>
</BaseLayout>
```

`blog.title` and `blog.untranslated` ("Not translated yet") are keys of the project's own `blog`
namespace; `sr-only` is the project's visually-hidden class. Text on the card that comes from
the URL locale's translations (dates, "read more") takes `lang={uiLocale}`, as the badge does.

---

## SEO suite (project code the agent adds)

None of this ships in the package: write it into the project, using the package's constants and
helpers.

### `<html lang>` and hreflang in the base layout

```astro
---
// src/layouts/BaseLayout.astro (excerpt)
import { localizedPath, toIetfTag } from '@edgekits/astro-i18n/runtime'
import SeoHreflangs from '../components/seo/SeoHreflangs.astro'
import { pathOptions } from '../lib/paths'

const { uiLocale } = Astro.locals
const currentOrigin = import.meta.env.PROD ? 'https://example.com' : Astro.url.origin
---

<html lang={toIetfTag(uiLocale)}>
  <head>
    <SeoHreflangs currentLang={uiLocale} currentOrigin={currentOrigin} />
    <link rel="canonical" href={currentOrigin + localizedPath(uiLocale, Astro.originPathname, pathOptions)} />
  </head>
  <!-- … -->
</html>
```

Locale codes stay lowercase everywhere; `toIetfTag('pt-br')` returns `pt-BR` for `lang` and
`hreflang` only. A fallback post replaces the self-canonical through `canonicalOverride` (see
"Fallback post" above).

### `SeoHreflangs.astro`

```astro
---
// src/components/seo/SeoHreflangs.astro
import { DEFAULT_LOCALE, SUPPORTED_LOCALES, localizedPath, toIetfTag } from '@edgekits/astro-i18n/runtime'
import { pathOptions } from '../../lib/paths'

interface Props {
  currentLang: string
  currentOrigin: string
  // The locales this page really exists in (e.g. the translations of a blog post).
  // Default: every supported locale.
  altLocales?: readonly string[]
}

const { currentOrigin, altLocales } = Astro.props
// The requested path: in the root mode `Astro.url.pathname` is the rewritten one.
const path = Astro.originPathname
const locales = altLocales ?? SUPPORTED_LOCALES
const href = (code: string) => currentOrigin + localizedPath(code, path, pathOptions)
---

{
  locales.length > 1 && (
    <>
      {locales.map((code) => (
        <link rel="alternate" hreflang={toIetfTag(code)} href={href(code)} />
      ))}
      {locales.includes(DEFAULT_LOCALE) && <link rel="alternate" hreflang="x-default" href={href(DEFAULT_LOCALE)} />}
    </>
  )
}
```

`x-default` is `localizedPath(DEFAULT_LOCALE, path, pathOptions)`: `/about/` in the root mode,
`/en/about/` in `'prefix'`. The component has no mode-specific code: `pathOptions` carries the
mode, and `localizedPath` strips whatever locale segment the path has. `currentLang` stays in
the props, unused here, so the layout's call does not change.

### Sitemap, RSS, `llms.txt`, `robots.txt`

Endpoints under `src/pages/`, running in workerd, so they import from `./runtime`:

- `src/pages/sitemap.xml.ts`: every static route for every locale, plus content entries keyed
  `<locale>/<slug>`: the post files that exist, never a fallback URL (no `/de/blog/x` when
  only `en/x` exists).
  Every `loc` goes through `localizedPath`, so in the root mode the default locale's entries
  have no prefix:
  ```ts
  import { SUPPORTED_LOCALES, localizedPath } from '@edgekits/astro-i18n/runtime'
  import { pathOptions } from '../lib/paths'
  for (const locale of SUPPORTED_LOCALES) for (const route of ['/', '/blog/']) entries.push({ loc: siteUrl + localizedPath(locale, route, pathOptions) })
  ```
  If the route list is shared with a Node-loaded module (a unit test, `content.config.ts`),
  derive the locales there with `localesOf(i18nConfig)` from `./config` and take
  `localizedPath` from `./format`, with the options built from the config the same way.
- `src/pages/[lang]/rss.xml.ts`: one feed per locale, filtered by `Astro.locals.uiLocale`
  (unchanged in both modes). In the root mode the default locale's feed URL has no prefix
  (`/rss.xml`); the others stay `/<locale>/rss.xml`.
- `src/pages/llms.txt.ts`: `DEFAULT_LOCALE` content only, to save the reader's context. Markdown
  twins of pages (`/<locale>/blog/x.md`) pair with the config's `markdownLocale`, which
  redirects every `.md` URL to that one locale.
- `src/pages/robots.txt.ts`: `Disallow: /` while a staging flag of the project's own is on
  (a `wrangler.jsonc` var such as `DEMO_MODE`), otherwise open, pointing at `sitemap.xml`. Pair
  it with an `X-Robots-Tag: noindex` header on staging.

### URL strategy

Which routing mode the project uses is the A0 answer (the config's `routing`), not the agent's
choice.

`'prefix-except-default'` (the default): the default locale lives at the root (`/`, `/about/`),
every other locale under its prefix (`/de/about/`). `/en/about/` redirects permanently to
`/about/`. A root URL consults neither Accept-Language nor the country; only a lang cookie for
another locale (set by the switcher) redirects it, temporarily, to that locale.

`'prefix'`: every URL starts with its locale (`/en/about/`); `/` and any URL without a locale
redirect to the visitor's locale (cookie, Accept-Language, country, default).

Keep content slugs in English across locales (`/de/blog/architecture`, not percent-encoded native
slugs): no filesystem normalization issues, and content lookup by canonical id stays simple. For
localized URLs, add a `localizedSlug → canonicalSlug → getEntry()` mapping layer and keep the
canonical and hreflang tags to avoid duplicate-content collisions.
