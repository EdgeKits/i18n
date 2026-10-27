import fs from 'node:fs'

import { createJiti } from 'jiti'

import { defineI18nConfig, type I18nConfig } from '../types.ts'

export const CONFIG_FILE = 'edgekits-i18n.config.ts'

/**
 * Load the project's `edgekits-i18n.config.ts` from `configPath` (absolute) — the same
 * file its `astro.config` passes to the integration — and validate it.
 */
export async function loadI18nConfig(configPath: string): Promise<I18nConfig> {
  if (!fs.existsSync(configPath)) {
    console.error(`[i18n] Config file not found: ${configPath}`)
    process.exit(1)
  }

  const jiti = createJiti(import.meta.url)
  const config = await jiti.import<I18nConfig>(configPath, { default: true })

  return defineI18nConfig(config)
}
