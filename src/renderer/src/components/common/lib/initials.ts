const WORD_SEPARATOR = /[^\p{L}\p{N}]+/u

let segmenter: Intl.Segmenter | null | undefined

function graphemes(text: string): string[] {
  if (segmenter === undefined) {
    segmenter =
      typeof Intl !== 'undefined' && 'Segmenter' in Intl
        ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
        : null
  }
  return segmenter ? Array.from(segmenter.segment(text), (s) => s.segment) : Array.from(text)
}

/**
 * Up to two upper-case initials for an avatar: the first letters of the first two words
 * (`Home Assistant` → `HA`, `test.mosquitto.org` → `TM`), else the first two characters
 * (`localhost` → `LO`). Returns `?` for blank names.
 */
export function initials(name: string): string {
  const trimmed = name.trim()
  if (trimmed.length === 0) return '?'
  const words = trimmed.split(WORD_SEPARATOR).filter((word) => word.length > 0)
  const picked =
    words.length >= 2
      ? `${graphemes(words[0])[0]}${graphemes(words[1])[0]}`
      : graphemes(words[0] ?? trimmed)
          .slice(0, 2)
          .join('')
  return picked.toLocaleUpperCase()
}
