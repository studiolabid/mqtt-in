/**
 * Log entry helpers for the log panel (pure, no Vue).
 */
import type { LogEntry, LogLevel } from '@shared/models'

/** Levels from the most to the least verbose. */
export const LOG_LEVELS: readonly LogLevel[] = ['debug', 'info', 'warn', 'error']

const RANK: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 }

/** Numeric severity (debug 0 … error 3). */
export function logLevelRank(level: LogLevel): number {
  return RANK[level]
}

export interface LogFilter {
  /** Only these levels (all when omitted or empty). */
  levels?: readonly LogLevel[]
  /** Only entries at least this severe. */
  minLevel?: LogLevel
  /** Case-insensitive substring of the message or detail. */
  search?: string
}

/** Entries matching `filter`, in their original order. Returns `entries` when nothing filters. */
export function filterLogEntries(
  entries: readonly LogEntry[],
  filter: LogFilter
): readonly LogEntry[] {
  const levels = filter.levels && filter.levels.length > 0 ? new Set(filter.levels) : null
  const minRank = filter.minLevel ? RANK[filter.minLevel] : 0
  const term = filter.search?.trim().toLowerCase() ?? ''
  if (!levels && minRank === 0 && !term) return entries
  return entries.filter(
    (entry) =>
      (!levels || levels.has(entry.level)) &&
      RANK[entry.level] >= minRank &&
      (!term ||
        entry.message.toLowerCase().includes(term) ||
        (entry.detail?.toLowerCase().includes(term) ?? false))
  )
}

/** Number of entries per level. */
export function countLogLevels(entries: readonly LogEntry[]): Record<LogLevel, number> {
  const counts: Record<LogLevel, number> = { debug: 0, info: 0, warn: 0, error: 0 }
  for (const entry of entries) counts[entry.level]++
  return counts
}
