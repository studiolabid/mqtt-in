import { matchRanges } from '@/utils/highlight'

/** Visual role of a piece of a topic. */
export type TopicPartKind = 'text' | 'separator' | 'wildcard'

export interface TopicPart {
  text: string
  kind: TopicPartKind
  /** Part of a case-insensitive `highlight` match. */
  highlighted: boolean
}

interface Run {
  text: string
  kind: TopicPartKind
  start: number
}

/** Splits a topic into level text, `/` separators and whole-level `+` / `#` wildcards. */
function toRuns(topic: string): Run[] {
  const runs: Run[] = []
  let pos = 0
  topic.split('/').forEach((level, index) => {
    if (index > 0) {
      runs.push({ text: '/', kind: 'separator', start: pos })
      pos += 1
    }
    if (level.length > 0) {
      const kind: TopicPartKind = level === '+' || level === '#' ? 'wildcard' : 'text'
      runs.push({ text: level, kind, start: pos })
      pos += level.length
    }
  })
  return runs
}

/**
 * Segments a topic (name or filter) for display: separators, wildcards and highlighted
 * substrings become separate parts so each can be styled.
 */
export function segmentTopic(topic: string, highlight = ''): TopicPart[] {
  const runs = toRuns(topic)
  const ranges = matchRanges(topic, highlight.trim())
  if (ranges.length === 0) return runs.map(({ text, kind }) => ({ text, kind, highlighted: false }))

  const parts: TopicPart[] = []
  let r = 0
  for (const run of runs) {
    const runEnd = run.start + run.text.length
    let cursor = run.start
    while (r < ranges.length && ranges[r][1] <= cursor) r++
    let k = r
    while (cursor < runEnd) {
      const range = ranges[k]
      if (!range || range[0] >= runEnd) {
        parts.push({ text: topic.slice(cursor, runEnd), kind: run.kind, highlighted: false })
        break
      }
      if (range[0] > cursor) {
        parts.push({ text: topic.slice(cursor, range[0]), kind: run.kind, highlighted: false })
        cursor = range[0]
      }
      const end = Math.min(range[1], runEnd)
      parts.push({ text: topic.slice(cursor, end), kind: run.kind, highlighted: true })
      cursor = end
      if (range[1] <= runEnd) k++
    }
  }
  return parts
}
