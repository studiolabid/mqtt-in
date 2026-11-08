/**
 * Natural, locale-aware string ordering shared by the topic tree, connection groups and lists.
 */

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

/**
 * Compares two strings naturally: case-insensitive and number aware (`a2` < `a10`).
 * Ties (e.g. `a` vs `A`) are broken by code unit order so the result is total and stable.
 */
export function compareNatural(a: string, b: string): number {
  const result = collator.compare(a, b)
  if (result !== 0) return result
  return a < b ? -1 : a > b ? 1 : 0
}
