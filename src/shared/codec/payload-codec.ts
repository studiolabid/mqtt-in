/**
 * Payload formats: encodes authored text (text, JSON, hex, base64, MessagePack, CBOR) into bytes
 * and decodes received bytes for display, with best-effort detection for the `auto` view.
 * Pure and environment agnostic (works in Node and the browser — no Buffer).
 */
import type { PayloadFormat, ViewFormat } from '../models'
import { BINARY_JSON_CODECS } from './binary-json'
import {
  completeUtf8Length,
  fromBase64,
  fromHex,
  isPrintableText,
  toBase64,
  toHex,
  utf8Decode,
  utf8Encode
} from './bytes'
import { errorMessage, PayloadError } from './errors'
import { parseExactJson } from './exact-json'
import { looksLikeJson, reindentJson, toDisplayJson, tryParseJson } from './json'

export const PAYLOAD_FORMATS: { value: PayloadFormat; label: string; binary: boolean }[] = [
  { value: 'json', label: 'JSON', binary: false },
  { value: 'text', label: 'Plaintext', binary: false },
  { value: 'hex', label: 'Hex', binary: true },
  { value: 'base64', label: 'Base64', binary: true },
  { value: 'msgpack', label: 'MessagePack', binary: true },
  { value: 'cbor', label: 'CBOR', binary: true }
]

export const VIEW_FORMATS: { value: ViewFormat; label: string }[] = [
  { value: 'auto', label: 'Auto' },
  ...PAYLOAD_FORMATS.map(({ value, label }) => ({ value: value as ViewFormat, label }))
]

// ---------------------------------------------------------------------------
// Encode (authoring → bytes)
// ---------------------------------------------------------------------------

/**
 * Encodes authored text into bytes. Throws PayloadError with a friendly message on invalid input.
 * MessagePack / CBOR are written as JSON and keep every number exact (64-bit integers, -0); an
 * integer MessagePack cannot hold (beyond 64 bits) is refused instead of rounded.
 */
export function encodePayload(input: string, format: PayloadFormat): Uint8Array {
  switch (format) {
    case 'text':
      return utf8Encode(input)
    case 'json': {
      if (input.trim().length === 0) return new Uint8Array(0)
      const parsed = tryParseJson(input)
      if (!parsed.ok) throw new PayloadError(`Invalid JSON: ${parsed.error}`)
      return utf8Encode(input)
    }
    case 'hex':
      return fromHex(input)
    case 'base64':
      return fromBase64(input)
    case 'msgpack':
    case 'cbor': {
      const codec = BINARY_JSON_CODECS[format]
      let value: unknown
      try {
        // Exact: integers beyond 2^53 become bigints instead of rounded doubles.
        value = parseExactJson(input.trim().length === 0 ? 'null' : input)
      } catch (err) {
        throw new PayloadError(`${codec.name} payloads are written as JSON: ${errorMessage(err)}`)
      }
      try {
        return codec.encode(value)
      } catch (err) {
        throw new PayloadError(errorMessage(err))
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Decode (bytes → display)
// ---------------------------------------------------------------------------

export interface DecodeOptions {
  /** Pretty print JSON-like output and wrap hex in 16-byte lines. Default true. */
  pretty?: boolean
  /** Only decode the first N bytes (fast previews; negative counts as 0). Default: everything. */
  maxBytes?: number
}

export interface DecodedPayload {
  /** The format actually used (`auto` resolves to json / text / hex). */
  format: PayloadFormat
  /** Display text. */
  text: string
  /** True when `text` is JSON (json, msgpack, cbor) — enables syntax highlighting. */
  json: boolean
  /** Decode problem when a format was forced; `text` then holds a fallback. */
  error?: string
  /** True when the input was cut to `maxBytes`. */
  truncated: boolean
}

/** Best-effort detection used by the `auto` view format. */
export function detectFormat(bytes: Uint8Array): PayloadFormat {
  if (bytes.length === 0) return 'text'
  if (!isPrintableText(bytes)) return 'hex'
  const text = utf8Decode(bytes)
  if (looksLikeJson(text) && tryParseJson(text).ok) return 'json'
  return 'text'
}

/** Detection for a truncated prefix: JSON cannot be validated, so trust the first character. */
function detectPreviewFormat(prefix: Uint8Array): PayloadFormat {
  if (!isPrintableText(prefix)) return 'hex'
  return looksLikeJson(utf8Decode(prefix)) ? 'json' : 'text'
}

/**
 * Decodes bytes for display. Never throws: when a forced format cannot decode the payload,
 * `error` is set and `text` falls back to the raw text (json) or hex (msgpack / cbor).
 * An empty payload always decodes to empty text without an error.
 */
export function decodePayload(
  bytes: Uint8Array,
  format: ViewFormat,
  options: DecodeOptions = {}
): DecodedPayload {
  if (bytes.length === 0) {
    return { format: format === 'auto' ? 'text' : format, text: '', json: false, truncated: false }
  }
  const pretty = options.pretty ?? true
  const max = Math.max(0, options.maxBytes ?? Infinity)
  const truncated = bytes.length > max
  const input = truncated ? bytes.subarray(0, max) : bytes
  // A cut can split a multi-byte character: text views drop the incomplete tail.
  const textInput = truncated ? input.subarray(0, completeUtf8Length(input)) : input
  const resolved: PayloadFormat =
    format === 'auto' ? (truncated ? detectPreviewFormat(textInput) : detectFormat(input)) : format
  const hexText = (): string => toHex(input, ' ', pretty ? 16 : 0)

  switch (resolved) {
    case 'text':
      return { format: 'text', text: utf8Decode(textInput), json: false, truncated }
    case 'json': {
      const text = utf8Decode(textInput)
      if (truncated) return { format: 'json', text, json: false, truncated }
      const parsed = tryParseJson(text)
      if (!parsed.ok) {
        const error = `Invalid JSON: ${parsed.error}`
        return { format: 'json', text, json: false, error, truncated }
      }
      return { format: 'json', text: pretty ? reindentJson(text, 2) : text, json: true, truncated }
    }
    case 'hex':
      return { format: 'hex', text: hexText(), json: false, truncated }
    case 'base64':
      return { format: 'base64', text: toBase64(input), json: false, truncated }
    case 'msgpack':
    case 'cbor': {
      const codec = BINARY_JSON_CODECS[resolved]
      if (truncated) {
        const error = `Payload truncated — ${codec.name} cannot be partially decoded`
        return { format: resolved, text: hexText(), json: false, error, truncated }
      }
      try {
        const text = toDisplayJson(codec.decode(input), pretty ? 2 : 0)
        return { format: resolved, text, json: true, truncated }
      } catch (err) {
        const error = `Invalid ${codec.name}: ${errorMessage(err)}`
        return { format: resolved, text: hexText(), json: false, error, truncated }
      }
    }
  }
}

/** Single-line preview for list rows (whitespace collapsed, cut to `maxChars`). */
export function payloadPreview(bytes: Uint8Array, format: ViewFormat, maxChars = 240): string {
  if (bytes.length === 0) return ''
  const maxBytes = Math.max(maxChars * 4, 1024)
  const decoded = decodePayload(bytes, format, { pretty: false, maxBytes })
  const flat = decoded.text.replace(/\s+/g, ' ').trim()
  return flat.length > maxChars ? `${flat.slice(0, maxChars)}…` : flat
}
