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

type GlobalSchema = I18n.Schema

// Strictly bind the type to the keys of I18n.Schema.
// If the interface is empty (e.g., on a fresh project clone), fall back to string.
export type Namespace = keyof GlobalSchema extends never ? string : keyof GlobalSchema

// Added intersection N & keyof GlobalSchema so the compiler
// doesn't throw an error inside Pick when Namespace falls back to string.
export type PickSchema<N extends Namespace> = [N] extends [keyof GlobalSchema]
  ? Pick<GlobalSchema, N & keyof GlobalSchema>
  : any
