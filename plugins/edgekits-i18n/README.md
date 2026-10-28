# EdgeKits i18n

Two free agent skills for Claude Code, Cursor, OpenCode and any other coding agent that reads `SKILL.md`:
`astro-i18n` makes an Astro site multilingual with [`@edgekits/astro-i18n`](https://github.com/EdgeKits/i18n);
`tanstack-i18n` does the same for a TanStack Start app with `@edgekits/tanstack-i18n`, sharing the site's
translations. With `astro-i18n`, translations are stored as data in Workers KV, behind a per-namespace edge cache
that is purged only where content changed, and translation keys are typed from your default locale's JSON. It asks
the few questions only you can answer (locales, default locale, geo and markdown policy, flags), follows the package
README in order, and checks the result.

It also covers what comes after the setup: localized forms the EdgeKits way (validation errors as stable codes,
no client framework and no zod in the browser), and multilingual SEO (`<html lang>`, hreflang, sitemap, RSS,
`llms.txt`, `robots.txt`).

The plugin ships two skills. `astro-i18n`, described below, triggers on an Astro site on Cloudflare Workers: "add
i18n", "make the site multilingual", a new locale, namespace, form or hreflang tags. `tanstack-i18n` triggers in a
TanStack Start app on Workers with a custom Hono `src/worker.ts`: "add i18n to the app", "add a namespace",
"translate the admin", `useT`. It adopts [`@edgekits/tanstack-i18n`](https://github.com/EdgeKits/i18n/tree/main/packages/tanstack#readme),
which shares the translations folder and the KV namespace with the monorepo's other Workers.

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
and that every `countryCode` has its SVG.

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
- **`migrate` updated KV but the site shows old copy.** The purge was skipped: the zone is not
  proxied, or the zone ID or token is missing. Fix it and run `migrate` again; it retries the
  same purge.
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

## License

MIT, see [LICENSE](../../LICENSE).
