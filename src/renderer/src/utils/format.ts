/**
 * Display formatting helpers (pure). Settings-aware variants live in
 * `@/composables/useFormatters`.
 */
import type { TimestampFormat } from '@shared/models'

const numberFormat = new Intl.NumberFormat()
const compactFormat = new Intl.NumberFormat(undefined, {
  notation: 'compact',
  maximumFractionDigits: 1
})

export function formatNumber(value: number): string {
  return numberFormat.format(value)
}

/** 1.2K, 3.4M … */
/** `1 message`, `1,234 messages` (English plural with an `s`, locale-grouped count). */
export function formatCount(count: number, word: string): string {
  return `${formatNumber(count)} ${word}${count === 1 ? '' : 's'}`
}

export function formatCompact(value: number): string {
  return value < 10_000 ? numberFormat.format(value) : compactFormat.format(value)
}

const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB']

/** 0 B, 512 B, 1.5 KB, 12 MB … (1024 based). */
export function formatBytes(bytes: number, decimals = 1): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const exp = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), BYTE_UNITS.length - 1)
  const value = bytes / 1024 ** exp
  return `${exp === 0 ? value : value.toFixed(value >= 100 ? 0 : decimals)} ${BYTE_UNITS[exp]}`
}

/** 1.2/s, 340/s, 0/s */
export function formatRate(perSecond: number): string {
  if (perSecond <= 0) return '0/s'
  if (perSecond < 10) return `${perSecond.toFixed(1)}/s`
  return `${formatCompact(Math.round(perSecond))}/s`
}

const pad = (n: number, width = 2): string => String(n).padStart(width, '0')

export function formatClock(ts: number, withMs = true): string {
  const d = new Date(ts)
  const base = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  return withMs ? `${base}.${pad(d.getMilliseconds(), 3)}` : base
}

export function formatDate(ts: number): string {
  const d = new Date(ts)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** "just now", "12s ago", "5m ago", "3h ago", "2d ago" (or a date beyond 30 days). */
export function formatRelative(ts: number, now = Date.now()): string {
  const diff = Math.max(0, now - ts)
  const s = Math.floor(diff / 1000)
  if (s < 5) return 'just now'
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const days = Math.floor(h / 24)
  if (days <= 30) return `${days}d ago`
  return formatDate(ts)
}

export function formatTimestamp(ts: number, format: TimestampFormat, withMs: boolean): string {
  switch (format) {
    case 'time':
      return formatClock(ts, withMs)
    case 'datetime':
      return `${formatDate(ts)} ${formatClock(ts, withMs)}`
    case 'relative':
      return formatRelative(ts)
  }
}

/** 0:42, 12:03, 1:02:03 — for uptimes. */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
}

/** Platform-aware modifier label for shortcuts. */
export function modKey(platform: string): string {
  return platform === 'darwin' ? '⌘' : 'Ctrl'
}
