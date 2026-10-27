# Changelog

All notable changes to this package are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the package uses
[Semantic Versioning](https://semver.org/).

## 0.2.0 — 2026-10-27

First release, extracted from `@edgekits/astro-i18n` 0.1.8: the engine with no framework in it.

### Added

- `createI18n(config, generated, bindings)`: one instance per project. The platform bindings
  (KV, cache, `waitUntil`, the two flags) are arguments, read when a function runs, so getters
  over request-scoped values work. The instance carries the locale constants, the generated
  `NAMESPACE_KEYS`, the fetcher, the fallback cascade, the lang-cookie helpers over any
  `CookieJar` and the KV key and cache URL builders.
- No zod: locales are checked by `isLocale`/`parseLocale` against the config's `languages`.
- `routing` is optional and validated here, but read by the adapter (`'prefix'`,
  `'prefix-except-default'`).
- The fallback cascade takes a `userPreference` source between the cookie and
  Accept-Language.
- `localizedPath(locale, path, options)`: the path of a page in a locale for either routing
  mode.
- `fallbackIdentifier` and dotted namespace names: `app.billing.json` is the namespace
  `app.billing`, compiled as `FALLBACK_APP__BILLING`.
- CLI `edgekits-i18n`: `--config` and `--wrangler` name the config and the Worker's wrangler
  config (monorepos); the config's directory is the project root, the wrangler config's the
  Worker root.

### Fixed

- After a failed KV read the fetcher serves the compiled fallback and no longer writes it to
  the edge cache (it was cached immutable for a year under the requested locale's URL).

### Changed

- Config validation errors are prefixed `[@edgekits/i18n-core]` (they said
  `[@edgekits/astro-i18n]`).
