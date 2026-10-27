import type { AstroConfig, AstroIntegration } from 'astro'

import { DEFAULT_GENERATED_DIR, defineI18nConfig, type I18nConfig } from '../types.ts'
import { i18nVitePlugin } from './vite-plugin.ts'
import { virtualModulesDeclaration } from './virtual-types.ts'

export type EdgekitsI18nOptions = {
  // 'auto' registers the i18n middleware; 'manual' leaves it to the project, which
  // then imports `i18nMiddleware` and places it in its own sequence.
  middleware?: 'auto' | 'manual'
}

const MIDDLEWARE_MODES = ['auto', 'manual'] as const

export const PACKAGE_NAME = '@edgekits/astro-i18n'

/**
 * The Astro integration. Build time only: it runs in Node while Astro loads its
 * config, so it reaches the engine's runtime modules through nothing but the Vite
 * plugin's virtual modules.
 */
export function edgekitsI18n(config: I18nConfig, options: EdgekitsI18nOptions = {}): AstroIntegration {
  const i18nConfig = defineI18nConfig(config)
  const middleware = options.middleware ?? 'auto'

  if (!MIDDLEWARE_MODES.includes(middleware)) {
    throw new Error(
      `[@edgekits/astro-i18n] \`middleware\` "${String(middleware)}" is not supported; use 'auto' or 'manual'.`,
    )
  }

  return {
    name: '@edgekits/astro-i18n',
    hooks: {
      'astro:config:setup': ({ config: astroConfig, updateConfig, addMiddleware }) => {
        const generatedDir = new URL(
          `${trimSlashes(i18nConfig.generatedDir ?? DEFAULT_GENERATED_DIR)}/`,
          astroConfig.root,
        )

        // Astro sets `Astro.currentLocale` (read by `resolveLocale`) only with an `i18n`
        // block: set it when the project has none, check it when it has one.
        if (astroConfig.i18n) assertAstroI18n(astroConfig.i18n, i18nConfig)

        updateConfig({
          vite: {
            plugins: [i18nVitePlugin(i18nConfig, generatedDir)],
            // The runtime ships as source and imports the virtual modules above: Vite
            // must process it rather than hand it to Node as an external dependency.
            ssr: { noExternal: [PACKAGE_NAME] },
          },
          ...(astroConfig.i18n ? {} : { i18n: astroI18n(i18nConfig) }),
        })

        if (middleware === 'auto') {
          addMiddleware({ entrypoint: '@edgekits/astro-i18n/middleware', order: 'pre' })
        }
      },
      'astro:config:done': ({ injectTypes }) => {
        injectTypes({ filename: 'locales.d.ts', content: localesDeclaration(Object.keys(i18nConfig.languages)) })
        // The shipped runtime imports the virtual modules; a consumer's program needs their
        // declarations too. A separate file: these must not sit in a module (see virtual-types.ts).
        injectTypes({ filename: 'virtual-modules.d.ts', content: virtualModulesDeclaration(PACKAGE_NAME) })
      },
    },
  }
}

// Each entry that exports `I18nLocales` from its own declaration: the root entry's comes
// from dist/types.d.ts, the runtime entry's from the shipped source (src/types.ts).
const LOCALE_MODULES = ['@edgekits/astro-i18n', '@edgekits/astro-i18n/runtime']

/**
 * Augments `I18nLocales` with the configured locales, so `Locale` narrows from
 * `string` to their union in the project, through both entries. The `export {}` keeps
 * the file a module: without it `declare module` would replace the package's types
 * instead of merging.
 */
export function localesDeclaration(locales: readonly string[]): string {
  const members = locales.map((locale) => `    ${JSON.stringify(locale)}: true`)

  return [
    'export {}',
    ...LOCALE_MODULES.flatMap((specifier) => [
      '',
      `declare module '${specifier}' {`,
      '  interface I18nLocales {',
      ...members,
      '  }',
      '}',
    ]),
    '',
  ].join('\n')
}

/**
 * The Astro `i18n` block set when the project has none: locales and default from the
 * config; every URL locale-prefixed (the middleware redirects `/` itself, so Astro
 * does not). Complete, `fallbackType` included: Astro does not re-validate what
 * `updateConfig` merges, so its schema defaults never fill a partial block.
 */
export function astroI18n(config: I18nConfig): NonNullable<AstroConfig['i18n']> {
  return {
    locales: Object.keys(config.languages),
    defaultLocale: config.defaultLocale,
    routing: { prefixDefaultLocale: true, redirectToDefaultLocale: false, fallbackType: 'redirect' },
  }
}

/**
 * A project's own Astro `i18n` block must cover every configured locale (as a string
 * entry, a `path` or one of its `codes`) and share the default locale.
 */
function assertAstroI18n(block: NonNullable<AstroConfig['i18n']>, config: I18nConfig): void {
  const declared = new Set(
    block.locales.flatMap((entry) => (typeof entry === 'string' ? [entry] : [entry.path, ...entry.codes])),
  )
  const missing = Object.keys(config.languages).filter((locale) => !declared.has(locale))

  if (missing.length > 0) {
    throw new Error(
      `[@edgekits/astro-i18n] Astro \`i18n.locales\` is missing ${missing.join(', ')} from \`languages\`. ` +
        'Add them, or remove the `i18n` block from astro.config and the integration sets it for you.',
    )
  }
  if (block.defaultLocale !== config.defaultLocale) {
    throw new Error(
      `[@edgekits/astro-i18n] Astro \`i18n.defaultLocale\` "${block.defaultLocale}" differs from \`defaultLocale\` "${config.defaultLocale}". ` +
        'Make them equal, or remove the `i18n` block from astro.config and the integration sets it for you.',
    )
  }
}

function trimSlashes(path: string): string {
  return path.replace(/^\/+|\/+$/g, '')
}
