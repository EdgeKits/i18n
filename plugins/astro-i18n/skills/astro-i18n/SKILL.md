---
name: astro-i18n
description: >-
  Adopt @edgekits/astro-i18n in an Astro + Cloudflare Workers project: edge-native i18n with
  translations in Workers KV, a per-namespace edge cache purged on change, typed keys, and a
  locale-routing middleware; then localize forms (errors as codes, island-free, no zod in the
  browser) and multilingual SEO (html lang, hreflang, sitemap, RSS, llms.txt). Use when the user
  asks to install it, "add i18n", "add multilingual", "make the site multilingual", "добавь
  мультиязычность", "translate the site", add a locale or language, add a translation namespace,
  localize a form, or add hreflang tags.
---

# Astro i18n (EdgeKits)

Adopts `@edgekits/astro-i18n` and builds on it. **The package README
(`node_modules/@edgekits/astro-i18n/README.md` after `npm i`) is the installation and
configuration reference: read it, follow it, do not restate it.**

## Mental model

- Translations are KV data (`<locale>/<namespace>` JSON) fetched on the server; changing copy
  is `edgekits-i18n migrate`, not a redeploy. Each namespace is edge-cached under its own URL;
  `migrate` purges only the changed ones.
- The CLI generates `I18n.Schema` from the default locale's JSON, so `t.ns.key` is typed.
- `Astro.locals.uiLocale` is the URL's locale (`<html lang>`, SEO, switcher);
  `translationLocale` is the one to fetch (the default if that locale has no JSON).
- `./config` and `./format` are Node-safe; `./runtime` and `./middleware` run only in workerd.

## Workflow A: adopt the package

### A0. Ask first, and wait for the answers

Before writing any file, ask the questions the request has not answered, in one round, and
wait, in every mode (auto and non-interactive included). The defaults below are no substitute
for answers: they apply only when the user says they do not care. If asking is impossible,
stop and print the open questions.

1. Which locales, and which is the default? Codes are lowercase (`pt-br`).
2. An existing Astro + `@astrojs/cloudflare` project? Without one (the skill scaffolds
   nothing; the package is Workers- and KV-specific), say so and stop.
3. Markdown endpoints (`/blog/x.md`, `llms.txt` twins)? In which locale? That is
   `markdownLocale`; without it `.md` paths pass through.
4. Should the visitor's country pick the locale when nothing else matches? Which countries,
   to which locale? That is `countryToLocale`; without it geo is skipped.
5. Middleware: `auto` (the integration registers it) or `manual` (in the project's own
   `src/middleware.ts` sequence)? Ask if that file exists.
6. Flags in the switcher? A flag is the locale's lowercase `countryCode`: a regional locale
   takes its region (`pt-br` → `br`); for a language-only one propose a country (`en` → `us`)
   to confirm. Show the full list back before writing the config. SVGs: `flag-icons` or the
   project's own.
7. Routing (only with two or more locales; with one, the root mode needs no question): the
   default locale at the root (`/`, `/about/`; others prefixed), `'prefix-except-default'`,
   the default; or every locale prefixed (`/en/about/`), `'prefix'`?

Defaults when the user says they do not care: `missingTranslationBanner: true`, no
`countryToLocale`, no `markdownLocale`, `auto` middleware, flags on by the rule above,
`'prefix-except-default'`.

### A1. Install and follow the README in order

`npm i @edgekits/astro-i18n`, then follow these README sections in order:

1. Requirements (versions, `output: 'server'`, `wrangler.jsonc`).
2. Quick start 1–6: Install; Bind a KV namespace; Write `edgekits-i18n.config.ts` (the A0
   answers; no `countryCode` without flags); Add the integration; Write translations;
   Generate and seed.
3. Route layout, in both modes: every page moves under `src/pages/[lang]/`, same path
   (`about.astro` → `[lang]/about.astro`); no root `index.astro` (`'prefix'`: the middleware
   redirects `/`; root mode: it renders the default locale there by an internal rewrite).
   Non-localized endpoints (`robots.txt`, `sitemap`, `/api/*`) and `public/` stay at the
   root. Layouts set `<html lang>` from `Astro.locals.uiLocale` via `toIetfTag`. Code:
   `references/seo.md` → Route layout.
4. Quick start 7–8: Use translations in a page; Runtime switches.
5. Reference: Which entry to import; `countryToLocale`; `markdownLocale`; Styling the
   components. Flags on: `references/seo.md` → Flags.

Starter files: copy `assets/locales/common.json` and `messages.json` into `locales/<default>/`
and translate per locale (`messages.json`: banner texts, form error codes).

`wrangler kv namespace create` touches the user's Cloudflare account: ask before running it.
Until then, local dev takes any 32-character hex id.

### A2. Generated files and the purge baseline

- The CLI writes `i18n-data.json`, `src/i18n.generated.d.ts`, `<generatedDir>/runtime-constants.ts`
  and `<generatedDir>/fallbacks.generated.ts`. Commit them; rerun the CLI after every JSON edit.
- `.i18n-hashes.json` is written only by a successful `migrate` and records what production KV
  holds. Commit it right after each `migrate`. `seed` never touches it. `migrate` refuses to run
  while it has uncommitted changes; do not "fix" that by editing or deleting the file: ask the
  user which command last wrote it.

### A3. Verify

Run `references/checklists.md` → "Verify: adoption". Do not skip it. Follow-ups (add a locale or
a namespace, edit production copy) are recipes in the same file.

## Workflow B: create or localize a form

Read `references/forms.md`; it assumes Workflow A is done. Ask first: the fields and their
rules, the submission target (an Astro Action by default), and where the form renders.

Two invariants, whatever the field kit:

1. **Errors as codes.** Validation and server layers emit stable codes (`INVALID_EMAIL`), never
   human text; the `messages` namespace holds the text for every code in every locale.
2. **Island-free client.** A `.astro` form plus an inline `<script>` wiring the vanilla
   `enhanceForm` controller, no hydration directive. No zod in the browser (its JIT
   breaks a no-`'unsafe-eval'` CSP): the client validates with a
   hand-rolled mirror of the server schema. This is the default, not a ban: if the user asks
   for React, a form library or any framework, use it, keep errors as codes and zod out of
   the browser.

Verify with `references/checklists.md` → "Verify: localized form".

## SEO, the switcher and the banner

Read `references/seo.md`: `t` in pages and components, `fmt`, `pluralIcu`, the headless
`LanguageSwitcher` and `MissingTranslationBanner`,
`<html lang>` with `toIetfTag`, a `SeoHreflangs` component, sitemap, RSS, `llms.txt` and
`robots.txt`: project code the agent writes with the package's `SUPPORTED_LOCALES`,
`DEFAULT_LOCALE`, `localizedPath` (the one helper that knows the mode) and `toIetfTag`. Never
build canonical or hreflang from `Astro.url.pathname` directly: in the root mode it is the
rewritten path.

## Guardrails

- Ask the open A0 (or form) questions before writing code, in every mode; a default never
  stands in for an unanswered question.
- Locale codes are lowercase everywhere: config keys, `locales/` folders, URLs. Only
  `toIetfTag()` upper-cases the region, for `<html lang>` and hreflang.
- The default locale's JSON is the schema: a key only in another locale is not typed; add it
  to the default locale first.
- Generated files are produced by the CLI, never edited by hand.
- Secrets (`.dev.vars`, `.env*`, API tokens) never enter git: run `git check-ignore <file>`
  before writing one; stage files by name, never `git add -A`.
- Never import `@edgekits/astro-i18n/runtime` (or `/middleware`) from a module Node loads:
  `astro.config`, `edgekits-i18n.config.ts`, `src/content.config.ts`, unit tests. Use
  `localesOf(config)` (`./config`) and `./format` there.
- Do not copy engine code into the project; if the package lacks an export the project needs,
  say so instead of re-implementing it.
