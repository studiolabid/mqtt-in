/** Token kinds of the inline JSON highlighter (`plain` = whitespace / unknown text). */
export type JsonTokenKind = 'key' | 'string' | 'number' | 'bool' | 'null' | 'punct' | 'plain'

export interface JsonToken {
  kind: JsonTokenKind
  text: string
}

/** Only this many characters are tokenized; the rest is appended as plain text. */
export const JSON_INLINE_MAX = 300

const NUMBER = /-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/y
const WORD_CHAR = /[A-Za-z0-9_$]/
const PUNCT = new Set(['{', '}', '[', ']', ',', ':'])
const KEYWORDS: ReadonlyArray<[string, JsonTokenKind]> = [
  ['true', 'bool'],
  ['false', 'bool'],
  ['null', 'null']
]

/** True when the text starts (after whitespace) with `{` or `[`. */
export function isJsonLike(text: string): boolean {
  const first = text.trimStart()[0]
  return first === '{' || first === '['
}

/**
 * Very cheap, forgiving tokenizer for one-line JSON previews. Tolerates truncated input
 * (unterminated strings, a trailing `…`) and never throws. Adjacent tokens of the same kind
 * are merged to keep the DOM small.
 */
export function tokenizeJsonInline(text: string, max = JSON_INLINE_MAX): JsonToken[] {
  const head = text.length > max ? text.slice(0, max) : text
  const tokens: JsonToken[] = []
  const push = (kind: JsonTokenKind, value: string): void => {
    const last = tokens[tokens.length - 1]
    if (last && last.kind === kind) last.text += value
    else tokens.push({ kind, text: value })
  }

  let i = 0
  while (i < head.length) {
    const ch = head[i]
    if (ch === '"') {
      const end = stringEnd(head, i)
      let next = end
      while (next < head.length && (head[next] === ' ' || head[next] === '\t')) next++
      push(head[next] === ':' ? 'key' : 'string', head.slice(i, end))
      i = end
      continue
    }
    if (PUNCT.has(ch)) {
      push('punct', ch)
      i++
      continue
    }
    if (ch === '-' || (ch >= '0' && ch <= '9')) {
      NUMBER.lastIndex = i
      const match = NUMBER.exec(head)
      if (match) {
        push('number', match[0])
        i += match[0].length
        continue
      }
    }
    const keyword = keywordAt(head, i)
    if (keyword) {
      push(keyword[1], keyword[0])
      i += keyword[0].length
      continue
    }
    push('plain', ch)
    i++
  }
  if (text.length > max) push('plain', text.slice(max))
  return tokens
}

/** Index just past the closing quote of the string starting at `start` (or the end of input). */
function stringEnd(text: string, start: number): number {
  let i = start + 1
  while (i < text.length) {
    if (text[i] === '\\') i += 2
    else if (text[i] === '"') return i + 1
    else i++
  }
  return text.length
}

function keywordAt(text: string, i: number): [string, JsonTokenKind] | null {
  for (const entry of KEYWORDS) {
    const word = entry[0]
    if (text.startsWith(word, i) && !WORD_CHAR.test(text[i + word.length] ?? '')) return entry
  }
  return null
}
