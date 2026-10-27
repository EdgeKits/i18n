// `@edgekits/tanstack-i18n/react`: the provider a route's loader data feeds, the hooks over
// it and the headless language switcher. Client-safe: nothing here reaches KV.
export {
  I18nProvider,
  useI18n,
  useT,
  type I18nCookie,
  type I18nLanguages,
  type I18nProviderProps,
  type NamespaceTranslations,
} from './provider.tsx'
export { LanguageSwitcher, type LanguageSwitcherProps } from './language-switcher.tsx'
