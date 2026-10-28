# Changelog

All notable changes to this package are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the package uses
[Semantic Versioning](https://semver.org/).

## 0.3.0 — 2026-10-28

### Upgrading from 0.2.x

- **Run the first `migrate` against production.** `.i18n-hashes.json` now holds one baseline per KV namespace id (`{ "<kvId>": { "<locale>:<ns>": "<hash>" } }`). An old flat file is adopted as the baseline of the first KV namespace a `migrate` writes, then rewritten in the new shape. Commit it as before.
- **The edge cache starts cold once.** Cache URLs carry the entry format (`https://<keyPrefix>/i18n:v2:<locale>:<ns>`, encoded); 0.2.x entries are never read again and expire on their own. Expect one KV read per namespace and data center right after the deploy.
- **`migrate` takes about a minute longer and can exit 1.** It purges, waits `--purge-delay` seconds (default 65) for KV to settle, and purges the same URLs again. It exits 1 when KV was updated but the edge cache was not purged (no `CLOUDFLARE_ZONE_ID` or token, or a failed purge); `.i18n-hashes.json` is then not written and the next run retries. A CI step that passed without purge credentials now fails.
- **Regenerate and commit the generated files** (`npx edgekits-i18n bundle --fallbacks`, or `seed`). `I18n.Schema` types numbers and booleans as such and a list of objects as the union of its shapes. A `null` value and a namespace named `locale` are rejected. Hashes of namespaces with mixed-case keys change once (code-point key order), so the first `migrate` purges those namespaces too.
- **`keyPrefix` must be a plain lower-case host** (`example.com`, `my-site`): no scheme, path, port syntax, space or upper case. `defineI18nConfig` throws otherwise.
- **Node `>=22.23.4`.**

### Changed

- The fetcher caches the raw KV value of each namespace, never the merged namespace, and merges the current compiled fallback on every read; a key KV does not have is cached as a `null` marker with `s-maxage=60`; cache URLs are `https://<keyPrefix>/<encodeURIComponent(i18n:v2:<locale>:<ns>)>`.
- KV bulk reads take at most 100 keys at a time, in parallel; a failing read falls back for its own namespaces only.
- `migrate` purges twice, `--purge-delay` seconds apart (default 65), writes `.i18n-hashes.json` only after both, and exits 1 when the purge was skipped or failed.
- `.i18n-hashes.json` holds one baseline per KV namespace id; the old flat shape is read and rewritten.
- `seed` writes the `TRANSLATIONS` binding's `preview_id` when it has one (what `wrangler dev` reads); `migrate` writes its `id`.
- `I18n.Schema` types numbers and booleans as such, and a list of objects as the union of its element shapes.
- Content hashes sort keys by code point (the same on every machine) instead of `localeCompare`.
- `localizedPath` keeps a file path without a trailing slash and keeps a `?query`/`#hash`; `toIetfTag` cases each subtag by length; `plural` interpolates both forms.
- `engines.node` `>=22.23.4`.

### Added

- CLI `--purge-delay <seconds>` and `--env <name>` (the binding and `CLOUDFLARE_ZONE_ID` from `env.<name>`; wrangler gets `--env`); without `--env`, a warning when an environment binds `TRANSLATIONS` to another id.
- `migrate` deletes the KV keys of translation files removed since the last run (`wrangler kv bulk delete`) and purges their URLs.
- Warnings for a namespace only non-default locales have, keys the default locale lacks, and JSON files in subfolders of a locale folder.
- `isFilePath`, from the root and `./format`.

### Fixed

- `.dev.vars` is read with dotenv syntax (`util.parseEnv`: quotes, `export `, inline `#` comments).
- A translation file with a BOM is read; an empty or invalid one stops the run naming `<localesDir>/<locale>/<file>`.
- A namespace named `locale` is rejected (its fallback collided with `FALLBACK_LOCALE`); a `null` value is rejected with its key path.
- `defineI18nConfig` rejects a `keyPrefix` that is not a URL host as written.
- A translated value under a `constructor` or `prototype` key was dropped by the fallback merge.

## 0.2.2 — 2026-10-27

No changes; released in lockstep.

## 0.2.1 — 2026-10-27

No changes; released in lockstep with the plugin rename (see `@edgekits/astro-i18n` 0.2.1).

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
