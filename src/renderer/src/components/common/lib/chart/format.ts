import { formatClock, formatDate } from '@/utils/format'

const SECOND = 1000
const MINUTE = 60 * SECOND
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** Time-axis tick increments (ms): whole seconds and up — never sub-second ticks. */
export const TIME_INCRS: number[] = [
  SECOND,
  2 * SECOND,
  5 * SECOND,
  10 * SECOND,
  15 * SECOND,
  30 * SECOND,
  MINUTE,
  2 * MINUTE,
  5 * MINUTE,
  10 * MINUTE,
  15 * MINUTE,
  30 * MINUTE,
  HOUR,
  2 * HOUR,
  3 * HOUR,
  4 * HOUR,
  6 * HOUR,
  8 * HOUR,
  12 * HOUR,
  DAY,
  2 * DAY,
  3 * DAY,
  7 * DAY,
  14 * DAY
]

const pad = (n: number): string => String(n).padStart(2, '0')
const dayFormat = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' })

/**
 * Local-time tick label for the given increment: `HH:mm:ss`, `HH:mm`, or `Nov 8` for day
 * increments and for ticks that fall on midnight (marks day boundaries).
 */
export function formatTimeTick(ms: number, incr: number): string {
  const d = new Date(ms)
  const midnight = d.getHours() === 0 && d.getMinutes() === 0 && d.getSeconds() === 0
  if (incr >= DAY || midnight) return dayFormat.format(d)
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`
  return incr >= MINUTE ? hm : `${hm}:${pad(d.getSeconds())}`
}

/** Decimals needed to print `value` exactly (0–10), ignoring float noise. */
export function decimalsOf(value: number): number {
  if (!Number.isFinite(value) || Number.isInteger(value)) return 0
  const text = String(Number(Math.abs(value).toPrecision(12)))
  const [mantissa, exponent] = text.split('e')
  const fraction = mantissa.split('.')[1]?.length ?? 0
  const shift = exponent ? -Number(exponent) : 0
  return Math.max(0, Math.min(10, fraction + shift))
}

const formats = new Map<string, Intl.NumberFormat>()

function numberFormat(decimals: number, compact: boolean): Intl.NumberFormat {
  const key = `${decimals}:${compact}`
  let format = formats.get(key)
  if (!format) {
    format = compact
      ? new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: decimals })
      : new Intl.NumberFormat(undefined, {
          minimumFractionDigits: decimals,
          maximumFractionDigits: decimals
        })
    formats.set(key, format)
  }
  return format
}

/**
 * Y-axis labels with one consistent precision derived from the tick increment; compact
 * notation (10K, 12.5K, 1.2M) once the axis reaches 10,000.
 */
export function formatNumberTicks(splits: readonly number[], incr: number): string[] {
  const maxAbs = splits.reduce((m, v) => Math.max(m, Math.abs(v)), 0)
  if (maxAbs >= 10_000) {
    const unit = 10 ** Math.min(12, Math.floor(Math.log10(maxAbs) / 3) * 3)
    const format = numberFormat(decimalsOf(incr / unit), true)
    return splits.map((v) => format.format(v === 0 ? 0 : v))
  }
  const format = numberFormat(decimalsOf(incr), false)
  return splits.map((v) => format.format(v === 0 ? 0 : v))
}

/** Values from this magnitude on are written compactly (`1.23M`) with `{ compact: true }`. */
const COMPACT_FROM = 1_000_000

/**
 * The one formatter of a measured value (CT-21), for the chart legend and the stats table:
 * grouped, up to 2 decimals (≥ 1000), 3 (≥ 1) or 4 (< 1); `—` when missing. With
 * `{ compact: true }` values of a million and more read `1.23M` (same 2 decimals).
 */
export function formatMeasure(
  value: number | null | undefined,
  options: { compact?: boolean } = {}
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  const abs = Math.abs(value)
  const digits = abs >= 1000 ? 2 : abs >= 1 ? 3 : 4
  return measureFormat(digits, options.compact === true && abs >= COMPACT_FROM).format(value)
}

/** Legend value (`formatMeasure` without compact notation). */
export function formatReadout(value: number | null | undefined): string {
  return formatMeasure(value)
}

const measureFormats = new Map<string, Intl.NumberFormat>()

function measureFormat(digits: number, compact: boolean): Intl.NumberFormat {
  const key = `${digits}:${compact}`
  let format = measureFormats.get(key)
  if (!format) {
    format = new Intl.NumberFormat(undefined, {
      maximumFractionDigits: digits,
      notation: compact ? 'compact' : 'standard'
    })
    measureFormats.set(key, format)
  }
  return format
}

/** Readout time: `HH:mm:ss.SSS`, prefixed with the date when it is not today. */
export function formatReadoutTime(ms: number, now = Date.now()): string {
  const clock = formatClock(ms, true)
  return formatDate(ms) === formatDate(now) ? clock : `${formatDate(ms)} ${clock}`
}
