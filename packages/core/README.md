# @edgekits/i18n-core

The EdgeKits edge-native i18n engine, free of any framework. Translations live as data in
Workers KV, one JSON value per locale and namespace; each namespace's KV value is cached at the
edge under its own URL (merged with the compiled fallback on every read) and purged through the
Cloudflare Purge API only when its content changed; a namespace KV does not have is cached as
missing for 60 seconds; the default locale's JSON files define a typed schema. After a KV error the compiled fallback is
served and not cached, so the next request reads KV again. This package holds the config validation,
the fetcher, locale resolution, the lang cookie, the format helpers and the `edgekits-i18n`
CLI. A framework adapter builds on it: for Astro, use
[`@edgekits/astro-i18n`](https://github.com/EdgeKits/i18n/tree/main/packages/astro#readme),
which depends on this package and needs nothing else from you.

## `createI18n`

One instance per project: your config, the CLI's generated modules, and the platform bindings.
Every binding is read when a function runs, never when the instance is created, so getters over
request-scoped values work.

```ts
import { env, waitUntil } from 'cloudflare:workers'
import { createI18n, parseBooleanFlag } from '@edgekits/i18n-core'

import config from '../edgekits-i18n.config'
import * as fallbacks from './i18n/fallbacks.generated'
import * as runtimeConstants from './i18n/runtime-constants'

export const i18n = createI18n(
  config,
  { fallbacks, runtimeConstants },
  {
    get kv() {
      return env.TRANSLATIONS
    },
    get cache() {
      return caches.default ?? null
    },
    waitUntil,
    get cacheEnabled() {
      return parseBooleanFlag(env.I18N_CACHE, true)
    },
    get debug() {
      return parseBooleanFlag(env.DEBUG_I18N, false)
    },
  },
)

export default {
  async fetch(request: Request): Promise<Response> {
    // Inside a request, never at module scope: on Workers, `env` and the edge cache belong
    // to the request.
    const { common } = await i18n.fetchTranslations('de', ['common'])
    return Response.json(common)
  },
}
```

The edge cache URL's host is `keyPrefix` (`https://<keyPrefix>/…`) and the cache is per zone: two
Workers on one zone that read different KV namespaces (production and staging, say) need
different `keyPrefix` values, or each serves the other's cached translations.

The instance also carries the locale constants (`DEFAULT_LOCALE`, `SUPPORTED_LOCALES`, `NAMESPACE_KEYS`,
`LANGUAGES`), `isLocale`/`parseLocale`, the fallback cascade (`resolveFallbackLocale`), the
lang-cookie helpers over any `CookieJar`, and the KV key and cache URL builders the CLI shares.
`routing` in the config is validated here but read by the adapter.

The pure helpers are exported from the root and from `./format` (Node-safe): `fmt`, `plural`,
`pluralIcu`, `toIetfTag`, and `localizedPath`, the path of a page in a locale for either
routing mode (a leading locale segment is stripped first; the result ends in a slash):

```ts
import { localizedPath } from '@edgekits/i18n-core/format'

const options = { routing: 'prefix-except-default', defaultLocale: 'en', isLocale: (s: string) => ['en', 'de'].includes(s) } as const

localizedPath('de', '/about/', options) // '/de/about/'
localizedPath('en', '/de/about/', options) // '/about/'
localizedPath('en', '/de/about/', { ...options, routing: 'prefix' }) // '/en/about/'
```

## CLI

The `edgekits-i18n` command is this package's. It reads `edgekits-i18n.config.ts` and
`wrangler.jsonc` from the directory it runs in, unless two flags name them:

```sh
npx edgekits-i18n seed
```

| Flag                | Default                     | What comes from it                                                                                                                                              |
| ------------------- | --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--config <path>`   | `./edgekits-i18n.config.ts` | The config. Its directory is the project root: `localesDir`, `generatedDir`, `i18n-data.json`, `src/i18n.generated.d.ts` and `.i18n-hashes.json` resolve there. |
| `--wrangler <path>` | `./wrangler.jsonc`          | The `TRANSLATIONS` KV id and the `CLOUDFLARE_ZONE_ID` var. Its directory is the Worker root: `.dev.vars` and the project's wrangler are found there.            |

Both paths resolve against the current directory, and a flag may come before or after the
command. The CLI always runs wrangler with `--config` set to that file, from its directory, so
local KV state lands in the `.wrangler/state/` that `wrangler dev` there reads.

| Command                            | Writes                                                                                                              | Then                                                                                                   |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `edgekits-i18n bundle`             | `i18n-data.json` (the KV payload), `src/i18n.generated.d.ts` (the schema), `<generatedDir>/runtime-constants.ts`    | nothing else                                                                                           |
| `edgekits-i18n bundle --fallbacks` | the above and `<generatedDir>/fallbacks.generated.ts` (the default locale compiled in, served if KV is unreachable) | nothing else                                                                                           |
| `edgekits-i18n seed`               | the same as `bundle --fallbacks`                                                                                    | pushes every value to local KV (`wrangler kv bulk put --local`)                                        |
| `edgekits-i18n migrate`            | the same as `bundle --fallbacks`                                                                                    | pushes to production KV, purges the changed namespaces' edge-cache entries, writes `.i18n-hashes.json` |

The generated files are ordinary project files: commit them, and run the CLI again after you
edit a JSON file.

A namespace is the file name under `<localesDir>/<locale>/`: segments of lowercase letters,
digits and underscores, joined by single dots, so `locales/en/app.billing.json` is the
namespace `app.billing`. Its compiled fallback is `FALLBACK_APP__BILLING` (dots become `__`),
so `app.billing` and `app__billing` cannot both exist; the KV key and cache URL keep the dot.

`.i18n-hashes.json` holds one content hash per namespace and locale as of the last successful
`migrate`; the next `migrate` purges exactly the entries whose hash changed. Rules:

- Only `migrate` writes it, and only after the purge succeeded (or nothing changed). `seed`
  never touches it: local KV is not production.
- Commit it after every `migrate`. It is the record of what production holds.
- `migrate` refuses to run while the file has uncommitted changes, since a wrong baseline would
  skip purges silently. When that git check cannot run (no `git` on the PATH, or not a git work
  tree), `migrate` warns and proceeds without the purge-baseline check.

`migrate` reads the zone ID from `CLOUDFLARE_ZONE_ID` (a var in `wrangler.jsonc` or the
environment) and the token from `CLOUDFLARE_CACHEPURGE_API_TOKEN` (the environment or
`.dev.vars`). Without either, it still pushes to KV but skips the purge and leaves
`.i18n-hashes.json` alone, so the next run retries.

### Monorepo: one translations folder, several Workers

```text
packages/i18n/        edgekits-i18n.config.ts, locales/, the generated files, .i18n-hashes.json
apps/app/             wrangler.jsonc (+ .dev.vars)
apps/admin/           wrangler.jsonc (+ .dev.vars)
```

- `packages/i18n/` holds the config, `locales/` and the generated files; each app imports them
  from there.
- Every app's `wrangler.jsonc` binds the same `TRANSLATIONS` namespace and sets the same
  `CLOUDFLARE_ZONE_ID`.
- Run one `migrate` per change, from the repository root, with any one app's wrangler config:

  ```sh
  npx edgekits-i18n migrate --config packages/i18n/edgekits-i18n.config.ts --wrangler apps/app/wrangler.jsonc
  ```

  It pushes once to the shared namespace and purges once: the cache URLs live on the zone, so
  the purge reaches every host on it.

- `.i18n-hashes.json` lives next to the config; commit it there.
- `seed` takes the same flags. Local KV state belongs to the app whose wrangler config you pass,
  so seed once per app you run `wrangler dev` in.

## License

MIT © Gary Stupak. See [LICENSE](LICENSE).
