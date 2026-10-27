import { env, waitUntil } from 'cloudflare:workers'
import * as fallbacksModule from 'virtual:@edgekits/astro-i18n/fallbacks'
import * as runtimeConstants from 'virtual:@edgekits/astro-i18n/runtime-constants'
import { createI18n, parseBooleanFlag, type Bindings, type EdgeCache, type I18nBindings } from '@edgekits/i18n-core'

import { I18N_CONFIG } from './config'

// The bindings this module reads, typed by the package rather than the project's Env.
const i18nEnv = env as unknown as I18nBindings

/**
 * The platform as the core reads it. Getters: in Astro on Workers, `env` is valid only
 * inside a request, and the core reads each property at call time.
 *
 * Wrangler vars (wrangler.jsonc / wrangler.toml or .dev.vars; then `wrangler types` if
 * the project generates its Env), each "on" | "off" | "true" | "false" | "1" | "0":
 *   I18N_CACHE: the edge cache, on by default;
 *   DEBUG_I18N: the fetcher's debug log, off by default.
 */
const bindings: Bindings = {
  get kv() {
    return i18nEnv.TRANSLATIONS
  },
  get cache() {
    // `caches.default` only: absent (an untrusted Workers for Platforms namespace), the
    // core reads KV directly.
    const cacheStorage = caches as { default?: EdgeCache }
    return cacheStorage?.default ?? null
  },
  // Top-level waitUntil (cloudflare:workers): same semantics as ctx.waitUntil.
  waitUntil: (promise) => waitUntil(promise),
  get cacheEnabled() {
    return parseBooleanFlag(i18nEnv.I18N_CACHE, /* defaultValue */ true)
  },
  get debug() {
    return parseBooleanFlag(i18nEnv.DEBUG_I18N, /* defaultValue */ false)
  },
}

/**
 * The one engine instance of the project: the core's `createI18n` over the virtual config,
 * the generated modules (or the Vite plugin's stubs) and the Worker bindings.
 */
export const i18n = createI18n(I18N_CONFIG, { fallbacks: fallbacksModule, runtimeConstants }, bindings)
