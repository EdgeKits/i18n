import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { edgekitsI18n } from '../src/integration/index.ts'
import { virtualModulesDeclaration } from '../src/integration/virtual-types.ts'
import config from './fixtures/i18n.config.ts'

/**
 * One definition of the virtual-module declarations: the package's own `src/virtual.d.ts`
 * and the file the integration injects into a consumer both come from
 * `virtualModulesDeclaration`, and neither can drift from it.
 */

const VIRTUAL_DTS = path.resolve(import.meta.dirname, '..', 'src', 'virtual.d.ts')

function injectedTypes(): Record<string, string> {
  const injected: Record<string, string> = {}
  const done = edgekitsI18n(config).hooks['astro:config:done'] as (params: unknown) => void
  done({
    injectTypes: ({ filename, content }: { filename: string; content: string }) => {
      injected[filename] = content
    },
  })
  return injected
}

test('src/virtual.d.ts is virtualModulesDeclaration("./types") under its header comment', () => {
  const source = readFileSync(VIRTUAL_DTS, 'utf8')
  // The header: the leading `//` lines and the blank line after them.
  const body = source.replace(/^(?:\/\/.*\n)+\n/, '')
  assert.notEqual(body, source, 'expected a header comment')
  assert.equal(body, virtualModulesDeclaration('./types'))
})

test('the integration injects the declarations for the package, as a non-module file', () => {
  const content = injectedTypes()['virtual-modules.d.ts']
  assert.equal(content, virtualModulesDeclaration('@edgekits/astro-i18n'))
  for (const id of ['config', 'runtime-constants', 'fallbacks']) {
    assert.ok(content!.includes(`declare module 'virtual:@edgekits/astro-i18n/${id}'`), id)
  }
  // A top-level import/export would turn the `declare module` blocks into augmentations.
  assert.doesNotMatch(content!, /^(?:import|export)\b/m)
})

test('locales.d.ts is still injected alongside', () => {
  assert.deepEqual(Object.keys(injectedTypes()).sort(), ['locales.d.ts', 'virtual-modules.d.ts'])
})
