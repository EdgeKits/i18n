/**
 * The declarations of the three `virtual:@edgekits/astro-i18n/*` modules, in one place
 * for both programs that need them:
 *   - the package's own typecheck, through `src/virtual.d.ts` (`typesModule` './types');
 *     test/virtual-types.test.ts fails when that file stops matching this text;
 *   - the consumer's, through the `virtual-modules.d.ts` the integration injects
 *     (`typesModule` the package name), because a consumer's program never loads
 *     `src/virtual.d.ts` from node_modules but does import the shipped `src/` files.
 *
 * The text has no top-level import or export on purpose: in a module file,
 * `declare module 'virtual:…'` would augment a module that does not exist instead of
 * declaring one. (The injected `locales.d.ts` is a module, so it cannot carry these.)
 */
export function virtualModulesDeclaration(typesModule: string): string {
  return `declare module 'virtual:@edgekits/astro-i18n/config' {
  const config: import('${typesModule}').I18nConfig
  export default config
}

// The consumer's \`<generatedDir>/runtime-constants.ts\`, or a stub with empty lists.
declare module 'virtual:@edgekits/astro-i18n/runtime-constants' {
  export const NAMESPACE_KEYS: readonly string[]
  export const LOCALES_WITH_TRANSLATIONS: readonly string[]
  export const FULLY_TRANSLATED_LOCALES: readonly string[]
}

// The consumer's \`<generatedDir>/fallbacks.generated.ts\`, or an empty stub. Its exports
// (\`FALLBACK_<NAMESPACE>\`) depend on the project's namespaces, so none are declared here:
// the fetcher reads the module namespace by name.
declare module 'virtual:@edgekits/astro-i18n/fallbacks' {
  export {}
}
`
}
