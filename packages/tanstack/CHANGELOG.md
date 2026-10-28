# Changelog

All notable changes to this package are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the package uses
[Semantic Versioning](https://semver.org/).

## 0.3.0 — 2026-10-28

### Upgrading from 0.2.x

- **The loader returns `{ locale, translationLocale, translations }`.** `locale` is the UI locale (`<html lang>`, the provider); the translations are read in `translationLocale` (the default locale for a locale without translations). A `LoaderI18n` you build yourself needs `resolveLocaleForTranslations`.
- **A throwing or rejecting `userPreference` no longer fails the request:** it counts as no preference and logs a `console.warn`; pass `onUserPreferenceError` to report it your way.
- **The switcher writes `Secure` only on https**, so the lang cookie works on `http://localhost`.
- **`.i18n-hashes.json` changes shape.** It now holds one baseline per KV namespace id (`{ "<kvId>": { "<locale>:<ns>": "<hash>" } }`). An old flat file is the baseline of the top-level `TRANSLATIONS` id (what 0.2.x wrote), whichever environment migrates first, and is rewritten in the new shape. Commit it as before.
- **The edge cache starts cold once.** Cache URLs carry the entry format (`https://<keyPrefix>/i18n:v2:<locale>:<ns>`, encoded); 0.2.x entries are never read again and expire on their own. Expect one KV read per namespace and data center right after the deploy.
- **`migrate` takes about a minute longer and can exit 1.** It purges, waits `--purge-delay` seconds (default 65) for KV to settle, and purges the same URLs again. It exits 1 when KV was updated but the edge cache was not purged (no `CLOUDFLARE_ZONE_ID` or token, or a failed purge); `.i18n-hashes.json` is then not written and the next run retries. A CI step that passed without purge credentials now fails.
- **Regenerate and commit the generated files** (`npx edgekits-i18n bundle --fallbacks`, or `seed`). `I18n.Schema` types numbers and booleans as such and a list of objects as one merged object type (a key every element has is required, any other optional, a key of differing types a union); a list that mixes strings and objects stops the run. A `null` value and a namespace named `locale` are rejected. Hashes of namespaces with mixed-case keys change once (code-point key order), so the first `migrate` purges those namespaces too.
- **`keyPrefix` must be a plain lower-case host** (`example.com`, `my-site`): no scheme, path, port syntax, space or upper case. `defineI18nConfig` throws otherwise.
- **The CLI is stricter.** An unknown argument (`-e staging`) exits 1 naming it; `--purge-delay` is at most 600; `CLOUDFLARE_ZONE_ID` must be 32 hex characters. With `--env <name>`, `.dev.vars.<name>` replaces `.dev.vars` when it exists, as in wrangler. `migrate` compares only the baseline of the KV namespace it writes with the committed file, so `migrate --env staging && migrate` runs in one job.
- **Node `>=22.23.4`.**

### Changed

- The loader fetches in `i18n.resolveLocaleForTranslations(locale)` and returns `translationLocale` beside `locale` and `translations`.
- A `userPreference` that throws or rejects falls through to Accept-Language.
- `userPreference` runs once per Request: the middleware and every loader of the request share its answer, and a failure is reported once.
- `i18nMiddleware` adds `Vary: Cookie, Accept-Language` to every HTML response (merged with its own `Vary`).
- `LanguageSwitcher` writes `Secure` only when `location.protocol` is `https:`.
- `engines.node` `>=22.23.4`; built on `@edgekits/i18n-core` 0.3.0 (raw KV values in the edge cache, the CLI changes above).

### Added

- `onUserPreferenceError(error, request)` on `RequestLocaleOptions`; absent, one `console.warn` per failure, whatever `DEBUG_I18N` says.

## 0.2.2 — 2026-10-27

No changes; released in lockstep.

## 0.2.1 — 2026-10-27

No changes; released in lockstep with the plugin rename (see `@edgekits/astro-i18n` 0.2.1).

## 0.2.0 — 2026-10-27

First release, over `@edgekits/i18n-core` 0.2.0, for TanStack Start on a Hono Worker:

- `i18nMiddleware`: sets `c.var.locale` from the cookie, `userPreference`, Accept-Language, the default; never sets a cookie or redirects.
- `createTranslationsLoader`: the body of the app's own server function, the same cascade plus `fetchTranslations`; drops repeated namespaces.
- `isNamespaceList`: the validator for the namespace list from the browser: known names only, no repeats, non-empty, at most the generated count.
- `./react`: `I18nProvider` (nesting, inner namespaces merged over outer), `useI18n`, `useT` typed from the schema.
- `LanguageSwitcher`: headless, writes the lang cookie, then `afterChange` (e.g. `router.invalidate()`) or a reload.
