/**
 * Case-insensitive search highlighting (pure): match ranges and text parts. Nothing is marked
 * when lower-casing changes the length of the text or of a term (some rare scripts), because
 * the marks would be misaligned.
 */

export interface TextPart {
  text: string
  /** Part of a match. */
  match: boolean
}

function normalizeTerms(terms: string | readonly string[]): string[] {
  const list = typeof terms === 'string' ? [terms] : terms
  const out: string[] = []
  for (const term of list) {
    const trimmed = term.trim()
    const lower = trimmed.toLowerCase()
    if (lower.length > 0 && lower.length === trimmed.length) out.push(lower)
  }
  return out
}

/**
 * Sorted, non-overlapping `[start, end)` ranges of the case-insensitive occurrences of the
 * (trimmed) terms in `text`. Each term is scanned left to right without overlaps; overlapping
 * matches of different terms merge.
 */
export function matchRanges(
  text: string,
  terms: string | readonly string[]
): Array<[number, number]> {
  const needles = normalizeTerms(terms)
  const haystack = text.toLowerCase()
  if (needles.length === 0 || haystack.length !== text.length) return []
  const found: Array<[number, number]> = []
  for (const needle of needles) {
    let at = haystack.indexOf(needle)
    while (at !== -1) {
      found.push([at, at + needle.length])
      at = haystack.indexOf(needle, at + needle.length)
    }
  }
  found.sort((a, b) => a[0] - b[0])
  const merged: Array<[number, number]> = []
  for (const range of found) {
    const last = merged[merged.length - 1]
    if (last && range[0] < last[1]) last[1] = Math.max(last[1], range[1])
    else merged.push([range[0], range[1]])
  }
  return merged
}

/**
 * `text` split into matching and non-matching parts (at least one part). After `maxMarks`
 * matches the rest of the text stays unmarked.
 */
export function highlightParts(
  text: string,
  terms: string | readonly string[],
  maxMarks = Number.POSITIVE_INFINITY
): TextPart[] {
  const ranges = matchRanges(text, terms).slice(0, maxMarks)
  if (ranges.length === 0) return [{ text, match: false }]
  const parts: TextPart[] = []
  let from = 0
  for (const [start, end] of ranges) {
    if (start > from) parts.push({ text: text.slice(from, start), match: false })
    parts.push({ text: text.slice(start, end), match: true })
    from = end
  }
  if (from < text.length) parts.push({ text: text.slice(from), match: false })
  return parts
}

/** True when `term` (trimmed, case-insensitive) occurs in `text`. */
export function containsTerm(text: string, term: string): boolean {
  const needle = term.trim().toLowerCase()
  return needle !== '' && text.toLowerCase().includes(needle)
}
