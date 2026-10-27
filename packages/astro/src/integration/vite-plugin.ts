import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { AstroConfig } from 'astro'

import type { I18nConfig } from '../types.ts'

type VitePlugin = NonNullable<NonNullable<AstroConfig['vite']>['plugins']>[number]

export const CONFIG_ID = 'virtual:@edgekits/astro-i18n/config'
export const FALLBACKS_ID = 'virtual:@edgekits/astro-i18n/fallbacks'
export const RUNTIME_CONSTANTS_ID = 'virtual:@edgekits/astro-i18n/runtime-constants'

// Rollup convention: a `\0` prefix marks a resolved id as virtual, so no other plugin
// tries to read it from disk.
const resolved = (id: string) => `\0${id}`

const STUBS: Record<string, string> = {
  [FALLBACKS_ID]: 'export {}\n',
  [RUNTIME_CONSTANTS_ID]: [
    'export const NAMESPACE_KEYS = []',
    'export const LOCALES_WITH_TRANSLATIONS = []',
    'export const FULLY_TRANSLATED_LOCALES = []',
    '',
  ].join('\n'),
}

/**
 * Serves the three virtual modules the engine imports:
 *   - the config, serialised as JSON;
 *   - the project's generated `fallbacks.generated.ts` and `runtime-constants.ts` under
 *     `generatedDir`, or a stub module when the file does not exist (yet).
 *
 * The file check runs on every resolve, so files the CLI generates while the dev
 * server runs are picked up on the next resolve.
 */
export function i18nVitePlugin(config: I18nConfig, generatedDir: URL): VitePlugin {
  const generatedFiles: Record<string, string> = {
    [FALLBACKS_ID]: toPath(new URL('fallbacks.generated.ts', generatedDir)),
    [RUNTIME_CONSTANTS_ID]: toPath(new URL('runtime-constants.ts', generatedDir)),
  }

  return {
    name: '@edgekits/astro-i18n',
    resolveId(id: string) {
      if (id === CONFIG_ID) return resolved(id)

      const file = generatedFiles[id]
      if (file === undefined) return undefined

      return existsSync(file) ? file : resolved(id)
    },
    load(id: string) {
      if (id === resolved(CONFIG_ID)) return `export default ${JSON.stringify(config)}\n`

      for (const [virtualId, stub] of Object.entries(STUBS)) {
        if (id === resolved(virtualId)) return stub
      }

      return undefined
    },
  }
}

// Vite ids use forward slashes on every platform.
function toPath(url: URL): string {
  return fileURLToPath(url).replace(/\\/g, '/')
}
