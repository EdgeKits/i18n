import assert from 'node:assert/strict'
import path from 'node:path'
import test from 'node:test'

import { getViteConfig } from 'astro/config'
import { experimental_AstroContainer as AstroContainer } from 'astro/container'
import { createServer, type InlineConfig } from 'vite'

/**
 * Renders the real `LanguageSwitcher.astro` through Astro's container API, with the
 * virtual config pointed at `fixtures/switcher.config.ts` (one locale with a
 * `countryCode`, one without) and a stand-in `flag` component.
 */

const ROOT = path.resolve(import.meta.dirname, '..')

async function renderSwitcher(
  props: Record<string, unknown> = {},
  astroConfig: { compressHTML?: boolean } = {},
): Promise<string> {
  const configFn = getViteConfig(
    {
      resolve: {
        alias: { 'virtual:@edgekits/astro-i18n/config': path.join(ROOT, 'test/fixtures/switcher.config.ts') },
      },
      server: { middlewareMode: true, hmr: false, ws: false },
      logLevel: 'silent',
    },
    { root: ROOT, logLevel: 'silent', ...astroConfig },
  )
  const config = (await configFn({ command: 'serve', mode: 'test' })) as InlineConfig
  const server = await createServer({ ...config, configFile: false })
  try {
    const load = (file: string) => server.ssrLoadModule(path.join(ROOT, file)).then((m) => m.default)
    const Switcher = await load('src/components/LanguageSwitcher.astro')
    const Flag = await load('test/fixtures/Flag.astro')
    const container = await AstroContainer.create()
    return await container.renderToString(Switcher, {
      props: { flag: Flag, ...props },
      locals: { uiLocale: 'en', translationLocale: 'en' },
    })
  } finally {
    await server.close()
  }
}

const item = (html: string, lang: string) => {
  const match = new RegExp(`<button[^>]*data-lang="${lang}"[^>]*>([\\s\\S]*?)</button>`).exec(html)
  assert.ok(match, `no item for ${lang}`)
  return match[1]!
}

test('LanguageSwitcher: the flag renders only for a locale with a countryCode', async () => {
  const html = await renderSwitcher()
  assert.match(item(html, 'en'), /<i data-flag="us" data-size="16"><\/i>English/)
  assert.doesNotMatch(item(html, 'eo'), /data-flag/)
  assert.match(item(html, 'eo'), /<span lang="eo">Esperanto<\/span>/)
})

const triggerLabel = (html: string) => /<button[^>]*data-ls-trigger[^>]*aria-label="([^"]*)"/.exec(html)?.[1]

test('LanguageSwitcher: the trigger label defaults to English and takes texts.trigger', async () => {
  assert.equal(triggerLabel(await renderSwitcher()), 'Switch language')
  assert.equal(triggerLabel(await renderSwitcher({ texts: { trigger: 'Sprache wechseln' } })), 'Sprache wechseln')
})

test('LanguageSwitcher: each item label carries lang with its locale', async () => {
  const html = await renderSwitcher()
  const items = [...html.matchAll(/<button[^>]*data-ls-item[^>]*data-lang="([^"]+)"[^>]*>\s*<span([^>]*)>/g)]
  assert.equal(items.length, 2, 'both fixture locales render')
  for (const [, locale, spanAttrs] of items)
    assert.ok(spanAttrs!.includes(` lang="${locale}"`), `${locale}: ${spanAttrs}`)
})

test('LanguageSwitcher: under compressHTML an item opens with at most one space before its label', async () => {
  // 0.1.7 had a JSX comment among the button's children; it split the whitespace run and
  // compressHTML kept two spaces (found on edgekits.dev).
  const html = await renderSwitcher({}, { compressHTML: true })
  const items = [...html.matchAll(/<button[^>]*data-ls-item[^>]*>(\s*)<span/g)]
  assert.equal(items.length, 2, 'both fixture locales render')
  for (const [open, gap] of items) assert.ok(gap!.length <= 1, JSON.stringify(open))
})
