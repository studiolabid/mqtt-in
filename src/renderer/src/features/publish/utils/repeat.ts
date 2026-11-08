/**
 * Repeat publishing helpers: interval units, labels, validation and summaries (pure).
 */
import type { RepeatJobEvent } from '@shared/models'
import { LIMITS } from '@shared/defaults'
import { formatNumber } from '@/utils/format'

export type IntervalUnit = 'ms' | 's' | 'min'

export const INTERVAL_UNITS: readonly { value: IntervalUnit; label: string; factor: number }[] = [
  { value: 'ms', label: 'ms', factor: 1 },
  { value: 's', label: 's', factor: 1_000 },
  { value: 'min', label: 'min', factor: 60_000 }
]

export const INTERVAL_PRESETS: readonly number[] = [100, 500, 1_000, 5_000, 60_000]

export function isIntervalUnit(value: unknown): value is IntervalUnit {
  return INTERVAL_UNITS.some((unit) => unit.value === value)
}

export function toIntervalMs(value: number, unit: IntervalUnit): number {
  const factor = INTERVAL_UNITS.find((u) => u.value === unit)?.factor ?? 1
  return Math.round(value * factor)
}

/** The largest unit that expresses `ms` exactly: 60000 → 1 min, 1500 → 1500 ms. */
export function splitInterval(ms: number): { value: number; unit: IntervalUnit } {
  if (ms >= 60_000 && ms % 60_000 === 0) return { value: ms / 60_000, unit: 'min' }
  if (ms >= 1_000 && ms % 1_000 === 0) return { value: ms / 1_000, unit: 's' }
  return { value: ms, unit: 'ms' }
}

const trimmed = (value: number): string => String(Number(value.toFixed(2)))

/** `250 ms`, `1 s`, `1.5 s`, `2 min`. */
export function formatInterval(ms: number): string {
  if (ms < 1_000) return `${trimmed(ms)} ms`
  if (ms < 60_000) return `${trimmed(ms / 1_000)} s`
  return `${trimmed(ms / 60_000)} min`
}

/** `23 / 100` (or `23` for jobs that run until stopped). */
export function repeatCount(job: Pick<RepeatJobEvent, 'sent' | 'total'>): string {
  return job.total > 0
    ? `${formatNumber(job.sent)} / ${formatNumber(job.total)}`
    : formatNumber(job.sent)
}

/** `Every 1 s · 23 / 100 sent` (or `Every 1 s · 23 sent`). */
export function repeatLabel(job: Pick<RepeatJobEvent, 'sent' | 'total' | 'intervalMs'>): string {
  return `Every ${formatInterval(job.intervalMs)} · ${repeatCount(job)} sent`
}

export interface RepeatErrors {
  interval?: string
  count?: string
}

export function validateRepeat(intervalMs: number, count: number): RepeatErrors {
  const { min, max } = LIMITS.repeatIntervalMs
  const errors: RepeatErrors = {}
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) errors.interval = 'Enter an interval'
  else if (intervalMs < min) errors.interval = `At least ${min} ms`
  else if (intervalMs > max) errors.interval = 'At most 24 hours'
  if (!Number.isSafeInteger(count) || count < 0) errors.count = 'A whole number (0 = until stopped)'
  return errors
}

/** `42 s`, `3 min 20 s`, `2 h 5 min`. */
export function humanDuration(ms: number): string {
  const seconds = Math.round(ms / 1_000)
  if (seconds < 1) return 'under a second'
  if (seconds < 60) return `${seconds} s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return seconds % 60 ? `${minutes} min ${seconds % 60} s` : `${minutes} min`
  const hours = Math.floor(minutes / 60)
  return minutes % 60 ? `${hours} h ${minutes % 60} min` : `${hours} h`
}

/** `≈ 2 msg/s until stopped` or `100 messages, done in ≈ 1 min 39 s`. */
export function repeatSummary(intervalMs: number, count: number): string {
  if (count === 0) {
    const perSecond = 1_000 / intervalMs
    const rate =
      perSecond >= 1 ? `${trimmed(perSecond)} msg/s` : `${trimmed(perSecond * 60)} msg/min`
    return `≈ ${rate} until stopped`
  }
  if (count === 1) return 'One message, sent right away'
  return `${formatNumber(count)} messages, done in ≈ ${humanDuration((count - 1) * intervalMs)}`
}
