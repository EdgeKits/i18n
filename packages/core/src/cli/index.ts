#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

import { DEFAULT_GENERATED_DIR, DEFAULT_LOCALES_DIR, type I18nConfig } from '../types.ts'
import {
  assertValidNames,
  buildBulkData,
  buildFallbacksContent,
  buildRuntimeConstantsContent,
  buildTypesContent,
  localesWithTranslations,
  schemaSourceLocale,
  type CollectedData,
  type TranslationTree,
} from './generate.ts'
import { diffHashes, purgeUrlsFor, type HashMap } from './hashes.ts'
import { CONFIG_FILE, loadI18nConfig } from './load-config.ts'
import { purgeTranslationsCache } from './purge.ts'
import { getKvNamespaceId, getWranglerVar, KV_BINDING, resolveWranglerBin } from './wrangler.ts'
import { checkKeyPrefixZone } from './zone.ts'

const HELP = `Usage: edgekits-i18n <command> [--fallbacks]

Reads ${CONFIG_FILE} and <localesDir>/<locale>/<namespace>.json from the current directory.

Commands:
  bundle    Write i18n-data.json, src/i18n.generated.d.ts and <generatedDir>/runtime-constants.ts.
            No side effects. --fallbacks also writes <generatedDir>/fallbacks.generated.ts.
  seed      bundle + fallbacks, then push to LOCAL KV (wrangler --local).
            .i18n-hashes.json is left untouched: it records production, not local KV.
  migrate   bundle + fallbacks, then push to production KV, purge the changed edge-cache
            entries, and write .i18n-hashes.json. Refuses to run while .i18n-hashes.json
            has uncommitted changes.
`

const COMMANDS = ['bundle', 'seed', 'migrate'] as const
type Command = (typeof COMMANDS)[number]

const ROOT = process.cwd()

// Fixed outputs at the project root.
const OUTPUT_DATA = path.join(ROOT, 'i18n-data.json')
const OUTPUT_TYPES = path.join(ROOT, 'src', 'i18n.generated.d.ts')

// Stores per-namespace content hashes from the last production migrate.
// Used to detect which namespaces actually changed and need cache purging.
// TRACKED in git: the committed copy is the production purge baseline.
// Absence means "first run", all namespaces treated as changed.
const HASHES_FILE = path.join(ROOT, '.i18n-hashes.json')

const KV_NAMESPACE_ID = /^[0-9a-f]{32}$/i

await main(process.argv.slice(2))

async function main(args: string[]): Promise<void> {
  const command = args.find((arg) => !arg.startsWith('-'))

  if (!command || args.includes('--help') || args.includes('-h')) {
    console.log(HELP)
    return
  }

  if (!(COMMANDS as readonly string[]).includes(command)) {
    console.error(`[i18n] Unknown command "${command}".\n`)
    console.error(HELP)
    process.exit(1)
  }

  await run(command as Command, args)
}

async function run(command: Command, args: string[]): Promise<void> {
  const shouldDeploy = command !== 'bundle'
  const isLocal = command === 'seed'
  const shouldGenerateFallbacks =
    shouldDeploy || args.includes('--fallbacks') || process.env.I18N_GENERATE_FALLBACKS === 'true'

  if (command === 'migrate') {
    assertCleanPurgeBaseline()
  }

  const config = await loadI18nConfig(ROOT)
  const defaultLocale = config.defaultLocale
  const localesDir = path.join(ROOT, config.localesDir ?? DEFAULT_LOCALES_DIR)
  const generatedDir = path.join(ROOT, config.generatedDir ?? DEFAULT_GENERATED_DIR)
  const outputRuntimeConstants = path.join(generatedDir, 'runtime-constants.ts')
  const outputFallbacks = path.join(generatedDir, 'fallbacks.generated.ts')

  // Read before writing anything, so a missing binding fails the run up front.
  const kvId = shouldDeploy ? getKvNamespaceId(ROOT, KV_BINDING) : undefined

  // The id becomes a command-line argument (deploy()); only a real namespace id's shape
  // may get there.
  if (kvId !== undefined && !KV_NAMESPACE_ID.test(kvId)) {
    console.error(
      `[i18n] The ${KV_BINDING} id in wrangler.jsonc, "${kvId}", is not a KV namespace id (32 hex characters).`,
    )
    process.exit(1)
  }

  // The project's wrangler, found before anything is written.
  let wranglerBin: string | undefined
  if (shouldDeploy) {
    try {
      wranglerBin = resolveWranglerBin(ROOT)
    } catch (err) {
      console.error(`[i18n] ${err instanceof Error ? err.message : String(err)}`)
      process.exit(1)
    }
  }

  // -------------------------------------------------------------------------
  // 1. Collect translations from <localesDir>/<locale>/<namespace>.json
  // -------------------------------------------------------------------------

  const collected = collectTranslations(localesDir)

  // The schema is built here too, so an untypeable value (a mixed array) stops the run
  // before anything is written.
  let typesContent: string
  try {
    assertValidNames(collected, config.languages)
    typesContent = buildTypesContent(collected, defaultLocale)
  } catch (err) {
    console.error(`[i18n] ${err instanceof Error ? err.message : String(err)}`)
    process.exit(1)
  }

  const locales = localesWithTranslations(collected)

  if (locales.length === 0) {
    console.warn(`[i18n] No locales with JSON files found in ${localesDir}. Generating empty artifacts.`)
  }

  // -------------------------------------------------------------------------
  // 2. Compute per-namespace content hashes and detect changes
  // -------------------------------------------------------------------------

  // Load previous hashes (absent on first run — all namespaces treated as new)
  const previousHashes: HashMap = fs.existsSync(HASHES_FILE)
    ? (JSON.parse(fs.readFileSync(HASHES_FILE, 'utf8')) as HashMap)
    : {}

  const { currentHashes, changedKeys } = diffHashes(collected, previousHashes)

  if (changedKeys.length > 0) {
    console.log(`[i18n] Changed namespaces (${changedKeys.length}):`)
    changedKeys.forEach((k) => console.log(`  - ${k}`))
  } else {
    console.log('[i18n] No translation changes detected.')
  }

  // -------------------------------------------------------------------------
  // 3. Write KV bulk data, types and runtime constants
  // -------------------------------------------------------------------------

  fs.writeFileSync(OUTPUT_DATA, JSON.stringify(buildBulkData(collected, config.keyPrefix), null, 2) + '\n', 'utf8')

  const source = schemaSourceLocale(collected, defaultLocale)
  if (source && source !== defaultLocale) {
    console.warn(
      `[i18n] defaultLocale="${defaultLocale}" has no translation files. ` +
        `Using "${source}" as the source for I18n.Schema.`,
    )
  }

  writeFile(OUTPUT_TYPES, typesContent)
  writeFile(outputRuntimeConstants, buildRuntimeConstantsContent(collected, defaultLocale))

  // -------------------------------------------------------------------------
  // 4. Fallbacks (seed, migrate, or bundle --fallbacks)
  // -------------------------------------------------------------------------

  let wroteFallbacks = false

  if (shouldGenerateFallbacks) {
    const fallbacksContent = buildFallbacksContent(collected, defaultLocale)

    if (fallbacksContent === null) {
      console.warn(
        `[i18n] No translations found for defaultLocale="${defaultLocale}". ` + 'Skipping fallback generation.',
      )
    } else {
      writeFile(outputFallbacks, fallbacksContent)
      wroteFallbacks = true
    }
  } else {
    console.log('[i18n] Skipping fallback generation. Enable with I18N_GENERATE_FALLBACKS=true or --fallbacks.')
  }

  const outputs = [OUTPUT_DATA, OUTPUT_TYPES, outputRuntimeConstants, wroteFallbacks ? outputFallbacks : null].filter(
    Boolean,
  ) as string[]

  console.log('Generated:\n' + outputs.map((p) => `- ${path.relative(ROOT, p).split(path.sep).join('/')}`).join('\n'))

  // -------------------------------------------------------------------------
  // 5. Push to KV + purge changed cache entries via Cloudflare API
  //    seed    → local KV only, no purge, hashes untouched (a warm local cache under
  //              `astro dev` is the consumer's to drop: `I18N_CACHE=off`, restart)
  //    migrate → remote KV + Cloudflare Purge API, hashes written on success
  // -------------------------------------------------------------------------

  if (!shouldDeploy) {
    console.log('[i18n] Skipping KV deploy (bundle). Use `edgekits-i18n seed` or `edgekits-i18n migrate`.')
    return
  }

  await deploy({ config, kvId: kvId!, wranglerBin: wranglerBin!, isLocal, changedKeys, currentHashes })
}

function collectTranslations(localesDir: string): CollectedData {
  if (!fs.existsSync(localesDir)) {
    console.error(`Locales directory not found: ${localesDir}`)
    process.exit(1)
  }

  const localeDirs = fs
    .readdirSync(localesDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .filter((locale) => {
      const fullPath = path.join(localesDir, locale)
      const files = fs.readdirSync(fullPath, { withFileTypes: true })
      return files.some((f) => f.isFile() && f.name.endsWith('.json'))
    })

  const collected: CollectedData = {}

  for (const locale of localeDirs) {
    const localeDir = path.join(localesDir, locale)
    const files = fs
      .readdirSync(localeDir, { withFileTypes: true })
      .filter((f) => f.isFile() && f.name.endsWith('.json'))

    for (const file of files) {
      const namespace = path.basename(file.name, '.json')
      const raw = fs.readFileSync(path.join(localeDir, file.name), 'utf8')
      const json = JSON.parse(raw) as TranslationTree

      if (!collected[locale]) collected[locale] = {}
      collected[locale][namespace] = json
    }
  }

  return collected
}

function writeFile(file: string, content: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, content, 'utf8')
}

async function deploy({
  config,
  kvId,
  wranglerBin,
  isLocal,
  changedKeys,
  currentHashes,
}: {
  config: I18nConfig
  kvId: string
  wranglerBin: string
  isLocal: boolean
  changedKeys: string[]
  currentHashes: HashMap
}): Promise<void> {
  const kvFlag = isLocal ? '--local' : '--remote'
  const target = isLocal ? 'local' : 'remote'

  // Push all translations to KV
  console.log(`[i18n] Pushing translations to ${target} KV...`)
  try {
    // wrangler's JavaScript entry, run by this Node binary: no shell on any platform
    // (no `.cmd` shim on Windows), and the arguments are constants plus the shape-checked id.
    execFileSync(
      process.execPath,
      [wranglerBin, 'kv', 'bulk', 'put', 'i18n-data.json', kvFlag, `--namespace-id=${kvId}`],
      {
        cwd: ROOT,
        stdio: 'inherit',
      },
    )
    console.log(`[i18n] ✅ KV updated (${target}).`)
  } catch (err) {
    console.error(`[i18n] ❌ Failed to push to ${target} KV.`, err)
    process.exit(1)
  }

  if (isLocal) {
    // Local KV: no purge (a warm local cache under `astro dev` is the consumer's to drop),
    // and the hashes describe production only.
    console.log('[i18n] .i18n-hashes.json left untouched (local seed).')
    return
  }

  // ---------------------------------------------------------------------------
  // Graceful recovery for the hash file:
  //
  //   We update .i18n-hashes.json ONLY when one of these holds:
  //     - No changes: nothing needed purging to begin with.
  //     - A successful purge of all changed URLs.
  //
  //   If a purge was attempted but failed (network error, rate limit
  //   saturation, API error, missing credentials), we DO NOT write the file.
  //   This way, the next `edgekits-i18n migrate` will see the same diff as this
  //   one and re-attempt the invalidation automatically. No manual intervention,
  //   no silent cache staleness.
  // ---------------------------------------------------------------------------

  let shouldWriteHashes = false

  if (changedKeys.length === 0) {
    // Nothing changed — nothing to purge, safe to update hashes.
    //
    // Said out loud rather than passed over: a silent no-op on a deploy path is
    // what made the 2026-09-12 staleness take an afternoon to find. Legitimate
    // outcome, so not an error — but the operator has to be able to see it, and
    // to see WHICH half of the job was skipped.
    console.log(
      '[i18n] Nothing changed against the recorded baseline, so NO cache entry was purged.\n' +
        '       The bulk put above is unconditional, so production KV did receive every value;\n' +
        '       it is the edge cache that was left alone, and it holds translations for a year.\n' +
        '       If you expected a change here, .i18n-hashes.json is describing a state that\n' +
        '       production is not actually in.',
    )
    shouldWriteHashes = true
  } else {
    // Changes — the purge must succeed before we update hashes.
    loadDevVars()

    const purgeUrls = purgeUrlsFor(changedKeys, config.keyPrefix)
    const zoneId = getWranglerVar(ROOT, 'CLOUDFLARE_ZONE_ID') || process.env.CLOUDFLARE_ZONE_ID
    const apiToken = process.env.CLOUDFLARE_CACHEPURGE_API_TOKEN

    if (!zoneId) {
      console.warn(
        '[i18n] ⚠️  CLOUDFLARE_ZONE_ID not found in wrangler.jsonc vars or environment. ' +
          'Skipping cache purge — hash file NOT updated. Re-run `edgekits-i18n migrate` after setting the variable.',
      )
    } else if (!apiToken) {
      console.warn(
        '[i18n] ⚠️  CLOUDFLARE_CACHEPURGE_API_TOKEN not set in environment. ' +
          'Skipping cache purge — hash file NOT updated. Re-run `edgekits-i18n migrate` after setting the secret.',
      )
    } else {
      // Advisory: the Purge API reports success even for URLs it cannot reach, so the
      // name is all there is to check. Never decides shouldWriteHashes.
      await checkKeyPrefixZone(config.keyPrefix, zoneId, apiToken)

      console.log(`[i18n] Purging ${purgeUrls.length} cache entries via Cloudflare API...`)
      const purgeSuccess = await purgeTranslationsCache(zoneId, apiToken, purgeUrls)

      if (purgeSuccess) {
        console.log('[i18n] ✅ Cache purge completed.')
        shouldWriteHashes = true
      } else {
        console.error(
          '[i18n] ❌ Cache purge failed — hash file NOT updated. ' +
            'Re-run `edgekits-i18n migrate` to retry the same invalidation.',
        )
        // Non-fatal for KV: translations are already pushed. Cache will
        // converge on the next successful migrate.
      }
    }
  }

  if (shouldWriteHashes) {
    fs.writeFileSync(HASHES_FILE, JSON.stringify(currentHashes, null, 2) + '\n', 'utf8')
    console.log('[i18n] ✅ .i18n-hashes.json updated.')
  }
}

/**
 * Load .dev.vars into process.env. wrangler dev reads .dev.vars for the Worker
 * runtime, but Node does not — so it is parsed here. Never overwrites a variable
 * already set in the real environment.
 */
function loadDevVars(): void {
  const devVarsPath = path.join(ROOT, '.dev.vars')
  if (!fs.existsSync(devVarsPath)) return

  const lines = fs.readFileSync(devVarsPath, 'utf8').split('\n')
  for (const line of lines) {
    const trimmed = line.trim()
    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIndex = trimmed.indexOf('=')
    if (eqIndex === -1) continue
    const key = trimmed.slice(0, eqIndex).trim()
    const value = trimmed.slice(eqIndex + 1).trim()
    if (key && !(key in process.env)) {
      process.env[key] = value
    }
  }
}

// ---------------------------------------------------------------------------
// Precondition (migrate only): the purge baseline must be clean
//
// `.i18n-hashes.json` records what PRODUCTION KV already holds, and the diff
// against it is the ONLY thing that decides which cache entries get purged.
//
// Migrate against a modified copy and the diff comes out wrong. Note what that
// does and does not break: the bulk put is unconditional, so every value still
// reaches production KV. What is skipped is the PURGE — and translations are
// served `s-maxage=31536000, immutable` (see fetcher.ts), so the stale edge copy
// never ages out. A purge is the only thing that ends it. The run then writes a
// baseline claiming production is current, and exits 0.
//
// The live page that results is neither the old one nor the new one: keys that
// exist only in the shipped fallbacks render beside keys still served stale
// from the edge. That reached production on 2026-09-12, and nothing failed
// loudly — it was caught by somebody reading the live page. Hence a
// precondition that refuses to run, rather than a warning nobody sees.
//
// `seed` never writes this file, so it is exempt and never dirties it.
// ---------------------------------------------------------------------------

/**
 * Abort if the purge baseline carries uncommitted changes.
 *
 * Outside a git work tree, or with no git on PATH, this warns and proceeds: a
 * guard on the deploy path must not be the reason the CLI cannot run in CI
 * or from a tarball.
 */
function assertCleanPurgeBaseline(): void {
  const relativePath = path.relative(ROOT, HASHES_FILE).split(path.sep).join('/')
  let status: string

  try {
    // Porcelain v1 is a stable format, and `--` scopes it to the one path, so a
    // dirty working tree elsewhere (the usual state) is not this guard's business.
    status = execFileSync('git', ['status', '--porcelain', '--', relativePath], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (err) {
    console.warn(
      `[i18n] ⚠️  Could not check ${relativePath} against git (${err instanceof Error ? err.message.split('\n')[0] : String(err)}).\n` +
        '        Proceeding WITHOUT the purge-baseline check. If that file carries hashes\n' +
        '        that do not describe production, this run will skip the cache purge and say nothing.',
    )
    return
  }

  if (status.trim() === '') return

  console.error(
    `\n[i18n] ❌ ${relativePath} has uncommitted changes. Refusing to migrate.\n` +
      `\n  git status --porcelain: ${status.trim()}\n` +
      '\n  That file is the purge baseline: the record of what production KV already holds.\n' +
      '  Migrating against a modified copy makes the change diff come out wrong. Every value\n' +
      '  is still pushed to KV, but the cache purge is driven by that diff, so stale edge\n' +
      '  entries survive — and translations are cached immutable for a year, so they do not\n' +
      '  age out on their own. The run would exit 0 as though it had worked.\n' +
      '\n  Two things dirty this file, and they need opposite fixes:\n' +
      '\n    1. Something other than migrate wrote it (a hand edit, or a pre-package local\n' +
      '       seed script). Those hashes lie about production. Discard them, then migrate:\n' +
      '           git checkout .i18n-hashes.json && npx edgekits-i18n migrate\n' +
      '\n    2. A previous `edgekits-i18n migrate` wrote it. Those hashes describe production\n' +
      '       and are correct. Commit them; migrating again is unnecessary:\n' +
      '           git add .i18n-hashes.json && git commit\n' +
      '\n  The CLI cannot tell the two apart — the file looks identical either way. If you\n' +
      '  are unsure, the last i18n command you ran is the answer.\n',
  )
  process.exit(1)
}
