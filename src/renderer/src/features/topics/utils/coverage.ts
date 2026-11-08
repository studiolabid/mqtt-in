/**
 * How much of a chart window the data really covers (PERF-05; pure, no Vue).
 *
 * A topic chart is drawn from the topic's messages still in the message buffer, at most
 * `HISTORY_LIMIT` of them. On a busy topic (or a busy connection that evicts the buffer) that
 * can be far less than the selected window, and the statistics then describe only that span.
 * The coverage says so, but only when older messages really existed: a topic that started
 * publishing 30 s ago covers a 15 minute window completely.
 */

/** Why older messages are missing: the chart's point cap, or the buffer's eviction. */
export type CoverageLimit = 'points' | 'buffer'

export interface ChartCoverage {
  /** First to last timestamp of the data, in ms (0 with fewer than two messages). */
  coverageMs: number
  /** Why older messages are missing; null when the data is complete. */
  limit: CoverageLimit | null
  /** The selected window reaches beyond what the data covers (`limit` is set). */
  partial: boolean
}

export interface CoverageInput {
  /** The charted messages, oldest first. */
  history: ReadonlyArray<{ timestamp: number }>
  /** Messages received on the topic in total, evicted ones included (the topic tree's count). */
  received: number
  /** Most messages the chart reads (`HISTORY_LIMIT`). */
  pointLimit: number
  windowMs: number
}

/** The span between two timestamps (never negative). */
export function coverageMs(first: number, last: number): number {
  return Math.max(0, last - first)
}

export function chartCoverage(input: CoverageInput): ChartCoverage {
  const { history } = input
  const span =
    history.length > 1 ? coverageMs(history[0].timestamp, history[history.length - 1].timestamp) : 0
  const dropped = input.received > history.length
  const limit: CoverageLimit | null = !dropped
    ? null
    : history.length >= input.pointLimit
      ? 'points'
      : 'buffer'
  return { coverageMs: span, limit, partial: limit !== null && span < input.windowMs }
}

/** `0.4 s`, `4.8 s`, `40 s`, `2.5 min`, `12 min`, `2 h`, `2 h 5 min`. */
export function formatSpan(ms: number): string {
  const value = Math.max(0, ms)
  if (value < 10_000) return `${(value / 1000).toFixed(1)} s`
  if (value < 60_000) return `${Math.round(value / 1000)} s`
  if (value < 600_000) return `${(value / 60_000).toFixed(1)} min`
  if (value < 3_600_000) return `${Math.round(value / 60_000)} min`
  const hours = Math.floor(value / 3_600_000)
  const minutes = Math.round((value % 3_600_000) / 60_000)
  return minutes > 0 ? `${hours} h ${minutes} min` : `${hours} h`
}

/**
 * The note above a partial chart, e.g. 'Showing the last 4.8 s — older messages were dropped
 * from the buffer (limit 10,000)' or '… — the chart keeps the last 2,000 points'.
 */
export function coverageNote(
  coverage: ChartCoverage,
  limits: { buffer: number; points: number }
): string | null {
  if (!coverage.partial || coverage.limit === null) return null
  const span = `Showing the last ${formatSpan(coverage.coverageMs)}`
  return coverage.limit === 'points'
    ? `${span} — the chart keeps the last ${limits.points.toLocaleString('en-US')} points`
    : `${span} — older messages were dropped from the buffer (limit ${limits.buffer.toLocaleString('en-US')})`
}

/** A window button's label, with the covered span when the data is shorter: `15m (4.8 s)`. */
export function windowLabel(label: string, windowMs: number, coverage: ChartCoverage): string {
  return coverage.limit !== null && coverage.coverageMs < windowMs
    ? `${label} (${formatSpan(coverage.coverageMs)})`
    : label
}
