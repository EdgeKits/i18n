---
name: tanstack-i18n
description: >-
  Adopt @edgekits/tanstack-i18n in a TanStack Start app on Cloudflare Workers (Cloudflare Vite
  plugin, a custom Hono src/worker.ts), sharing one translations folder and one KV namespace
  with the other Workers of the monorepo: a Hono locale middleware, a translations loader behind
  a server function the app declares, and a React provider with typed `useT`. Use when the user
  asks to "add i18n to the app", "add a namespace", "translate the admin", add a locale to a
  TanStack app, or works with `useT`, `I18nProvider` or the language switcher there.
---

# TanStack i18n (EdgeKits)

Adopts `@edgekits/tanstack-i18n` and builds on it. **The package README
(`node_modules/@edgekits/tanstack-i18n/README.md` after `npm i`) holds the code for every file
below: read it, follow it, do not restate it.** The CLI and the config are the core's
(`@edgekits/i18n-core` README).

## Mental model

- The same model as the Astro sites: translations are KV data (`<locale>/<namespace>` JSON),
  each namespace edge-cached under its own URL, the `edgekits-i18n` CLI generates the typed
  schema and pushes to KV; `migrate` purges only what changed.
- The locale comes from the request: lang cookie, then the user's saved preference
  (`userPreference`), then Accept-Language, then the default. Never from the URL.
- Translations reach a route through its loader, which calls a server function the APP
  declares (`createTranslationsLoader` + `isNamespaceList`); components read them with `useT`.
- The browser gets only the route's namespaces, in one locale; the engine and the compiled
  fallbacks stay on the server.

## A0. Ask first, and wait for the answers

Before writing any file, ask the questions the request has not answered, in one round, and
wait, in every mode. If asking is impossible, stop and print the open questions.

1. Which app or apps (each is a Worker with its own `wrangler.jsonc` and `src/worker.ts`)?
2. Where does the shared translations package live (`packages/i18n/` or an equivalent: the
   config, `locales/` and the generated files)? Does it exist yet?
3. Is there a source for the user's saved locale (an account setting)? What does it read (a
   session, a DB row), and is it available from the Request alone?
4. Which namespaces does each app need? Per-app names are dotted: `app.billing`,
   `admin.users`; shared ones stay plain (`common`).

## A1. Wire the app: follow the package README for the code

`npm i @edgekits/tanstack-i18n @edgekits/i18n-core` in the app. Then, by name:

1. `src/i18n/instance.ts`: `createI18n` over the shared config, the generated
   `fallbacks.generated` and `runtime-constants`, and the Worker bindings (`env.TRANSLATIONS`,
   `caches.default`, `waitUntil`), plus the `userPreference` hook if A0 named a source.
2. `src/worker.ts`: `app.use(i18nMiddleware(i18n, { userPreference }))` BEFORE the session and
   tenant middleware; `I18nVariables` added to the app's `Variables`. The last handler passes
   `c.req.raw` to TanStack unchanged (server functions live under the case-sensitive
   `/_serverFn/`).
3. `src/i18n/server.ts`: the app-declared server function: `createServerFn` whose validator
   rejects anything `isNamespaceList(i18n)` refuses, and whose handler is
   `load(getRequest(), data)`.
4. The root route: its loader fetches `common`; its component wraps the app in `I18nProvider`
   with `locale`, `translations`, `languages` (`localesOf(config).LANGUAGES`) and `cookie`
   (`config.cookie`).
5. A page: its loader fetches its own namespaces, an inner `I18nProvider` holds them, and
   components read them with `useT('<namespace>')`.

The switcher: `LanguageSwitcher` with `afterChange: () => router.invalidate()`, so loaders re-run
in place instead of a full reload. It is headless: classes come from the app.

Then bind `TRANSLATIONS` in the app's `wrangler.jsonc` (the same namespace as the other
Workers), seed (recipe below), build, and check one page in two locales by cookie.

## Recipes

### Run the CLI in a monorepo

From the repository root, always with both paths:

```sh
npx edgekits-i18n seed --config packages/i18n/edgekits-i18n.config.ts --wrangler apps/app/wrangler.jsonc
npx edgekits-i18n migrate --config packages/i18n/edgekits-i18n.config.ts --wrangler apps/app/wrangler.jsonc
```

`seed` writes the local KV of the app whose wrangler config it gets: seed once per app you run
locally. One `migrate` per change, with any one app's wrangler config: the KV namespace and the
purge zone are shared. Commit `.i18n-hashes.json` next to the config after each `migrate`.

### Add a namespace

1. Create `<localesDir>/<default>/<namespace>.json` in the shared folder (this types it), then
   the same file in each other locale.
2. `npx edgekits-i18n bundle --config … --wrangler …` (or `seed` to also fill local KV).
3. Request it in the route's loader (`getTranslations({ data: ['<namespace>'] })`), wrap the
   route in an `I18nProvider` with its `translations`, and read it with `useT('<namespace>')`.

### Add a locale

1. Add it to `languages` in the shared config (lowercase key, `name`), then
   `<localesDir>/<new>/` with its JSON.
2. Seed or migrate with both paths. The switcher shows it, since it reads `languages`; no
   component changes.

## Guardrails

- Namespaces from the browser go through `isNamespaceList` in the server function's validator;
  never pass a raw string from the client to `fetchTranslations` or a KV key.
- The server function lives in the app (`src/i18n/server.ts`), not in a shared package.
- No locale in URLs: no `/$lang` route segments, no redirects on the locale. The middleware sets
  no cookie; the switcher writes it.
- Do not copy engine code into the app; if the package lacks an export the app needs, say so
  instead of re-implementing it.
- The generated files (`i18n-data.json`, the `.d.ts`, `runtime-constants.ts`,
  `fallbacks.generated.ts`) are the CLI's: commit them, rerun the CLI after every JSON edit,
  never edit them by hand.
- Never import `instance.ts` from client code: only `server.ts` (inside the server function)
  and `src/worker.ts` reach it. The config and `localesOf` are client-safe.
- Secrets (`.dev.vars`, `.env*`, API tokens) never enter git; stage files by name.
