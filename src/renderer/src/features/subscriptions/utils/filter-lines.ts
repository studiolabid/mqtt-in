/**
 * Topic filter text helpers (pure): parsing the "Add multiple" input, wildcard insertion and the
 * examples offered by the subscription dialog.
 */
import { validateTopicFilter } from '@shared/topic'

export type WildcardToken = '+' | '#'

export const WILDCARDS: ReadonlyArray<{ token: WildcardToken; label: string; hint: string }> = [
  { token: '+', label: 'Single-level wildcard', hint: 'Matches exactly one topic level' },
  { token: '#', label: 'Multi-level wildcard', hint: 'Matches all remaining levels (last only)' }
]

export const FILTER_EXAMPLES: ReadonlyArray<{ filter: string; description: string }> = [
  { filter: '#', description: 'Everything (except $SYS topics)' },
  { filter: 'sensors/+/temperature', description: 'One level wildcard' },
  { filter: '$SYS/#', description: 'Broker statistics' },
  { filter: '$share/group/topic', description: 'Shared: messages are split across the group' }
]

export interface InvalidFilterLine {
  /** 1-based line number. */
  line: number
  filter: string
  error: string
}

export interface ParsedFilterLines {
  /** New, valid filters in input order (trimmed, repeats dropped). */
  filters: string[]
  /** Valid filters that already exist on the connection (skipped). */
  existing: string[]
  /** The first invalid line, if any. */
  invalid: InvalidFilterLine | null
}

/** One filter per line; blank lines and repeated lines are ignored. */
export function parseFilterLines(text: string, existing: ReadonlySet<string>): ParsedFilterLines {
  const result: ParsedFilterLines = { filters: [], existing: [], invalid: null }
  const seen = new Set<string>()
  text.split(/\r?\n/).forEach((raw, index) => {
    const filter = raw.trim()
    if (filter.length === 0 || seen.has(filter)) return
    seen.add(filter)
    const error = validateTopicFilter(filter)
    if (error) result.invalid ??= { line: index + 1, filter, error }
    else if (existing.has(filter)) result.existing.push(filter)
    else result.filters.push(filter)
  })
  return result
}

/** The first non-blank line, trimmed (switching from multiple filters back to one). */
export function firstLine(text: string): string {
  return (
    text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.length > 0) ?? ''
  )
}

/** `[start, end)` offsets of a 1-based line, for selecting it in a textarea. */
export function lineRange(text: string, line: number): [number, number] {
  let start = 0
  for (let current = 1; current < line; current++) {
    const newline = text.indexOf('\n', start)
    if (newline === -1) return [text.length, text.length]
    start = newline + 1
  }
  const newline = text.indexOf('\n', start)
  let end = newline === -1 ? text.length : newline
  if (end > start && text[end - 1] === '\r') end--
  return [start, end]
}

export interface TextEdit {
  value: string
  /** Caret position after the edit. */
  caret: number
}

function isBoundary(char: string | undefined): boolean {
  return char === undefined || char === '/' || char === '\n'
}

/**
 * Replaces the selection with a wildcard level, adding `/` separators where needed:
 * `sensors|` + `#` → `sensors/#`, `a/|/c` + `+` → `a/+/c`, `a|b` + `+` → `a/+/b`.
 */
export function insertWildcard(
  value: string,
  start: number,
  end: number,
  token: WildcardToken
): TextEdit {
  const before = value.slice(0, start)
  const after = value.slice(end)
  const lead = isBoundary(before.at(-1)) ? '' : '/'
  const trail = isBoundary(after.at(0)) ? '' : '/'
  return {
    value: `${before}${lead}${token}${trail}${after}`,
    caret: before.length + lead.length + token.length
  }
}

/** Appends `line` as a new last line (trailing blank lines are dropped). */
export function appendLine(text: string, line: string): TextEdit {
  const base = text.replace(/\s+$/, '')
  const value = base.length > 0 ? `${base}\n${line}` : line
  return { value, caret: value.length }
}
