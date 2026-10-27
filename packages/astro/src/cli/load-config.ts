import fs from 'node:fs'
import path from 'node:path'

import { createJiti } from 'jiti'

import { defineI18nConfig, type I18nConfig } from '../types.ts'

export const CONFIG_FILE = 'edgekits-i18n.config.ts'

/**
 * Load the project's `edgekits-i18n.config.ts` from `root` — the same file its
 * `astro.config` passes to the integration — and validate it.
 */
export async function loadI18nConfig(root: string): Promise<I18nConfig> {
  const configPath = path.join(root, CONFIG_FILE)

  if (!fs.existsSync(configPath)) {
    console.error(`[i18n] ${CONFIG_FILE} not found in ${root}`)
    process.exit(1)
  }

  const jiti = createJiti(import.meta.url)
  const config = await jiti.import<I18nConfig>(configPath, { default: true })

  return defineI18nConfig(config)
}
