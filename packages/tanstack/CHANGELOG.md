# Changelog

All notable changes to this package are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the package uses
[Semantic Versioning](https://semver.org/).

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
