function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// Keys that would reach an object's prototype instead of its own properties. JSON.parse
// creates `__proto__` as an own key, so a KV value could carry one.
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

/**
 * Deep-merge two dictionaries.
 * - `base` provides known structure (fallback)
 * - `overrides` can provide partial values
 * - Both types are preserved and merged correctly
 * - `__proto__`, `constructor` and `prototype` keys in `overrides` are skipped
 */
export function deepMerge<A extends object, B extends Partial<A>>(base: A, overrides: B): A {
  const result: any = { ...base }

  for (const key of Object.keys(overrides) as (keyof A)[]) {
    if (UNSAFE_KEYS.has(key as string)) continue

    const overrideValue = overrides[key]
    const baseValue = base[key]

    if (overrideValue === undefined) continue

    // For primitives or different types — override directly
    if (!isObject(baseValue) || !isObject(overrideValue)) {
      result[key] = overrideValue
      continue
    }

    // Both are objects — recurse
    result[key] = deepMerge(baseValue as any, overrideValue as any)
  }

  return result
}
