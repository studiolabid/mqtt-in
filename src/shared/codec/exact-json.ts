/**
 * JSON parsing that keeps integers exact, for MessagePack / CBOR authoring. `JSON.parse` rounds
 * an integer literal beyond 2^53 to the nearest double (12345678901234567890 becomes
 * 12345678901234567000); here such literals become bigints, which the binary codecs write as
 * exact 64-bit integers (or CBOR bignums). Every other value is exactly what `JSON.parse` gives,
 * -0 included.
 *
 * Engine independent (no `JSON.parse` source-text access needed): when the text holds a run of
 * 16+ digits, a linear scan of the (already validated) text finds the unsafe integer literals
 * and their paths; duplicate keys follow `JSON.parse` (the last one wins).
 */
import {
  CLOSE_BRACE,
  CLOSE_BRACKET,
  COMMA,
  endOfJsonString,
  isJsonLiteralChar,
  OPEN_BRACE,
  OPEN_BRACKET,
  QUOTE
} from './json'

/** An integer per the JSON grammar (no fraction, no exponent). */
const INTEGER_LITERAL = /^-?(?:0|[1-9]\d*)$/
/** Integer literals of 15 digits or fewer are always safe (< 2^53). */
const LONG_DIGIT_RUN = /\d{16}/

interface ObjectLevel {
  kind: 'object'
  /** How often each key occurred so far (the last occurrence is the one JSON.parse keeps). */
  counts: Map<string, number>
  key: string
  occurrence: number
  expectKey: boolean
}

interface ArrayLevel {
  kind: 'array'
  index: number
}

type Level = ObjectLevel | ArrayLevel
type Step = { level: ObjectLevel; key: string; occurrence: number } | number

interface UnsafeInteger {
  path: Step[]
  literal: string
}

/** `JSON.parse(text)` with unsafe integer literals as bigints. Throws like `JSON.parse`. */
export function parseExactJson(text: string): unknown {
  const value: unknown = JSON.parse(text)
  if (!LONG_DIGIT_RUN.test(text)) return value
  let result = value
  for (const { path, literal } of unsafeIntegers(text)) {
    if (path.every(isLive)) result = setAt(result, path, BigInt(literal))
  }
  return result
}

/** A step under a key that a later duplicate overrode leads to a value JSON.parse dropped. */
function isLive(step: Step): boolean {
  return typeof step === 'number' || step.level.counts.get(step.key) === step.occurrence
}

/** Every integer literal of `text` (valid JSON) that is not a safe integer, with its path. */
function unsafeIntegers(text: string): UnsafeInteger[] {
  const found: UnsafeInteger[] = []
  const levels: Level[] = []
  let i = 0
  while (i < text.length) {
    const code = text.charCodeAt(i)
    const top = levels[levels.length - 1]
    if (code === QUOTE) {
      const end = endOfJsonString(text, i)
      if (top?.kind === 'object' && top.expectKey) {
        const key = String(JSON.parse(text.slice(i, end)))
        top.occurrence = (top.counts.get(key) ?? 0) + 1
        top.counts.set(key, top.occurrence)
        top.key = key
        top.expectKey = false
      }
      i = end
    } else if (code === OPEN_BRACE || code === OPEN_BRACKET) {
      levels.push(
        code === OPEN_BRACE
          ? { kind: 'object', counts: new Map(), key: '', occurrence: 0, expectKey: true }
          : { kind: 'array', index: 0 }
      )
      i++
    } else if (code === CLOSE_BRACE || code === CLOSE_BRACKET) {
      levels.pop()
      i++
    } else if (code === COMMA) {
      if (top?.kind === 'array') top.index++
      else if (top) top.expectKey = true
      i++
    } else if (isJsonLiteralChar(code)) {
      let end = i + 1
      while (end < text.length && isJsonLiteralChar(text.charCodeAt(end))) end++
      const literal = text.slice(i, end)
      if (INTEGER_LITERAL.test(literal) && !Number.isSafeInteger(Number(literal))) {
        found.push({ path: levels.map(stepOf), literal })
      }
      i = end
    } else {
      i++ // `:` and whitespace
    }
  }
  return found
}

function stepOf(level: Level): Step {
  return level.kind === 'array'
    ? level.index
    : { level, key: level.key, occurrence: level.occurrence }
}

/** Replaces the value at `path` (own properties only); returns the (new) root. */
function setAt(root: unknown, path: Step[], value: unknown): unknown {
  if (path.length === 0) return value
  let node: unknown = root
  for (const step of path.slice(0, -1)) node = childOf(node, step)
  const last = path[path.length - 1]
  if (typeof last === 'number') {
    if (Array.isArray(node)) node[last] = value
  } else if (typeof node === 'object' && node !== null) {
    // defineProperty: a `__proto__` key is an own data property after JSON.parse, keep it one.
    Object.defineProperty(node, last.key, {
      value,
      writable: true,
      enumerable: true,
      configurable: true
    })
  }
  return root
}

function childOf(node: unknown, step: Step): unknown {
  if (typeof step === 'number') return Array.isArray(node) ? node[step] : undefined
  if (typeof node !== 'object' || node === null) return undefined
  return Object.getOwnPropertyDescriptor(node, step.key)?.value
}
