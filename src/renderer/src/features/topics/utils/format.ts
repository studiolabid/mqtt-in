/**
 * Number formatting for chart statistics (pure).
 */

const formats = new Map<string, Intl.NumberFormat>()

function numberFormat(digits: number, compact: boolean): Intl.NumberFormat {
  const key = `${digits}:${compact}`
  let format = formats.get(key)
  if (!format) {
    format = new Intl.NumberFormat(undefined, {
      maximumFractionDigits: digits,
      notation: compact ? 'compact' : 'standard'
    })
    formats.set(key, format)
  }
  return format
}

/**
 * Grouped value with a precision that fits its magnitude: `1.2M`, `12,345.6`, `23.45`,
 * `0.0123`; `—` when missing.
 */
export function formatStat(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  const abs = Math.abs(value)
  if (abs >= 1_000_000) return numberFormat(2, true).format(value)
  const digits = abs >= 1000 ? 1 : abs >= 100 ? 2 : abs >= 1 ? 3 : 4
  return numberFormat(digits, false).format(value)
}
