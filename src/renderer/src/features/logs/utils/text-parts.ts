/**
 * JSON detail formatting for log rows (search highlighting: `@/utils/highlight`). Pure, no Vue.
 */

export type DetailTokenKind = 'key' | 'string' | 'number' | 'bool' | 'null' | 'punct' | 'plain'

export interface DetailToken {
  kind: DetailTokenKind
  text: string
}

export interface FormattedDetail {
  text: string
  /** True when `text` is pretty-printed JSON. */
  json: boolean
}

/** Larger details are shown as they are (pretty-printing them is not worth the cost). */
const MAX_PRETTY_CHARS = 50_000

/** Pretty-prints JSON details (two-space indent); any other text is returned unchanged. */
export function formatDetail(detail: string): FormattedDetail {
  const trimmed = detail.trim()
  const first = trimmed.charAt(0)
  if ((first !== '{' && first !== '[') || trimmed.length > MAX_PRETTY_CHARS) {
    return { text: detail, json: false }
  }
  try {
    return { text: JSON.stringify(JSON.parse(trimmed), null, 2), json: true }
  } catch {
    return { text: detail, json: false }
  }
}

const JSON_TOKEN =
  /("(?:[^"\\\n]|\\.)*")(\s*:)?|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|\b(true|false)\b|\b(null)\b|([{}[\],:])/g

/**
 * Syntax tokens of JSON text (as produced by `formatDetail`). Adjacent tokens of the same kind
 * are merged; whitespace and anything unexpected become `plain`.
 */
export function tokenizeJson(text: string): DetailToken[] {
  const tokens: DetailToken[] = []
  const push = (kind: DetailTokenKind, value: string): void => {
    if (!value) return
    const last = tokens[tokens.length - 1]
    if (last && last.kind === kind) last.text += value
    else tokens.push({ kind, text: value })
  }
  let index = 0
  for (const match of text.matchAll(JSON_TOKEN)) {
    const at = match.index ?? 0
    push('plain', text.slice(index, at))
    const [whole, str, colon, num, bool, nil] = match
    if (str !== undefined) {
      push(colon === undefined ? 'string' : 'key', str)
      if (colon !== undefined) push('punct', colon)
    } else if (num !== undefined) push('number', num)
    else if (bool !== undefined) push('bool', bool)
    else if (nil !== undefined) push('null', nil)
    else push('punct', whole)
    index = at + whole.length
  }
  push('plain', text.slice(index))
  return tokens
}
