# Checklists and recipes

Use these to verify work and to handle the common follow-up requests. Commands assume the
package is installed; `npx edgekits-i18n --help` lists the CLI.

---

## Verify: adoption (Workflow A)

- [ ] `edgekits-i18n.config.ts` at the project root: `languages` and `defaultLocale` are what
      the user asked for; `markdownLocale`, `countryToLocale` and the middleware mode match the
      A0 answers.
- [ ] The A0 questions the request did not answer were asked and answered before the config
      was written, also in auto mode; no default stood in for an unanswered question.
- [ ] Every locale code is **lowercase**, in the config and in the `locales/*` folder names.
- [ ] Route layout: every page is under `src/pages/[lang]/`; nothing is left at
      `src/pages/*.astro` but the error pages (`404.astro`, `500.astro`: they stay at the
      root, on-demand, and read the locale from `Astro.locals`), and only non-localized endpoints
      (`robots.txt`, `sitemap.xml`, `/api/*`) remain at the root. A missing entry answers
      `return Astro.rewrite('/404')`. No layout hard-codes `<html lang>`.
- [ ] Flags: every configured `countryCode` has its SVG in `public/flags/` and the
      switcher gets `flag={Flag}`; or flags are off (no `flag` prop, `countryCode` omitted).
- [ ] `locales/<defaultLocale>/` has at least `common.json` (it defines the schema).
- [ ] `astro.config` has `output: 'server'`, the Cloudflare adapter, and
      `edgekitsI18n(i18nConfig)` in `integrations`. With `{ middleware: 'manual' }`,
      `src/middleware.ts` puts `onRequest` from `@edgekits/astro-i18n/middleware` in its
      `sequence(...)`. An `i18n` block of the project's own covers every configured locale and
      the same default, and routes with `prefixDefaultLocale: true` and
      `redirectToDefaultLocale: false` (the build stops otherwise); without one, the
      integration sets it.
- [ ] `wrangler.jsonc` has the `TRANSLATIONS` KV binding and a `compatibility_date`.
- [ ] `npx edgekits-i18n seed` runs without error and writes `i18n-data.json`,
      `src/i18n.generated.d.ts`, `<generatedDir>/runtime-constants.ts` and
      `<generatedDir>/fallbacks.generated.ts`. `.i18n-hashes.json` is untouched.
- [ ] `.dev.vars` has `I18N_CACHE=off` while translations are being edited locally (the local
      Cache API keeps the first value it served).
- [ ] `npx wrangler types` after any `wrangler.jsonc` / `.dev.vars` change.
- [ ] `npx astro check` passes; `tsc --noEmit` too if the project runs it.
- [ ] `npx astro dev`, then:
  - [ ] `'prefix'`: `/` answers 302 to `/<locale>/` (cookie, then `Accept-Language`, then geo,
        then default); `/<default>/` renders its copy;
  - [ ] `'prefix-except-default'`: `/` answers 200 in the default locale (the URL stays);
        `/<default>/` answers 302 to `/` under `astro dev` (301 in a build); `/` with a lang
        cookie for another locale answers 302
        to `/<cookie>/`;
  - [ ] both modes: a request without a cookie gets no `Set-Cookie`; `/<other>/` renders its
        own copy, or default-locale copy if that locale has no JSON yet;
  - [ ] an unsupported first segment (`/zz/`) is treated as content, not crashed (`'prefix'`:
        prefixed; root mode: served as a default-locale path);
  - [ ] with `markdownLocale`, `/<other>/x.md` redirects once to `/<markdownLocale>/x.md`
        (`/x.md` in the root mode when `markdownLocale` is the default);
  - [ ] `<html lang>` is IETF-cased (`pt-BR`); hreflang tags exist for every locale plus
        `x-default`;
  - [ ] with a blog: the list shows every post in every locale, with the banner when one is
        untranslated; a fallback post has its canonical on the default-locale URL and no
        robots meta.
- [ ] The `LanguageSwitcher` changes the URL's locale segment and sets the language cookie; the
      dropdown hides again (if it never hides, a display class on the `dropdown` slot overrides
      `[hidden]`).

## Verify: production (before and after the first `migrate`)

- [ ] A real KV namespace (`npx wrangler kv namespace create TRANSLATIONS`); its id is the
      `TRANSLATIONS` binding in `wrangler.jsonc`.
- [ ] `CLOUDFLARE_ZONE_ID` in `wrangler.jsonc` vars (or the environment); the domain is
      **proxied** (orange cloud); `keyPrefix` is the site's domain.
- [ ] `CLOUDFLARE_CACHEPURGE_API_TOKEN` (Zone › Cache Purge) in the environment or `.dev.vars`;
      confirm `.dev.vars` is in `.gitignore` first (`git check-ignore .dev.vars`). Never commit
      it, never print it, never pass it on a command line.
- [ ] The Worker deployed at least once.
- [ ] `npx edgekits-i18n migrate` pushes to production KV and purges only the changed namespaces
      (its log lists them), twice, 65 s apart. Ask the user before running it. Exit 1 after
      "KV is updated; the edge cache is not" means the purge or the deletion of removed keys
      did not happen: fix the zone ID or token and run it again.
- [ ] `.i18n-hashes.json` committed right after every successful `migrate`; `migrate` refuses
      to run while its entry for the KV namespace it writes differs from the committed one.

## Verify: localized form (Workflow B)

The island-free items (no React, no `client:*`) hold unless the user asked for a framework; the
codes and no-zod-in-the-browser items hold always.

- [ ] Every code in `error-codes.ts` (and `common-codes.ts`) has a matching key under
      `errors.ui` / `errors.server` / `common` in **every** locale's `messages.json`.
- [ ] The server zod schema uses CODES as `message` (no human text); the **client** schema is
      a hand-rolled `ClientSchema` mirror (`client-schema.ts` helpers) with the same fields and
      CODES. **No zod, drizzle or server-only import in any `<script>`** (zod's `new Function()`
      JIT breaks a no-`'unsafe-eval'` CSP and bloats the bundle).
- [ ] The action has `accept: 'form'` and the JS path sends `FormData`; an empty field's type
      error carries `REQUIRED` (`z.string({ message: REQUIRED })`).
- [ ] The form's `action` carries a fragment (`actions.x + '#<id>'`) and the form's wrapper has
      that `id`, so the no-JS result opens in view.
- [ ] `src/middleware.ts` runs `redirectAfterNativePost` for the form's action: a successful
      native POST answers 303 to `<page>?sent=1#<id>`, where `<page>` is the URL the form was
      posted from in both routing modes (`/` stays `/`, never `/<default>/`); an error renders
      in place; a reload after success is a GET.
- [ ] The action throws `ActionError({ message: CODE, code: 'BAD_REQUEST' | 'INTERNAL_SERVER_ERROR' })`.
- [ ] The form is **island-free**: a `.astro` with `<form method="POST" action={actions.x}>` and
      an inline `<script>` calling `enhanceForm(form, clientSchema, action, { tErrors, … })`.
      No React, react-hook-form or shadcn.
- [ ] Markup contract: each field wrapped in `[data-slot="field"]` with a `name`; one
      `[data-error-for="<field>"]` slot per field and one `[data-error-for="_form"]`.
- [ ] Codes map through `resolveFieldMessages(codes, t.messages.errors.ui)`.
- [ ] The page fetches `['<form-namespace>', 'messages']` and passes typed `t` and `uiLocale`
      (hidden input); a plain component include, **no `client:*` directive**.
- [ ] Manual test in two locales, **with and without JS**: happy path; each validation error
      renders **localized** text; a forced server error renders the localized server message
      (toast or `_form` slot). Without JS: native POST, and `Astro.getActionResult` shows the
      result and inline errors; a reload after the no-JS success does not resubmit (the URL has
      no `_action`).
- [ ] Without JS, the native POST returns localized field errors: no 415, no raw codes.
- [ ] An empty required field reports `REQUIRED` on both paths (not `INVALID_EMAIL`, not zod's
      `invalid_type` text).
- [ ] `npx astro check` passes (`t` typed as `Pick<I18n.Schema, …>`); no `react` or `client:`
      ships for the form.

---

## Recipe: add a locale

1. Add it to `languages` in `edgekits-i18n.config.ts` (lowercase key, `name`, and
   `countryCode` when flags are on: copy its SVG too, see `seo.md` → Flags). If `astro.config`
   has its own `i18n` block, add it to `i18n.locales` too.
2. Optionally create `locales/<new>/` and translate. A locale without JSON is still routable:
   `translationLocale` falls back to the default locale, so the UI shows default copy and the
   missing-translation banner says so.
3. `npx edgekits-i18n seed`, then restart `npx astro dev` (the config is read at startup).
4. Check `/<new>/`. Hreflang and the sitemap need no edit when they use `localizedPath`.
5. Production: `npx edgekits-i18n migrate`, commit `.i18n-hashes.json`, deploy (the config
   change is code).

## Recipe: add a namespace

1. Create `locales/<defaultLocale>/<namespace>.json` (this types it), then the same file in
   each other locale.
2. `npx edgekits-i18n seed` (or `bundle` for types only): the namespace is discovered and typed.
3. Use it: `const { <namespace> } = await fetchTranslations(translationLocale, ['<namespace>'])`.

## Recipe: edit copy in production

1. Edit `locales/<locale>/<namespace>.json`.
2. `npx edgekits-i18n migrate`: pushes to KV and purges only the changed `locale:namespace`
   entries. No deploy needed. Commit `.i18n-hashes.json`.

---

## Common pitfalls

- **A key isn't typed**: it exists only in a non-default locale. Add it to the default locale
  first, then run `bundle` or `seed`.
- **Translations don't update in dev**: the local Cache API serves the first value. Put
  `I18N_CACHE=off` in `.dev.vars`, restart the dev server, re-run `seed`.
- **`t` is untyped on a fresh clone**: `src/i18n.generated.d.ts` was not committed, or the CLI
  never ran. Run `npx edgekits-i18n bundle` and commit the generated files.
- **`Cannot find module 'cloudflare:workers'` / `KVNamespace` in `tsc`**: run `npx wrangler types`.
- **A Node-loaded module fails to import `@edgekits/astro-i18n/runtime`**: that entry is
  workerd-only. Use `localesOf(i18nConfig)` from `./config` and the helpers from `./format`.
- **Mixed-case locale (`pt-BR`) in a URL or folder**: use lowercase (`pt-br`); only
  `toIetfTag()` upper-cases the region, for `<html lang>` and hreflang.
- **`migrate` exited 1 after "KV is updated; the edge cache is not"**: the purge was skipped
  or failed (zone ID or token missing or malformed, the Purge API refused), or deleting the
  removed files' keys failed. KV is updated either way; fix it and run `migrate` again:
  `.i18n-hashes.json` was not written, so it retries the same deletions and purge.
- **`migrate` exited 0 but the site shows old copy**: the purge reached nothing (the zone is
  not proxied, or `keyPrefix` is a host outside it: `migrate` warns when the token can read the
  zone), or nothing changed against the baseline (after a `git revert` of translations the
  baseline is reverted too: run `migrate --purge-all`).
