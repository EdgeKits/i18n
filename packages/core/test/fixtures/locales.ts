import type { CollectedData } from '../../src/cli/generate.ts'

// A small collected locale tree, as the CLI reads it from <localesDir>/<locale>/<namespace>.json:
// `en` (the default) has two namespaces, `de` only one, so `de` is not fully translated.
export const LOCALE_TREE: CollectedData = {
  en: {
    common: { title: 'Hello', nav: { home: 'Home' } },
    blog: { heading: 'Blog' },
  },
  de: {
    common: { title: 'Hallo', nav: { home: 'Startseite' } },
  },
}

// A tree with lists: strings, objects (with a nested list), an empty list and a list of
// lists. `de` overrides two of them with shorter lists.
export const ARRAY_TREE = {
  en: {
    faq: {
      title: 'FAQ',
      tags: ['edge', 'i18n', 'astro'],
      items: [
        { q: 'Why KV?', a: 'Reads at the edge.', links: ['/docs/', '/blog/'] },
        { q: 'Why a cache?', a: 'Fewer KV reads.', links: [] },
      ],
      empty: [],
      grid: [
        ['a', 'b'],
        ['c', 'd'],
      ],
    },
  },
  de: {
    faq: {
      tags: ['Edge'],
      items: [{ q: 'Warum KV?', a: 'Lesen am Edge.', links: ['/de/docs/'] }],
    },
  },
} satisfies CollectedData
