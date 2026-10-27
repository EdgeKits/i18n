import { z } from 'astro/zod'

import { SUPPORTED_LOCALES } from './constants'
import { NAMESPACE_KEYS } from 'virtual:@edgekits/astro-i18n/runtime-constants'

// Generated namespaces and real supported locales that have translations: the project's
// runtime-constants.ts through the virtual module (empty lists until the CLI generates it)
export * from 'virtual:@edgekits/astro-i18n/runtime-constants'

// Locale schema from shared constant
export const LocaleSchema = z.enum(SUPPORTED_LOCALES)

// Runtime safety: if namespaces are empty (fresh clone), fall back to string
const hasNamespaces = (NAMESPACE_KEYS as readonly string[]).length > 0

export const NamespaceSchema = hasNamespaces ? z.enum(NAMESPACE_KEYS as [string, ...string[]]) : z.string()

// The keys of I18n.Schema (string on a fresh clone) and the namespaces picked from it:
// the core's types, which its fetcher is typed by.
export type { Namespace, PickSchema } from '@edgekits/i18n-core'
