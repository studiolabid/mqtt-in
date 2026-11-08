/**
 * Settings-aware display formatters (timestamps follow `timestampFormat` / `showMilliseconds`).
 * Calling them inside a template or computed tracks the settings.
 */
import { useSettingsStore } from '@/stores/settings'
import {
  formatBytes,
  formatClock,
  formatCompact,
  formatDate,
  formatDuration,
  formatNumber,
  formatRate,
  formatRelative,
  formatTimestamp
} from '@/utils/format'

export interface Formatters {
  /** Message timestamp in the user's format (time, date + time or relative). */
  time(ts: number): string
  /** `HH:mm:ss(.SSS)` (milliseconds per settings). */
  clock(ts: number): string
  /** `YYYY-MM-DD`. */
  date(ts: number): string
  /** `1.5 KB`. */
  bytes(n: number): string
  /** Localized integer, `12,345`. */
  number(n: number): string
  /** `1.2K`, `3.4M` (below 10 000 like `number`). */
  compact(n: number): string
  /** `340/s`. */
  rate(perSecond: number): string
  /** `12s ago` (pass `now` to re-render on a clock). */
  relative(ts: number, now?: number): string
  /** `1:02:03` uptime. */
  duration(ms: number): string
}

export function useFormatters(): Formatters {
  const store = useSettingsStore()
  return {
    time: (ts) =>
      formatTimestamp(ts, store.settings.timestampFormat, store.settings.showMilliseconds),
    clock: (ts) => formatClock(ts, store.settings.showMilliseconds),
    date: (ts) => formatDate(ts),
    bytes: (n) => formatBytes(n),
    number: (n) => formatNumber(n),
    compact: (n) => formatCompact(n),
    rate: (perSecond) => formatRate(perSecond),
    relative: (ts, now) => formatRelative(ts, now),
    duration: (ms) => formatDuration(ms)
  }
}
