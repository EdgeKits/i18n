import { i18n } from './instance'

/**
 * The translation KV key and edge-cache URL for this project: the core's builders
 * (`createI18n`), over the same `key-format.ts` the CLI uses for the KV bulk data and the
 * Purge API.
 *
 * Formats: <keyPrefix>:<namespace>:<locale> and
 * https://<keyPrefix>/<encodeURIComponent(i18n:v2:<locale>:<namespace>)>
 */
export const { buildTranslationKvKey, buildTranslationCacheUrl, buildTranslationCacheRequest } = i18n
