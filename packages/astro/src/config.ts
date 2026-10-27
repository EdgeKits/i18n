import config from 'virtual:@edgekits/astro-i18n/config'

/**
 * The project values the i18n engine uses, in one place.
 *
 * Contract: this is the ONLY file in `src/` that reads the config, and it reads it
 * from the virtual module the integration's Vite plugin serves (`test/i18n-boundary.test.ts`
 * enforces it). The rest of the engine reads these values through `constants.ts` and
 * `translations-keys.ts`.
 */
export const I18N_CONFIG = config
