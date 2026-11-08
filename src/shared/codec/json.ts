/**
 * JSON helpers: parsing without throwing, re-indenting authored JSON without re-serializing its
 * values (big integers, number literals, escapes, key order and duplicate keys stay as written),
 * and the display JSON of values decoded from binary codecs. The low-level scanner functions
 * are shared with `./exact-json`.
 */
import { ExtData } from '@msgpack/msgpack'
import { toHex } from './bytes'
import { errorMessage, PayloadError } from './errors'

export type JsonParseResult = { ok: true; value: unknown } | { ok: false; error: string }

/** `JSON.parse` without throwing. */
export function tryParseJson(text: string): JsonParseResult {
  try {
    return { ok: true, value: JSON.parse(text) }
  } catch (err) {
    return { ok: false, error: errorMessage(err) }
  }
}

export const QUOTE = 0x22
export const COMMA = 0x2c
export const COLON = 0x3a
export const OPEN_BRACKET = 0x5b
export const CLOSE_BRACKET = 0x5d
export const OPEN_BRACE = 0x7b
export const CLOSE_BRACE = 0x7d

export function isJsonWhitespace(code: number): boolean {
  return code === 0x20 || code === 0x0a || code === 0x0d || code === 0x09
}

/** Characters of number / true / false / null literals: 0-9 a-z E + - . */
export function isJsonLiteralChar(code: number): boolean {
  return (
    (code >= 0x30 && code <= 0x39) ||
    (code >= 0x61 && code <= 0x7a) ||
    code === 0x45 ||
    code === 0x2b ||
    code === 0x2d ||
    code === 0x2e
  )
}

/** Index just past the JSON string literal whose opening quote is at `start`. */
export function endOfJsonString(text: string, start: number): number {
  let from = start + 1
  for (;;) {
    const quote = text.indexOf('"', from)
    if (quote === -1) return text.length
    let backslashes = 0
    while (text[quote - 1 - backslashes] === '\\') backslashes++
    if (backslashes % 2 === 0) return quote + 1
    from = quote + 1
  }
}

/**
 * Re-indents *valid* JSON text without re-serializing its values, so big integers, number
 * literals (`1.50`), string escapes, key order and duplicate keys stay exactly as written.
 * Same layout as `JSON.stringify(value, null, indent)`; `indent` 0 minifies.
 */
export function reindentJson(text: string, indent: number): string {
  const unit = ' '.repeat(Math.min(10, Math.max(0, Math.floor(indent))))
  const breaks: string[] = []
  const lineBreak = (depth: number): string =>
    unit ? (breaks[depth] ??= `\n${unit.repeat(depth)}`) : ''
  const colon = unit ? ': ' : ':'
  let out = ''
  let depth = 0
  let i = 0
  while (i < text.length) {
    const code = text.charCodeAt(i)
    if (code === QUOTE) {
      const end = endOfJsonString(text, i)
      out += text.slice(i, end)
      i = end
    } else if (code === OPEN_BRACE || code === OPEN_BRACKET) {
      let next = i + 1
      while (isJsonWhitespace(text.charCodeAt(next))) next++
      if (text.charCodeAt(next) === (code === OPEN_BRACE ? CLOSE_BRACE : CLOSE_BRACKET)) {
        out += text[i] + text[next] // empty container stays on one line
        i = next + 1
      } else {
        out += text[i] + lineBreak(++depth)
        i++
      }
    } else if (code === CLOSE_BRACE || code === CLOSE_BRACKET) {
      out += lineBreak(--depth) + text[i]
      i++
    } else if (code === COMMA) {
      out += `,${lineBreak(depth)}`
      i++
    } else if (code === COLON) {
      out += colon
      i++
    } else if (isJsonWhitespace(code)) {
      i++
    } else {
      // number / true / false / null: copy the whole literal at once
      let end = i + 1
      while (end < text.length && isJsonLiteralChar(text.charCodeAt(end))) end++
      out += text.slice(i, end)
      i = end
    }
  }
  return out
}

/** Pretty prints JSON text, keeping values exactly as written. Throws PayloadError when invalid. */
export function formatJson(text: string, indent = 2): string {
  const parsed = tryParseJson(text)
  if (!parsed.ok) throw new PayloadError(`Invalid JSON: ${parsed.error}`)
  return reindentJson(text, indent)
}

/** Minifies JSON text, keeping values exactly as written. Throws PayloadError when invalid. */
export function minifyJson(text: string): string {
  const parsed = tryParseJson(text)
  if (!parsed.ok) throw new PayloadError(`Invalid JSON: ${parsed.error}`)
  return reindentJson(text, 0)
}

/** Map keys become object keys: byte strings as hex, anything else through `String()`. */
function displayKey(key: unknown): string {
  return key instanceof Uint8Array ? `0x${toHex(key, '')}` : String(key)
}

/** The bare text of a number JSON.stringify cannot show faithfully, or null when it can. */
function bareNumber(value: unknown): string | null {
  if (typeof value === 'bigint') return Number.isSafeInteger(Number(value)) ? null : String(value)
  if (typeof value !== 'number') return null
  if (Number.isNaN(value)) return 'NaN'
  if (value === Infinity) return 'Infinity'
  if (value === -Infinity) return '-Infinity'
  return Object.is(value, -0) ? '-0' : null
}

/**
 * JSON.stringify that survives binary / bigint / Map / Set / Date / ExtData values from binary
 * codecs. Pass `indent` 0 for compact output (`undefined` selects the default of 2).
 *
 * Numbers are shown as they are (display only, so not always valid JSON): `NaN`, `Infinity`,
 * `-Infinity`, `-0` and integers beyond 2^53 as bare digits (`18446744073709551615`), where
 * JSON.stringify would print null, 0 or nothing. They pass JSON.stringify as unique
 * placeholder strings that are swapped for the bare text afterwards.
 */
export function toDisplayJson(value: unknown, indent: number | undefined = 2): string {
  const bare: string[] = []
  const tag = `__mqtey_${Math.random().toString(36).slice(2, 12)}_`
  const json =
    JSON.stringify(
      value,
      function (this: unknown, _key, val: unknown) {
        const text = bareNumber(val)
        if (text !== null) return `${tag}${bare.push(text) - 1}__`
        if (typeof val === 'bigint') return Number(val)
        if (val instanceof Uint8Array) return `0x${toHex(val, '')}`
        if (val instanceof ExtData) {
          const data = val.data instanceof Uint8Array ? val.data : new Uint8Array(0)
          return { $ext: val.type, data: `0x${toHex(data, '')}` }
        }
        if (val instanceof Map) {
          return Object.fromEntries(Array.from(val, ([k, v]) => [displayKey(k), v]))
        }
        if (val instanceof Set) return Array.from(val)
        if (val === undefined) return null
        return val
      },
      indent
    ) ?? 'null'
  if (bare.length === 0) return json
  const placeholder = new RegExp(`"${tag}(\\d+)__"`, 'g')
  return json.replace(placeholder, (match, index: string) => bare[Number(index)] ?? match)
}

export function looksLikeJson(text: string): boolean {
  const t = text.trimStart()
  return t.startsWith('{') || t.startsWith('[')
}
