import assert from 'node:assert/strict'
import test from 'node:test'

import { localesOf } from '@edgekits/i18n-core'
import type { ReactNode } from 'react'
import { renderToString } from 'react-dom/server'

import { I18nProvider, LanguageSwitcher, useI18n, useT } from '../src/react/index.ts'
import { config } from './fixtures/i18n.ts'

/**
 * The React entry under `react-dom/server`: what a route's loader data renders as. No
 * browser: the switcher's markup is checked here, its click handling is not.
 */

const { LANGUAGES } = localesOf(config)

function Root({ children, languages = LANGUAGES }: { children: ReactNode; languages?: typeof LANGUAGES }) {
  return (
    <I18nProvider
      locale="de"
      translations={{ common: { title: 'Hallo' } }}
      languages={languages}
      cookie={config.cookie}
    >
      {children}
    </I18nProvider>
  )
}

function Show({ ns, keyName }: { ns: string; keyName: string }) {
  const t = useT(ns)
  return <i>{String(t[keyName])}</i>
}

test('useT returns the namespace object the provider holds', () => {
  assert.equal(
    renderToString(
      <Root>
        <Show ns="common" keyName="title" />
      </Root>,
    ),
    '<i>Hallo</i>',
  )
})

test('a nested provider merges its namespaces over the outer ones and inherits the rest', () => {
  function Probe() {
    const { locale, languages, translations } = useI18n()
    return <b>{`${locale}|${Object.keys(languages).join(',')}|${Object.keys(translations).join(',')}`}</b>
  }

  const html = renderToString(
    <Root>
      <I18nProvider translations={{ home: { hero: 'Willkommen' } }}>
        <Show ns="common" keyName="title" />
        <Show ns="home" keyName="hero" />
        <Probe />
        <I18nProvider translations={{ common: { title: 'Überschrieben' } }}>
          <Show ns="common" keyName="title" />
        </I18nProvider>
      </I18nProvider>
      <Probe />
    </Root>,
  )
  assert.equal(
    html,
    '<i>Hallo</i><i>Willkommen</i><b>de|en,de,es|common,home</b><i>Überschrieben</i><b>de|en,de,es|common</b>',
  )
})

test('an inner provider can override the locale', () => {
  function Locale() {
    return <>{useI18n().locale}</>
  }
  const html = renderToString(
    <Root>
      <I18nProvider locale="es" translations={{}}>
        <Locale />
      </I18nProvider>
    </Root>,
  )
  assert.equal(html, 'es')
})

test('a namespace no provider above has loaded throws', () => {
  assert.throws(
    () =>
      renderToString(
        <Root>
          <Show ns="pricing" keyName="title" />
        </Root>,
      ),
    {
      message: '[@edgekits/tanstack-i18n] namespace "pricing" is not loaded by a route loader above this component',
    },
  )
})

test('the outermost provider needs a locale; the hooks need a provider', () => {
  assert.throws(() => renderToString(<I18nProvider translations={{}} />), {
    message: '[@edgekits/tanstack-i18n] the outermost I18nProvider needs a `locale`',
  })
  assert.throws(() => renderToString(<Show ns="common" keyName="title" />), {
    message: '[@edgekits/tanstack-i18n] no I18nProvider above this component',
  })
})

test('the switcher renders one item per language, the active one marked', () => {
  const html = renderToString(
    <Root>
      <LanguageSwitcher
        classes={{ root: 'ls', trigger: 'ls-t', dropdown: 'ls-d', item: 'ls-i', itemActive: 'on', itemLabel: 'ls-l' }}
        texts={{ trigger: 'Sprache wählen' }}
      />
    </Root>,
  )

  assert.match(html, /^<div class="ls" data-ls-root="" data-open="false">/)
  assert.match(
    html,
    /<button type="button" data-ls-trigger="" class="ls-t" aria-haspopup="true" aria-expanded="false" aria-label="Sprache wählen">/,
  )
  assert.match(html, /<div data-ls-dropdown="" class="ls-d" role="menu" hidden="">/)

  const items = [...html.matchAll(/<button type="button" class="([^"]*)" data-ls-item=""[^>]*>(.*?)<\/button>/g)]
  assert.deepEqual(
    items.map(([, className, inner]) => [className, inner]),
    [
      ['ls-i', '<span class="ls-l" lang="en">English</span>'],
      ['ls-i on', '<span class="ls-l" lang="de">Deutsch</span>'],
      ['ls-i', '<span class="ls-l" lang="es">Español</span>'],
    ],
  )

  const active = items.filter(([button]) => button.includes('aria-current'))
  assert.equal(active.length, 1)
  assert.match(active[0]![0], /data-lang="de" data-active="true" aria-current="true" role="menuitem" disabled=""/)
})

test('the switcher is headless: a slot left out renders no class attribute', () => {
  const html = renderToString(
    <Root>
      <LanguageSwitcher />
    </Root>,
  )
  assert.doesNotMatch(html, /class=/)
  assert.match(html, /aria-label="Switch language"/)
})

test('the switcher renders nothing with one language', () => {
  const html = renderToString(
    <Root languages={{ de: LANGUAGES.de } as typeof LANGUAGES}>
      <LanguageSwitcher />
    </Root>,
  )
  assert.equal(html, '')
})

test('the switcher needs the cookie settings from a provider', () => {
  assert.throws(
    () =>
      renderToString(
        <I18nProvider locale="de" translations={{}} languages={LANGUAGES}>
          <LanguageSwitcher />
        </I18nProvider>,
      ),
    { message: '[@edgekits/tanstack-i18n] LanguageSwitcher needs `cookie` on an I18nProvider above it' },
  )
})
