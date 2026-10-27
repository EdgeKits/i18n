import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

/**
 * The astro-i18n plugin (plugins/astro-i18n at the repository root), listed by the EdgeKits
 * skills marketplace from this repository. Its version tracks the package's, so a release
 * bumps both.
 */

const ROOT = path.resolve(import.meta.dirname, '..')
const PLUGIN_DIR = path.join(ROOT, '..', '..', 'plugins', 'astro-i18n')
const SKILL_DIR = path.join(PLUGIN_DIR, 'skills', 'astro-i18n')
// The plugin's skills: `astro-i18n` for Astro sites, `tanstack-i18n` for TanStack Start apps.
const SKILLS = ['astro-i18n', 'tanstack-i18n']

const FILES = [
  '.claude-plugin/plugin.json',
  'README.md',
  'skills/astro-i18n/SKILL.md',
  'skills/astro-i18n/references/checklists.md',
  'skills/astro-i18n/references/forms.md',
  'skills/astro-i18n/references/seo.md',
  'skills/astro-i18n/assets/locales/common.json',
  'skills/astro-i18n/assets/locales/messages.json',
  'skills/tanstack-i18n/SKILL.md',
]

const readJson = (file: string) => JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>

test('the plugin files exist', () => {
  for (const file of FILES) assert.ok(existsSync(path.join(PLUGIN_DIR, file)), file)
})

test('plugin.json parses with the required fields; its version is the package version', () => {
  const manifest = readJson(path.join(PLUGIN_DIR, '.claude-plugin', 'plugin.json'))
  const pkg = readJson(path.join(ROOT, 'package.json'))

  for (const field of ['name', 'version', 'displayName', 'description', 'homepage', 'repository', 'license']) {
    assert.equal(typeof manifest[field], 'string', field)
  }
  assert.equal(manifest.name, 'astro-i18n')
  assert.equal(manifest.license, 'MIT')
  assert.deepEqual(manifest.author, { name: 'EdgeKits', url: 'https://edgekits.dev' })
  assert.ok(Array.isArray(manifest.keywords) && manifest.keywords.length > 0, 'keywords')
  assert.equal(manifest.version, pkg.version, 'plugin.json version must equal package.json version')
})

for (const name of SKILLS) {
  const dir = path.join(PLUGIN_DIR, 'skills', name)

  test(`${name} SKILL.md: frontmatter names the skill, describes it, and stays under 8,000 characters`, () => {
    const skill = readFileSync(path.join(dir, 'SKILL.md'), 'utf8')
    const frontmatter = /^---\n([\s\S]*?)\n---\n/.exec(skill)?.[1]
    assert.ok(frontmatter, 'frontmatter')
    assert.match(frontmatter, new RegExp(`^name: ${name}$`, 'm'))
    assert.match(frontmatter, /^description: /m)
    assert.ok([...skill].length < 8000, `${[...skill].length} characters`)
  })

  test(`every reference ${name} SKILL.md points at exists`, () => {
    const skill = readFileSync(path.join(dir, 'SKILL.md'), 'utf8')
    const linked = new Set(skill.match(/(?:references|assets)\/[\w/.-]+\.(?:md|json)/g))
    // astro-i18n leans on its references; tanstack-i18n has none yet.
    if (name === 'astro-i18n') assert.ok(linked.size > 0)
    for (const file of linked) assert.ok(existsSync(path.join(dir, file)), file)
  })
}

test('the references import package code only through its entries', () => {
  for (const file of ['checklists.md', 'forms.md', 'seo.md']) {
    const text = readFileSync(path.join(SKILL_DIR, 'references', file), 'utf8')
    assert.doesNotMatch(text, /@\/domain\/i18n/, `${file} still imports the pre-package engine`)
    for (const [specifier] of text.matchAll(/@edgekits\/astro-i18n(?:\/[\w*/-]+)?/g)) {
      assert.match(
        specifier,
        /^@edgekits\/astro-i18n(?:\/(?:runtime|format|config|middleware|components\/(?:\*|LanguageSwitcher|MissingTranslationBanner)))?$/,
        `${file}: ${specifier}`,
      )
    }
  }
})

test('the skill guide is the same in the plugin README and the package README', () => {
  const section = (file: string) => {
    const text = readFileSync(file, 'utf8')
    const match = /<!-- skill-guide:start -->\n([\s\S]*?)<!-- skill-guide:end -->/.exec(text)
    assert.ok(match, `${file}: no skill-guide markers`)
    return match[1]!
  }
  const guide = section(path.join(PLUGIN_DIR, 'README.md'))
  assert.match(guide, /^\n## Using the skill\n/)
  assert.equal(section(path.join(ROOT, 'README.md')), guide)
})
