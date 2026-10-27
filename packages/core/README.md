# @edgekits/i18n-core

The EdgeKits edge-native i18n engine, free of any framework. Translations live as data in
Workers KV, one JSON value per locale and namespace; each namespace is cached at the edge under
its own URL and purged through the Cloudflare Purge API only when its content changed; the
default locale's JSON files define a typed schema. This package holds the config validation,
the fetcher, locale resolution, the lang cookie, the format helpers and the `edgekits-i18n`
CLI. A framework adapter builds on it: for Astro, use
[`@edgekits/astro-i18n`](https://github.com/EdgeKits/astro-i18n/tree/main/packages/astro#readme),
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

const { common } = await i18n.fetchTranslations('de', ['common'])
```

The instance also carries the locale constants (`DEFAULT_LOCALE`, `SUPPORTED_LOCALES`,
`LANGUAGES`), `isLocale`/`parseLocale`, the fallback cascade (`resolveFallbackLocale`), the
lang-cookie helpers over any `CookieJar`, and the KV key and cache URL builders the CLI shares.
`routing` in the config is validated here but read by the adapter.

## CLI

The `edgekits-i18n` command is this package's. It reads `edgekits-i18n.config.ts` from the
directory it runs in.

```sh
npx edgekits-i18n seed
```

| Command                            | Writes                                                                                                              | Then                                                                                                   |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `edgekits-i18n bundle`             | `i18n-data.json` (the KV payload), `src/i18n.generated.d.ts` (the schema), `<generatedDir>/runtime-constants.ts`    | nothing else                                                                                           |
| `edgekits-i18n bundle --fallbacks` | the above and `<generatedDir>/fallbacks.generated.ts` (the default locale compiled in, served if KV is unreachable) | nothing else                                                                                           |
| `edgekits-i18n seed`               | the same as `bundle --fallbacks`                                                                                    | pushes every value to local KV (`wrangler kv bulk put --local`)                                        |
| `edgekits-i18n migrate`            | the same as `bundle --fallbacks`                                                                                    | pushes to production KV, purges the changed namespaces' edge-cache entries, writes `.i18n-hashes.json` |

The generated files are ordinary project files: commit them, and run the CLI again after you
edit a JSON file.

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

## License

MIT © Gary Stupak. See [LICENSE](LICENSE).
