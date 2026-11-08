/**
 * Text search of the message list (pure, no Vue).
 *
 * Searching must stay fast on 200k-message buffers, so payloads are scanned as bytes instead of
 * being decoded into strings (and nothing is cached per message for the common views):
 * - Auto / Text / JSON views: an ASCII term (after lower-casing) is matched against the first
 *   `SEARCH_MAX_BYTES` bytes with ASCII case folding. UTF-8 never encodes other characters with
 *   ASCII bytes, so this is the same as searching the decoded text (except that `İ` and the
 *   Kelvin sign, whose lower case contains `i` / `k`, are not folded to them). A term with other
 *   characters decodes the payload (only payloads with non-ASCII bytes) and compares lower-cased
 *   text.
 * - Hex view, and binary payloads in the Auto view (it shows them as hex): a term made of hex
 *   digits (`de ad`, `dead`, `0xDEAD`, `de:ad`) is matched as a byte sequence; an odd last digit
 *   matches the high nibble of the next byte (`de a` finds `de ad`). In the Hex view any other
 *   term falls back to the text search. In the Auto view the text search also finds readable
 *   text inside binary payloads.
 * - Base64 / MessagePack / CBOR views compare the decoded display text. Decoding is expensive,
 *   so those texts are cached for the active view format only, in a bounded cache that a format
 *   change empties (`searchCacheFormats`).
 * The topic always matches as case-insensitive text.
 */
import type { MqttMessage, ViewFormat } from '@shared/models'
import { decodePayload, utf8Decode } from '@shared/payload'
import { bytesIncludeHex, parseHexTerm, showsAsHex, type HexTerm } from './hex-search'

export { parseHexTerm, type HexTerm } from './hex-search'

/** Only the first bytes of a payload are searched (keeps search time and memory bounded). */
export const SEARCH_MAX_BYTES = 16 * 1024

/** A search term as the predicates compare it: NUL removed, trimmed, lower-cased. */
export function normalizeSearchTerm(search: string): string {
  // NUL separates topic and payload in `searchableText`: a term must never span both.
  return search.replaceAll('\u0000', '').trim().toLowerCase()
}

const LOWER_TOPIC_CACHE_LIMIT = 10_000
const lowerTopics = new Map<string, string>()

/** Lower-case form of a topic. Topics repeat a lot, so the result is cached (bounded). */
export function lowerTopic(topic: string): string {
  let lower = lowerTopics.get(topic)
  if (lower === undefined) {
    if (lowerTopics.size >= LOWER_TOPIC_CACHE_LIMIT) lowerTopics.clear()
    lower = topic.toLowerCase()
    lowerTopics.set(topic, lower)
  }
  return lower
}

/**
 * Predicate for a normalized, non-empty search `term` (see `normalizeSearchTerm`): true when the
 * topic or the payload, as shown in `format`, contains the term.
 */
export function createSearchPredicate(
  term: string,
  format: ViewFormat
): (message: MqttMessage) => boolean {
  const payloadMatches = payloadMatcher(term, format)
  return (message) => lowerTopic(message.topic).includes(term) || payloadMatches(message.payload)
}

function payloadMatcher(term: string, format: ViewFormat): (payload: Uint8Array) => boolean {
  if (format === 'base64' || format === 'msgpack' || format === 'cbor') {
    return (payload) => decodedText(payload, format).includes(term)
  }
  const text = textMatcher(term)
  const hex = parseHexTerm(term)
  if (format === 'hex') {
    return hex ? (payload) => includesHex(payload, hex) : text
  }
  if (format === 'auto' && hex) {
    return (payload) =>
      text(payload) || (includesHex(payload, hex) && showsAsHex(payload, SEARCH_MAX_BYTES))
  }
  return text
}

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

/** Byte-level matcher of a term against the payload text (Auto / Text / JSON views). */
function textMatcher(term: string): (payload: Uint8Array) => boolean {
  const needle = asciiBytes(term)
  if (needle) return bytesMatcher(needle)
  // A term with other characters needs the decoded text. Two cheap checks skip most decodes:
  // an all-ASCII text lower-cases to ASCII, so it cannot contain the term; and the bytes must
  // contain the term's longest ASCII run (see `asciiAnchor`).
  const anchor = asciiAnchor(term)
  const anchored = anchor ? bytesMatcher(anchor) : null
  return (payload) => {
    const end = Math.min(payload.length, SEARCH_MAX_BYTES)
    if (anchored && !anchored(payload)) return false
    if (!hasNonAscii(payload, end)) return false
    const prefix = end < payload.length ? payload.subarray(0, end) : payload
    return utf8Decode(prefix).toLowerCase().includes(term)
  }
}

function bytesMatcher(needle: Uint8Array): (payload: Uint8Array) => boolean {
  return needle.length >= HORSPOOL_MIN_LENGTH
    ? horspool(needle)
    : (payload) => scan(payload, needle)
}

/** The term as bytes when it is pure ASCII (null otherwise). */
function asciiBytes(term: string): Uint8Array | null {
  const bytes = new Uint8Array(term.length)
  for (let i = 0; i < term.length; i++) {
    const code = term.charCodeAt(i)
    if (code >= 0x80) return null
    bytes[i] = code
  }
  return bytes
}

/**
 * The longest run of the (lower-case) term's ASCII characters other than `i` and `k`, as bytes.
 * Lower-casing maps no other character to those ASCII characters (only `İ` → `i̇` and the Kelvin
 * sign → `k` produce ASCII), and UTF-8 encodes ASCII as itself, so every payload whose
 * lower-cased text contains the term has these bytes (ASCII case folded). null when none.
 */
function asciiAnchor(term: string): Uint8Array | null {
  let bestStart = 0
  let bestLength = 0
  let start = 0
  for (let i = 0; i <= term.length; i++) {
    const code = i < term.length ? term.charCodeAt(i) : -1
    if (code > 0 && code < 0x80 && code !== 0x69 && code !== 0x6b) continue // not i / k
    if (i - start > bestLength) {
      bestStart = start
      bestLength = i - start
    }
    start = i + 1
  }
  return bestLength > 0 ? asciiBytes(term.slice(bestStart, bestStart + bestLength)) : null
}

function hasNonAscii(bytes: Uint8Array, end: number): boolean {
  for (let i = 0; i < end; i++) if (bytes[i] >= 0x80) return true
  return false
}

/** ASCII lower-casing of one byte (other bytes unchanged). */
function fold(byte: number): number {
  return byte >= 0x41 && byte <= 0x5a ? byte | 0x20 : byte
}

/** Shorter needles are scanned directly; longer ones skip ahead (measured crossover). */
const HORSPOOL_MIN_LENGTH = 4

/** Case-folded scan for short needles (lower-case ASCII). */
function scan(bytes: Uint8Array, needle: Uint8Array): boolean {
  const n = needle.length
  const end = Math.min(bytes.length, SEARCH_MAX_BYTES) - n
  const first = needle[0]
  const firstUpper = first >= 0x61 && first <= 0x7a ? first - 0x20 : first
  outer: for (let i = 0; i <= end; i++) {
    const byte = bytes[i]
    if (byte !== first && byte !== firstUpper) continue
    for (let j = 1; j < n; j++) if (fold(bytes[i + j]) !== needle[j]) continue outer
    return true
  }
  return false
}

/** Case-folded Boyer-Moore-Horspool search for longer needles (lower-case ASCII). */
function horspool(needle: Uint8Array): (bytes: Uint8Array) => boolean {
  const n = needle.length
  const last = n - 1
  const lastByte = needle[last]
  const shift = new Int32Array(256).fill(n)
  for (let j = 0; j < last; j++) {
    const byte = needle[j]
    shift[byte] = last - j
    if (byte >= 0x61 && byte <= 0x7a) shift[byte - 0x20] = last - j
  }
  return (bytes) => {
    const end = Math.min(bytes.length, SEARCH_MAX_BYTES) - n
    let i = 0
    while (i <= end) {
      const byte = bytes[i + last]
      if (fold(byte) === lastByte) {
        let j = last - 1
        while (j >= 0 && fold(bytes[i + j]) === needle[j]) j--
        if (j < 0) return true
      }
      i += shift[byte]
    }
    return false
  }
}

// ---------------------------------------------------------------------------
// Hex (./hex-search)
// ---------------------------------------------------------------------------

/** True when the first `SEARCH_MAX_BYTES` bytes contain the hex term's bytes. */
export function includesHex(bytes: Uint8Array, hex: HexTerm): boolean {
  return bytesIncludeHex(bytes, hex, SEARCH_MAX_BYTES)
}

// ---------------------------------------------------------------------------
// Decoded views (Base64 / MessagePack / CBOR)
// ---------------------------------------------------------------------------

/** Cached texts at most (entries, and their total length in characters). */
const DECODED_CACHE_ENTRIES = 20_000
const DECODED_CACHE_CHARS = 8_000_000

/**
 * Lower-cased display texts of one view format. Keyed by payload in a `WeakMap`, so evicted
 * messages are collected with their entries; when a budget is exceeded or another format is
 * asked for, the whole map is replaced (bounded memory without per-entry bookkeeping).
 */
class DecodedTextCache {
  private format: ViewFormat | null = null
  private texts = new WeakMap<Uint8Array, string>()
  private entries = 0
  private chars = 0

  text(payload: Uint8Array, format: ViewFormat): string {
    if (format !== this.format) this.reset(format)
    let text = this.texts.get(payload)
    if (text === undefined) {
      text = decodePayload(payload, format, {
        pretty: false,
        maxBytes: SEARCH_MAX_BYTES
      }).text.toLowerCase()
      if (this.entries >= DECODED_CACHE_ENTRIES || this.chars + text.length > DECODED_CACHE_CHARS) {
        this.reset(format)
      }
      this.texts.set(payload, text)
      this.entries++
      this.chars += text.length
    }
    return text
  }

  reset(format: ViewFormat | null): void {
    this.format = format
    this.texts = new WeakMap()
    this.entries = 0
    this.chars = 0
  }

  get formats(): ViewFormat[] {
    return this.format !== null && this.entries > 0 ? [this.format] : []
  }
}

const decodedCache = new DecodedTextCache()

function decodedText(payload: Uint8Array, format: ViewFormat): string {
  return decodedCache.text(payload, format)
}

/** View formats whose decoded texts are cached right now: at most one (for tests). */
export function searchCacheFormats(): ViewFormat[] {
  return decodedCache.formats
}

/** Drops the cached decoded texts (e.g. when no search is active any more). */
export function clearSearchCache(): void {
  decodedCache.reset(null)
}
