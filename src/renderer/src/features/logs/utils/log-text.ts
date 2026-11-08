/**
 * Plain-text rendering of log entries (copy to clipboard, `.log` export). Pure, no Vue.
 */
import type { LogEntry, LogLevel } from '@shared/models'
import { formatClock, formatDate } from '@/utils/format'

/** Display names of the log levels. */
export const LOG_LEVEL_LABELS: Readonly<Record<LogLevel, string>> = {
  debug: 'Debug',
  info: 'Info',
  warn: 'Warn',
  error: 'Error'
}

/** `2026-11-08 14:03:12.345` (always with milliseconds: exports must be precise). */
export function logTimestamp(ts: number): string {
  return `${formatDate(ts)} ${formatClock(ts, true)}`
}

/**
 * One entry as text: `2026-11-08 14:03:12.345  INFO   Connected`, followed by the detail on
 * indented lines when there is one.
 */
export function logEntryToText(entry: LogEntry): string {
  const head = `${logTimestamp(entry.timestamp)}  ${entry.level.toUpperCase().padEnd(5)}  ${entry.message}`
  if (!entry.detail) return head
  const detail = entry.detail
    .split(/\r?\n/)
    .map((line) => `    ${line}`)
    .join('\n')
  return `${head}\n${detail}`
}

/** Entries as text (one per line, oldest first), optionally preceded by header lines. */
export function logEntriesToText(
  entries: readonly LogEntry[],
  header: readonly string[] = []
): string {
  const lines = [...header.map((line) => `# ${line}`), ...entries.map(logEntryToText)]
  return lines.length > 0 ? `${lines.join('\n')}\n` : ''
}
