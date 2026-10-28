function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Deep-merge two dictionaries.
 * - `base` provides known structure (fallback)
 * - `overrides` can provide partial values
 * - Both types are preserved and merged correctly
 * - `__proto__` in `overrides` is skipped: JSON.parse creates it as an own key, so a KV
 *   value could carry one, and assigning it would replace the result's prototype.
 *   `constructor` and `prototype` are ordinary keys: assigning them on the fresh result
 *   object creates own properties and reaches no prototype.
 */
export function deepMerge<A extends object, B extends Partial<A>>(base: A, overrides: B): A {
  const result: any = { ...base }

  for (const key of Object.keys(overrides) as (keyof A)[]) {
    if (key === '__proto__') continue

    const overrideValue = overrides[key]
    // Own keys only: `base.constructor` would otherwise be the inherited `Object`.
    const baseValue = Object.hasOwn(base, key) ? base[key] : undefined

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
