# Changelog

All notable changes to this package are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the package uses
[Semantic Versioning](https://semver.org/).

## 0.3.0 — 2026-10-28

### Upgrading from 0.2.x

- **`.i18n-hashes.json` changes shape.** It now holds one baseline per KV namespace id (`{ "<kvId>": { "<locale>:<ns>": "<hash>" } }`). An old flat file is the baseline of the top-level `TRANSLATIONS` id (what 0.2.x wrote), whichever environment migrates first, and is rewritten in the new shape. Commit it as before.
- **The edge cache starts cold once.** Cache URLs carry the entry format (`https://<keyPrefix>/i18n:v2:<locale>:<ns>`, encoded); 0.2.x entries are never read again and expire on their own. Expect one KV read per namespace and data center right after the deploy.
- **`migrate` takes about a minute longer and can exit 1.** It purges, waits `--purge-delay` seconds (default 65) for KV to settle, and purges the same URLs again. It exits 1 when KV was updated but the edge cache was not purged (no `CLOUDFLARE_ZONE_ID` or token, or a failed purge); `.i18n-hashes.json` is then not written and the next run retries. A CI step that passed without purge credentials now fails.
- **Regenerate and commit the generated files** (`npx edgekits-i18n bundle --fallbacks`, or `seed`). `I18n.Schema` types numbers and booleans as such and a list of objects as one merged object type (a key every element has is required, any other optional, a key of differing types a union); a list that mixes strings and objects stops the run. A `null` value and a namespace named `locale` are rejected. Hashes of namespaces with mixed-case keys change once (code-point key order), so the first `migrate` purges those namespaces too.
- **`keyPrefix` must be a plain lower-case host** (`example.com`, `my-site`): no scheme, path, port syntax, space or upper case. `defineI18nConfig` throws otherwise.
- **The CLI is stricter.** An unknown argument (`-e staging`) exits 1 naming it; `--purge-delay` is at most 600; `CLOUDFLARE_ZONE_ID` must be 32 hex characters. With `--env <name>`, `.dev.vars.<name>` replaces `.dev.vars` when it exists, as in wrangler. `migrate` compares only the baseline of the KV namespace it writes with the committed file, so `migrate --env staging && migrate` runs in one job.
- **Node `>=22.23.4`.**

### Changed

- The fetcher caches the raw KV value of each namespace, never the merged namespace, marks each entry `X-EdgeKits-I18n: v2` (a response at the URL without it is a miss), and merges the current compiled fallback on every read; a key KV does not have is cached as a `null` marker with `s-maxage=60`; cache URLs are `https://<keyPrefix>/<encodeURIComponent(i18n:v2:<locale>:<ns>)>`.
- KV bulk reads take at most 100 keys at a time, in parallel; a failing read falls back for its own namespaces only.
- `migrate` purges twice, `--purge-delay` seconds apart (default 65), writes `.i18n-hashes.json` only after both, and exits 1 when the purge was skipped or failed.
- `.i18n-hashes.json` holds one baseline per KV namespace id; the old flat shape is the top-level id's baseline, read and rewritten. `migrate` refuses to run only while that KV namespace's baseline differs from the committed file (`HEAD`).
- `seed` writes the `TRANSLATIONS` binding's `preview_id` when it has one (what `wrangler dev` reads); `migrate` writes its `id`.
- `I18n.Schema` types numbers and booleans as such, and a list of objects as one object type merged from its elements.
- Content hashes sort keys by code point (the same on every machine) instead of `localeCompare`; locales and namespaces are read in code point order.
- CLI arguments are checked: anything but the command, `--fallbacks`, `--purge-all`, `--help` and the value flags exits 1; `--purge-delay` is at most 600; `CLOUDFLARE_ZONE_ID` must be 32 hex characters.
- With `--env <name>`, `migrate` reads `.dev.vars.<name>` instead of `.dev.vars` when it exists.
- `localizedPath` keeps a file path without a trailing slash and keeps a `?query`/`#hash`; `toIetfTag` cases each subtag by length; `plural` interpolates both forms.
- `engines.node` `>=22.23.4`.

### Added

- CLI `--purge-delay <seconds>` and `--env <name>` (the binding and `CLOUDFLARE_ZONE_ID` from `env.<name>`; wrangler gets `--env`); without `--env`, a warning when an environment binds `TRANSLATIONS` to another id.
- `migrate` deletes the KV keys of translation files removed since the last run (`wrangler kv bulk delete`) and purges their URLs.
- Warnings for a namespace only non-default locales have, keys the default locale lacks, and JSON files in subfolders of a locale folder.
- `isFilePath`, from the root and `./format`.
- `migrate --purge-all`: purge every namespace's URLs whatever the baseline says (after a `git revert` of translations).
- A warning when two wrangler environments put different `TRANSLATIONS` namespaces on one `CLOUDFLARE_ZONE_ID` (they share cache URLs under one `keyPrefix`).

### Fixed

- `.dev.vars` is read with dotenv syntax (`util.parseEnv`: quotes, `export `, inline `#` comments).
- A translation file with a BOM is read; an empty or invalid one stops the run naming `<localesDir>/<locale>/<file>`.
- A namespace named `locale` is rejected (its fallback collided with `FALLBACK_LOCALE`); a `null` value is rejected with its key path.
- `defineI18nConfig` rejects a `keyPrefix` that is not a URL host as written.
- A translated value under a `constructor` or `prototype` key was dropped by the fallback merge.
- A namespace a page mutated changed the compiled fallback for every later request in the isolate; each call now returns its own copy (`structuredClone`).
- `cache.put` got a clone of the entry's Response, and the original was never read.
- `localizedPath` treats `\` as a segment separator and drops tabs and newlines, as the URL parser does: a decoded `/\evil.com/` gives `/evil.com/`, never a protocol-relative path.
- `migrate --env staging` on a 0.2.x flat baseline read it as staging's and dropped it, so production never deleted its removed keys.

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
