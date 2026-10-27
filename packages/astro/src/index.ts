// The config-time entry: what `astro.config` and `edgekits-i18n.config.ts` import.
// Pure under Node: nothing here reaches a virtual module or `cloudflare:workers`.
export { edgekitsI18n, type EdgekitsI18nOptions } from './integration/index.ts'
export {
  defineI18nConfig,
  type I18nBindings,
  type I18nConfig,
  type I18nLanguage,
  type I18nLocales,
  type Locale,
} from './types.ts'
