#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { DEFAULT_GENERATED_DIR, DEFAULT_LOCALES_DIR, type I18nConfig } from '../types.ts'
import { collectTranslations } from './collect.ts'
import { parseDevVars } from './dev-vars.ts'
import {
  assertNoNullValues,
  assertValidNames,
  buildBulkData,
  buildFallbacksContent,
  buildRuntimeConstantsContent,
  buildTypesContent,
  localesWithTranslations,
  schemaSourceLocale,
  translationWarnings,
  type CollectedData,
} from './generate.ts'
import {
  diffHashes,
  kvKeysFor,
  purgeUrlsFor,
  readBaseline,
  removedKeys,
  writeBaseline,
  type HashMap,
} from './hashes.ts'
import { CONFIG_FILE, loadI18nConfig } from './load-config.ts'
import { purgeTranslationsCache } from './purge.ts'
import { KV_BINDING, readWorkerSettings, resolveWranglerBin, type WorkerSettings } from './wrangler.ts'
import { checkKeyPrefixZone } from './zone.ts'

// KV can take up to 60 s to show a write in other locations; the second purge comes after.
const DEFAULT_PURGE_DELAY_S = 65

const HELP = `Usage: edgekits-i18n <command> [--fallbacks] [--config <path>] [--wrangler <path>]
                     [--env <name>] [--purge-delay <seconds>]

Reads ${CONFIG_FILE} and <localesDir>/<locale>/<namespace>.json from the config's directory.

Commands:
  bundle    Write i18n-data.json, src/i18n.generated.d.ts and <generatedDir>/runtime-constants.ts.
            No side effects. --fallbacks also writes <generatedDir>/fallbacks.generated.ts.
  seed      bundle + fallbacks, then push to LOCAL KV (wrangler --local): the TRANSLATIONS
            preview_id when set (what wrangler dev reads), else its id.
            .i18n-hashes.json is left untouched: it records remote KV, not local.
  migrate   bundle + fallbacks, then push to remote KV, delete the keys of removed translation
            files, purge the changed edge-cache entries, wait --purge-delay seconds, purge them
            again, and write .i18n-hashes.json. Refuses to run while .i18n-hashes.json has
            uncommitted changes.

Options:
  --config <path>          The config to load (default: ./${CONFIG_FILE}). Its directory
                           is the project root: locales, generated files and .i18n-hashes.json live there.
  --wrangler <path>        The Worker's wrangler config (default: ./wrangler.jsonc): the TRANSLATIONS
                           binding and CLOUDFLARE_ZONE_ID; .dev.vars and the wrangler binary come from
                           its directory.
  --env <name>             Read the TRANSLATIONS binding and CLOUDFLARE_ZONE_ID from env.<name> of the
                           wrangler config (wrangler does not inherit them), and pass --env to wrangler.
  --purge-delay <seconds>  migrate: the wait between the two purges (default ${DEFAULT_PURGE_DELAY_S}). KV can take
                           up to 60 s to show a write in other locations, and a read there in that window
                           re-caches the old value. 0 purges once.

Exit status: 0 on success, 1 on an error. migrate also exits 1 when KV was updated but the edge
cache was not purged (no CLOUDFLARE_ZONE_ID or token, a failed purge); .i18n-hashes.json is then
not written, so the next migrate retries.

Monorepo: keep the config, locales and generated files in one package and pass any one app's
Worker config (every app binds the same KV namespace and zone), from the repository root:
  edgekits-i18n migrate --config packages/i18n/${CONFIG_FILE} --wrangler apps/app/wrangler.jsonc
`

const COMMANDS = ['bundle', 'seed', 'migrate'] as const
type Command = (typeof COMMANDS)[number]

// The flags that take a value; each is removed from argv, with its value, before the
// command is looked for.
const VALUE_FLAGS = {
  '--config': 'a path',
  '--wrangler': 'a path',
  '--env': 'an environment name',
  '--purge-delay': 'a number of seconds',
} as const
type ValueFlag = keyof typeof VALUE_FLAGS

const WRANGLER_FILE = 'wrangler.jsonc'

/**
 * Every path the CLI touches, absolute. Two roots: the config's directory is the project
 * root (translations in, generated files and the purge baseline out); the wrangler config's
 * directory is the Worker root (`.dev.vars`, the wrangler binary, wrangler's own cwd). With
 * no flags both are the current directory.
 */
type Paths = {
  root: string
  config: string
  wranglerConfig: string
  wranglerRoot: string
  data: string
  types: string
  hashes: string
}

type Options = {
  // `--env`: the wrangler environment, or undefined for the top level.
  env?: string
  // `--purge-delay`, in seconds.
  purgeDelay: number
}

const KV_NAMESPACE_ID = /^[0-9a-f]{32}$/i

// An environment name reaches wrangler's argv: only the characters wrangler's own names use.
const ENV_NAME = /^[A-Za-z0-9_-]+$/

// How migrate ends when KV was written but the edge cache was not purged.
const CACHE_NOT_PURGED =
  'KV is updated; the edge cache is not. .i18n-hashes.json was NOT written, so the next ' +
  '`edgekits-i18n migrate` retries the same purge.'

await main(process.argv.slice(2))

async function main(argv: string[]): Promise<void> {
  const { args, flags } = extractValueFlags(argv)
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

  await run(command as Command, args, resolvePaths(flags), resolveOptions(flags))
}

/** Takes the value flags (`--config <path>`, or `--config=<path>`, …) out of argv. */
function extractValueFlags(argv: string[]): { args: string[]; flags: Partial<Record<ValueFlag, string>> } {
  const args: string[] = []
  const flags: Partial<Record<ValueFlag, string>> = {}
  const names = Object.keys(VALUE_FLAGS) as ValueFlag[]

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    const flag = names.find((f) => arg === f || arg.startsWith(`${f}=`))
    if (!flag) {
      args.push(arg)
      continue
    }
    const value = arg === flag ? argv[++i] : arg.slice(flag.length + 1)
    if (!value || value.startsWith('-')) {
      console.error(`[i18n] ${flag} needs ${VALUE_FLAGS[flag]}.`)
      process.exit(1)
    }
    flags[flag] = value
  }

  return { args, flags }
}

function resolvePaths(flags: Partial<Record<ValueFlag, string>>): Paths {
  const config = path.resolve(flags['--config'] ?? CONFIG_FILE)
  if (!fs.existsSync(config)) {
    console.error(`[i18n] Config file not found: ${config}`)
    process.exit(1)
  }

  // The default wrangler config is read only by seed and migrate (bundle never needs it);
  // a path given explicitly must exist whatever the command.
  const wranglerConfig = path.resolve(flags['--wrangler'] ?? WRANGLER_FILE)
  if (flags['--wrangler'] !== undefined && !fs.existsSync(wranglerConfig)) {
    console.error(`[i18n] Wrangler config not found: ${wranglerConfig}`)
    process.exit(1)
  }

  const root = path.dirname(config)
  return {
    root,
    config,
    wranglerConfig,
    wranglerRoot: path.dirname(wranglerConfig),
    // Fixed outputs at the project root.
    data: path.join(root, 'i18n-data.json'),
    types: path.join(root, 'src', 'i18n.generated.d.ts'),
    // Per-namespace content hashes from the last migrate, one baseline per KV namespace id.
    // Used to detect which namespaces changed (or were removed) and need cache purging.
    // TRACKED in git: the committed copy is the purge baseline.
    // Absence (or no entry for the id) means "first run", all namespaces treated as changed.
    hashes: path.join(root, '.i18n-hashes.json'),
  }
}

function resolveOptions(flags: Partial<Record<ValueFlag, string>>): Options {
  const env = flags['--env']
  if (env !== undefined && !ENV_NAME.test(env)) {
    console.error(`[i18n] --env "${env}" is not an environment name (letters, digits, "-" and "_").`)
    process.exit(1)
  }

  const delay = flags['--purge-delay']
  const purgeDelay = delay === undefined ? DEFAULT_PURGE_DELAY_S : Number(delay)
  if (!Number.isFinite(purgeDelay) || purgeDelay < 0) {
    console.error(`[i18n] --purge-delay "${delay}" is not a number of seconds (0 or more).`)
    process.exit(1)
  }

  return { env, purgeDelay }
}

// A path as the user sees it: relative to where the CLI was run, forward slashes.
function shown(file: string): string {
  return path.relative(process.cwd(), file).split(path.sep).join('/')
}

function fail(message: string): never {
  console.error(`[i18n] ${message}`)
  process.exit(1)
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

async function run(command: Command, args: string[], paths: Paths, options: Options): Promise<void> {
  const shouldDeploy = command !== 'bundle'
  const isLocal = command === 'seed'
  const shouldGenerateFallbacks =
    shouldDeploy || args.includes('--fallbacks') || process.env.I18N_GENERATE_FALLBACKS === 'true'

  if (command === 'migrate') {
    assertCleanPurgeBaseline(paths)
  }

  const config = await loadI18nConfig(paths.config)
  const defaultLocale = config.defaultLocale
  const localesDir = path.join(paths.root, config.localesDir ?? DEFAULT_LOCALES_DIR)
  const generatedDir = path.join(paths.root, config.generatedDir ?? DEFAULT_GENERATED_DIR)
  const outputRuntimeConstants = path.join(generatedDir, 'runtime-constants.ts')
  const outputFallbacks = path.join(generatedDir, 'fallbacks.generated.ts')

  // Read before writing anything, so a missing binding fails the run up front.
  const worker = shouldDeploy ? readWorkerSettings(paths.wranglerConfig, KV_BINDING, options.env) : undefined

  // seed writes the namespace `wrangler dev` reads (preview_id when set), migrate the id.
  const writeKvId = worker && (isLocal ? (worker.previewId ?? worker.kvId) : worker.kvId)

  // The id becomes a command-line argument (deploy()); only a real namespace id's shape
  // may get there.
  if (writeKvId !== undefined && !KV_NAMESPACE_ID.test(writeKvId)) {
    const field = isLocal && worker?.previewId !== undefined ? 'preview_id' : 'id'
    fail(
      `The ${KV_BINDING} ${field} in ${shown(paths.wranglerConfig)}, "${writeKvId}", is not a KV namespace id (32 hex characters).`,
    )
  }

  if (worker && worker.otherEnvs.length > 0) {
    console.warn(
      `[i18n] ⚠️  ${shown(paths.wranglerConfig)} binds ${KV_BINDING} to a different id in ` +
        `${worker.otherEnvs.map((name) => `env.${name}`).join(', ')}; this run uses the top-level binding. ` +
        'Pass --env <name> to target one of those environments.',
    )
  }

  // The Worker's wrangler, found before anything is written.
  let wranglerBin: string | undefined
  if (shouldDeploy) {
    try {
      wranglerBin = resolveWranglerBin(paths.wranglerRoot)
    } catch (err) {
      fail(errorMessage(err))
    }
  }

  // -------------------------------------------------------------------------
  // 1. Collect translations from <localesDir>/<locale>/<namespace>.json
  // -------------------------------------------------------------------------

  if (!fs.existsSync(localesDir)) {
    fail(`Locales directory not found: ${localesDir}`)
  }

  let collected: CollectedData
  let ignored: string[]
  try {
    ;({ collected, ignored } = collectTranslations(localesDir, shown))
  } catch (err) {
    fail(errorMessage(err))
  }

  for (const file of ignored) {
    console.warn(
      `[i18n] ⚠️  ${file} is in a subfolder of its locale folder and is ignored: a namespace is ` +
        '<localesDir>/<locale>/<namespace>.json.',
    )
  }

  // The schema is built here too, so an untypeable value (a mixed array, a null) stops the
  // run before anything is written.
  let typesContent: string
  try {
    assertValidNames(collected, config.languages)
    assertNoNullValues(collected)
    typesContent = buildTypesContent(collected, defaultLocale)
  } catch (err) {
    fail(errorMessage(err))
  }

  for (const warning of translationWarnings(collected, defaultLocale)) {
    console.warn(`[i18n] ⚠️  ${warning}`)
  }

  const locales = localesWithTranslations(collected)

  if (locales.length === 0) {
    console.warn(`[i18n] No locales with JSON files found in ${localesDir}. Generating empty artifacts.`)
  }

  // -------------------------------------------------------------------------
  // 2. Compute per-namespace content hashes and detect changes
  // -------------------------------------------------------------------------

  // The parsed baseline file (absent on first run — all namespaces treated as new)
  let baselineFile: unknown
  if (fs.existsSync(paths.hashes)) {
    try {
      baselineFile = JSON.parse(fs.readFileSync(paths.hashes, 'utf8'))
    } catch (err) {
      fail(`${shown(paths.hashes)} is not valid JSON: ${errorMessage(err)}`)
    }
  }

  // The baseline of the KV namespace migrate writes; bundle reads no wrangler config and
  // gets one only when the file holds a single baseline.
  const previousHashes = readBaseline(baselineFile, worker?.kvId)
  const { currentHashes, changedKeys } = diffHashes(collected, previousHashes ?? {})
  const removed = previousHashes ? removedKeys(previousHashes, currentHashes) : []

  if (previousHashes === undefined) {
    console.log(
      `[i18n] ${shown(paths.hashes)} holds baselines for several KV namespaces: seed and migrate list the changes.`,
    )
  } else if (changedKeys.length === 0 && removed.length === 0) {
    console.log('[i18n] No translation changes detected.')
  } else {
    if (changedKeys.length > 0) {
      console.log(`[i18n] Changed namespaces (${changedKeys.length}):`)
      changedKeys.forEach((k) => console.log(`  - ${k}`))
    }
    if (removed.length > 0) {
      console.log(`[i18n] Removed namespaces (${removed.length}):`)
      removed.forEach((k) => console.log(`  - ${k}`))
    }
  }

  // -------------------------------------------------------------------------
  // 3. Write KV bulk data, types and runtime constants
  // -------------------------------------------------------------------------

  fs.writeFileSync(paths.data, JSON.stringify(buildBulkData(collected, config.keyPrefix), null, 2) + '\n', 'utf8')

  const source = schemaSourceLocale(collected, defaultLocale)
  if (source && source !== defaultLocale) {
    console.warn(
      `[i18n] defaultLocale="${defaultLocale}" has no translation files. ` +
        `Using "${source}" as the source for I18n.Schema.`,
    )
  }

  writeFile(paths.types, typesContent)
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

  const outputs = [paths.data, paths.types, outputRuntimeConstants, wroteFallbacks ? outputFallbacks : null].filter(
    Boolean,
  ) as string[]

  console.log('Generated:\n' + outputs.map((p) => `- ${shown(p)}`).join('\n'))

  // -------------------------------------------------------------------------
  // 5. Push to KV + purge changed cache entries via Cloudflare API
  //    seed    → local KV only, no purge, hashes untouched (a warm local cache under
  //              `astro dev` is the consumer's to drop: `I18N_CACHE=off`, restart)
  //    migrate → remote KV, removed keys deleted, two purge rounds, hashes written on success
  // -------------------------------------------------------------------------

  if (!shouldDeploy) {
    console.log('[i18n] Skipping KV deploy (bundle). Use `edgekits-i18n seed` or `edgekits-i18n migrate`.')
    return
  }

  await deploy({
    config,
    paths,
    options,
    worker: worker!,
    writeKvId: writeKvId!,
    wranglerBin: wranglerBin!,
    isLocal,
    changedKeys,
    removed,
    currentHashes,
    baselineFile,
  })
}

function writeFile(file: string, content: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, content, 'utf8')
}

/**
 * Run the Worker's wrangler with `args`, then `--config` and `--env` when given. wrangler's
 * JavaScript entry, run by this Node binary: no shell on any platform (no `.cmd` shim on
 * Windows), and the arguments are constants, shape-checked ids and names, and absolute paths.
 * Always an explicit --config, from the Worker root: wrangler resolves `.wrangler/state`
 * (where a local seed lands, and where `wrangler dev` there reads) from the directory of the
 * config it loaded, and without --config a stray wrangler.json there would win over the
 * wrangler.jsonc this CLI read.
 */
function runWrangler(wranglerBin: string, paths: Paths, options: Options, args: string[]): void {
  const envArgs = options.env !== undefined ? ['--env', options.env] : []
  execFileSync(process.execPath, [wranglerBin, ...args, '--config', paths.wranglerConfig, ...envArgs], {
    cwd: paths.wranglerRoot,
    stdio: 'inherit',
  })
}

async function deploy({
  config,
  paths,
  options,
  worker,
  writeKvId,
  wranglerBin,
  isLocal,
  changedKeys,
  removed,
  currentHashes,
  baselineFile,
}: {
  config: I18nConfig
  paths: Paths
  options: Options
  worker: WorkerSettings
  writeKvId: string
  wranglerBin: string
  isLocal: boolean
  changedKeys: string[]
  removed: string[]
  currentHashes: HashMap
  baselineFile: unknown
}): Promise<void> {
  const kvFlag = isLocal ? '--local' : '--remote'
  const target = isLocal ? 'local' : 'remote'

  // Push all translations to KV
  console.log(`[i18n] Pushing translations to ${target} KV...`)
  try {
    runWrangler(wranglerBin, paths, options, ['kv', 'bulk', 'put', paths.data, kvFlag, `--namespace-id=${writeKvId}`])
    console.log(`[i18n] ✅ KV updated (${target}).`)
  } catch (err) {
    console.error(`[i18n] ❌ Failed to push to ${target} KV.`, err)
    process.exit(1)
  }

  if (isLocal) {
    // Local KV: no purge (a warm local cache under `astro dev` is the consumer's to drop),
    // and the hashes describe remote KV only.
    console.log('[i18n] .i18n-hashes.json left untouched (local seed).')
    return
  }

  // ---------------------------------------------------------------------------
  // The removed translation files: their keys leave KV, their URLs join the purge.
  // ---------------------------------------------------------------------------

  if (removed.length > 0) {
    const keys = kvKeysFor(removed, config.keyPrefix)
    console.log(`[i18n] Deleting ${keys.length} KV key(s) of removed translation files:`)
    keys.forEach((key) => console.log(`  - ${key}`))

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'edgekits-i18n-'))
    let deleteError: unknown
    try {
      const keysFile = path.join(dir, 'deleted-keys.json')
      fs.writeFileSync(keysFile, JSON.stringify(keys), 'utf8')
      runWrangler(wranglerBin, paths, options, [
        'kv',
        'bulk',
        'delete',
        keysFile,
        '--remote',
        `--namespace-id=${writeKvId}`,
        '--force',
      ])
    } catch (err) {
      deleteError = err ?? new Error('wrangler kv bulk delete failed')
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }

    if (deleteError !== undefined) {
      console.error('[i18n] ❌ Failed to delete the removed keys from remote KV.', deleteError)
      fail(CACHE_NOT_PURGED)
    }
    console.log(`[i18n] ✅ ${keys.length} key(s) deleted.`)
  }

  // ---------------------------------------------------------------------------
  // Graceful recovery for the hash file:
  //
  //   We update .i18n-hashes.json ONLY when one of these holds:
  //     - No changes: nothing needed purging to begin with.
  //     - Both purge rounds of every changed and removed URL succeeded.
  //
  //   Otherwise (missing zone id or token, network error, rate limit saturation,
  //   API error) we DO NOT write the file and exit 1: the next `edgekits-i18n
  //   migrate` sees the same diff and re-attempts the invalidation.
  // ---------------------------------------------------------------------------

  const purgeKeys = [...changedKeys, ...removed]

  if (purgeKeys.length === 0) {
    // Nothing changed — nothing to purge, safe to update hashes.
    //
    // Said out loud rather than passed over: a silent no-op on a deploy path is
    // what made the 2026-09-12 staleness take an afternoon to find. Legitimate
    // outcome, so not an error — but the operator has to be able to see it, and
    // to see WHICH half of the job was skipped.
    console.log(
      '[i18n] Nothing changed against the recorded baseline, so NO cache entry was purged.\n' +
        '       The bulk put above is unconditional, so remote KV did receive every value;\n' +
        '       it is the edge cache that was left alone, and it holds translations for a year.\n' +
        '       If you expected a change here, .i18n-hashes.json is describing a state that\n' +
        '       this KV namespace is not actually in.',
    )
    writeHashes(paths, baselineFile, worker.kvId, currentHashes)
    return
  }

  loadDevVars(paths.wranglerRoot)

  const zoneId = worker.zoneId || process.env.CLOUDFLARE_ZONE_ID
  const apiToken = process.env.CLOUDFLARE_CACHEPURGE_API_TOKEN
  const scope =
    options.env !== undefined
      ? `env.${options.env}.vars of ${shown(paths.wranglerConfig)}`
      : `${shown(paths.wranglerConfig)} vars`

  if (!zoneId) {
    fail(
      `❌ CLOUDFLARE_ZONE_ID not found in ${scope} or the environment, so the cache purge was skipped. ${CACHE_NOT_PURGED}`,
    )
  }
  if (!apiToken) {
    fail(
      `❌ CLOUDFLARE_CACHEPURGE_API_TOKEN not set in the environment or .dev.vars, so the cache purge was skipped. ${CACHE_NOT_PURGED}`,
    )
  }

  // Advisory: the Purge API reports success even for URLs it cannot reach, so the
  // name is all there is to check. Never decides whether the hashes are written.
  await checkKeyPrefixZone(config.keyPrefix, zoneId, apiToken)

  const purgeUrls = purgeUrlsFor(purgeKeys, config.keyPrefix)

  console.log(`[i18n] Purging ${purgeUrls.length} cache entries via Cloudflare API...`)
  if (!(await purgeTranslationsCache(zoneId, apiToken, purgeUrls))) {
    fail(`❌ Cache purge failed. ${CACHE_NOT_PURGED}`)
  }

  // A read of a purged URL in a location where KV still shows the old value caches that
  // old value again, for a year. The same URLs are purged again once KV has settled.
  if (options.purgeDelay > 0) {
    console.log(
      `[i18n] Waiting ${options.purgeDelay} s for KV to settle, then purging the same ${purgeUrls.length} URL(s) again: ` +
        'KV can take up to 60 s to show a write in other locations, and a read there meanwhile re-caches the old value.',
    )
    await new Promise((resolve) => setTimeout(resolve, options.purgeDelay * 1000))

    if (!(await purgeTranslationsCache(zoneId, apiToken, purgeUrls))) {
      fail(`❌ The second cache purge failed. ${CACHE_NOT_PURGED}`)
    }
  }

  console.log('[i18n] ✅ Cache purge completed.')
  writeHashes(paths, baselineFile, worker.kvId, currentHashes)
}

// The baseline of `kvId` replaced in the file, the other namespaces' kept (ADR-0034).
function writeHashes(paths: Paths, baselineFile: unknown, kvId: string, hashes: HashMap): void {
  fs.writeFileSync(paths.hashes, JSON.stringify(writeBaseline(baselineFile, kvId, hashes), null, 2) + '\n', 'utf8')
  console.log(`[i18n] ✅ ${shown(paths.hashes)} updated.`)
}

/**
 * Load the Worker root's .dev.vars into process.env. wrangler dev reads .dev.vars for
 * the Worker runtime, but Node does not — so it is parsed here, with the same dotenv
 * syntax (dev-vars.ts). Never overwrites a variable already set in the real environment.
 */
function loadDevVars(wranglerRoot: string): void {
  const devVarsPath = path.join(wranglerRoot, '.dev.vars')
  if (!fs.existsSync(devVarsPath)) return

  for (const [key, value] of Object.entries(parseDevVars(fs.readFileSync(devVarsPath, 'utf8')))) {
    if (!(key in process.env)) {
      process.env[key] = value
    }
  }
}

// ---------------------------------------------------------------------------
// Precondition (migrate only): the purge baseline must be clean
//
// `.i18n-hashes.json` records what remote KV already holds, and the diff
// against it is the ONLY thing that decides which cache entries get purged.
//
// Migrate against a modified copy and the diff comes out wrong. Note what that
// does and does not break: the bulk put is unconditional, so every value still
// reaches KV. What is skipped is the PURGE — and translations are served
// `s-maxage=31536000, immutable` (see fetcher.ts), so the stale edge copy
// never ages out. A purge is the only thing that ends it. The run then writes a
// baseline claiming KV is current, and exits 0.
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
function assertCleanPurgeBaseline(paths: Paths): void {
  // git runs from the project root on the bare file name; messages show the path from
  // where the CLI was run.
  const relativePath = path.relative(paths.root, paths.hashes).split(path.sep).join('/')
  const shownPath = shown(paths.hashes)
  let status: string

  try {
    // Porcelain v1 is a stable format, and `--` scopes it to the one path, so a
    // dirty working tree elsewhere (the usual state) is not this guard's business.
    status = execFileSync('git', ['status', '--porcelain', '--', relativePath], {
      cwd: paths.root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (err) {
    console.warn(
      `[i18n] ⚠️  Could not check ${shownPath} against git (${err instanceof Error ? err.message.split('\n')[0] : String(err)}).\n` +
        '        Proceeding WITHOUT the purge-baseline check. If that file carries hashes\n' +
        '        that do not describe KV, this run will skip the cache purge and say nothing.',
    )
    return
  }

  if (status.trim() === '') return

  console.error(
    `\n[i18n] ❌ ${shownPath} has uncommitted changes. Refusing to migrate.\n` +
      `\n  git status --porcelain: ${status.trim()}\n` +
      '\n  That file is the purge baseline: the record of what remote KV already holds.\n' +
      '  Migrating against a modified copy makes the change diff come out wrong. Every value\n' +
      '  is still pushed to KV, but the cache purge is driven by that diff, so stale edge\n' +
      '  entries survive — and translations are cached immutable for a year, so they do not\n' +
      '  age out on their own. The run would exit 0 as though it had worked.\n' +
      '\n  Two things dirty this file, and they need opposite fixes:\n' +
      '\n    1. Something other than migrate wrote it (a hand edit, or a pre-package local\n' +
      '       seed script). Those hashes lie about KV. Discard them, then migrate:\n' +
      `           git checkout ${shownPath} && npx edgekits-i18n migrate\n` +
      '\n    2. A previous `edgekits-i18n migrate` wrote it. Those hashes describe KV\n' +
      '       and are correct. Commit them; migrating again is unnecessary:\n' +
      `           git add ${shownPath} && git commit\n` +
      '\n  The CLI cannot tell the two apart — the file looks identical either way. If you\n' +
      '  are unsure, the last i18n command you ran is the answer.\n',
  )
  process.exit(1)
}
