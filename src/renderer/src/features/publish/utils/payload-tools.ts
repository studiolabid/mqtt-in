/**
 * Pure helpers for authoring payloads in the publish panel: format metadata, template-aware
 * JSON formatting, conversion between authoring formats and one-line previews.
 */
import type { PayloadFormat } from '@shared/models'
import {
  decodePayload,
  encodePayload,
  formatJson,
  isValidUtf8,
  minifyJson,
  toBase64,
  toHex,
  tryParseJson,
  utf8Decode
} from '@shared/payload'
import type { CodeEditorLanguage } from '@/components/common'

export interface FormatMeta {
  /** Trigger label (`MsgPack` instead of `MessagePack`). */
  short: string
  /** One line for the format picker. */
  hint: string
  /** Editor placeholder. */
  placeholder: string
}

export const FORMAT_META: Readonly<Record<PayloadFormat, FormatMeta>> = {
  json: { short: 'JSON', hint: 'Validated JSON text', placeholder: '{ "temperature": 21.5 }' },
  text: { short: 'Text', hint: 'UTF-8 text, sent as written', placeholder: 'Message text' },
  hex: { short: 'Hex', hint: 'Raw bytes as hex digits', placeholder: '48 65 6c 6c 6f' },
  base64: { short: 'Base64', hint: 'Raw bytes as Base64', placeholder: 'SGVsbG8=' },
  msgpack: {
    short: 'MsgPack',
    hint: 'Written as JSON, sent as MessagePack',
    placeholder: '{ "temperature": 21.5 }  (written as JSON, sent as MessagePack)'
  },
  cbor: {
    short: 'CBOR',
    hint: 'Written as JSON, sent as CBOR',
    placeholder: '{ "temperature": 21.5 }  (written as JSON, sent as CBOR)'
  }
}

/** MessagePack and CBOR payloads are authored as JSON. */
export function isJsonAuthored(format: PayloadFormat): boolean {
  return format === 'json' || format === 'msgpack' || format === 'cbor'
}

export function editorLanguage(format: PayloadFormat): CodeEditorLanguage {
  return isJsonAuthored(format) ? 'json' : 'text'
}

// ---------------------------------------------------------------------------
// Template-aware JSON formatting
// ---------------------------------------------------------------------------

const TEMPLATE_TOKEN = /\{\{[^{}]*\}\}/g
const MAX_MASKED_TOKENS = 9999

/** A number literal prefix that does not occur in `text`. */
function markerPrefix(text: string): string {
  for (;;) {
    const digits = String(Math.floor(Math.random() * 1e9)).padStart(9, '0')
    const prefix = `-0.${digits}`
    if (!text.includes(prefix)) return prefix
  }
}

/**
 * Pretty prints or minifies JSON that may contain `{{template}}` tokens (e.g. an unquoted
 * `{{random(1,9)}}`): every token is swapped for a unique number literal — valid as a bare
 * value and inside strings — the JSON is re-indented and the tokens are restored.
 *
 * @throws PayloadError when the JSON is invalid.
 */
export function reformatJson(text: string, mode: 'pretty' | 'minify'): string {
  const run = (input: string): string => (mode === 'pretty' ? formatJson(input) : minifyJson(input))
  if (!text.includes('{{')) return run(text)
  const prefix = markerPrefix(text)
  const tokens: string[] = []
  const masked = text.replace(TEMPLATE_TOKEN, (token) => {
    tokens.push(token)
    return `${prefix}${String(tokens.length - 1).padStart(4, '0')}`
  })
  if (tokens.length === 0 || tokens.length > MAX_MASKED_TOKENS) return run(text)
  const marker = new RegExp(`${prefix.replace('.', '\\.')}(\\d{4})`, 'g')
  return run(masked).replace(marker, (found, index: string) => tokens[Number(index)] ?? found)
}

// ---------------------------------------------------------------------------
// Conversion between authoring formats
// ---------------------------------------------------------------------------

/** Editable text for `bytes` in `format`, or null when the bytes cannot be expressed. */
function representBytes(bytes: Uint8Array, format: PayloadFormat): string | null {
  switch (format) {
    case 'hex':
      return toHex(bytes, ' ', 16)
    case 'base64':
      return toBase64(bytes)
    case 'text':
      return isValidUtf8(bytes) ? utf8Decode(bytes) : null
    case 'json': {
      if (!isValidUtf8(bytes)) return null
      const text = utf8Decode(bytes)
      return tryParseJson(text).ok ? text : null
    }
    case 'msgpack':
    case 'cbor': {
      // The decoded view shows NaN, Infinity and -Infinity as bare tokens: not JSON, so the
      // editor could not send that text back (big integers and -0 are JSON and convert).
      const decoded = decodePayload(bytes, format)
      return decoded.error || !tryParseJson(decoded.text).ok ? null : decoded.text
    }
  }
}

/**
 * Rewrites a payload authored in `from` for the `to` format so it sends the same bytes
 * (MessagePack / CBOR: the same value), e.g. `Hello` (text) → `48 65 6c 6c 6f` (hex).
 *
 * @returns null when it is not possible or nothing would change (JSON, MessagePack and CBOR
 * share the same JSON source).
 */
export function convertPayload(
  text: string,
  from: PayloadFormat,
  to: PayloadFormat
): string | null {
  if (from === to || (isJsonAuthored(from) && isJsonAuthored(to))) return null
  let bytes: Uint8Array
  try {
    bytes = encodePayload(text, from)
  } catch {
    return null
  }
  const converted = representBytes(bytes, to)
  return converted === null || converted === text ? null : converted
}

// ---------------------------------------------------------------------------
// Previews
// ---------------------------------------------------------------------------

/** One-line preview of authored payload text (whitespace collapsed, cut to `max`). */
export function previewText(text: string, max = 160): string {
  const head = text.length > max * 4 ? text.slice(0, max * 4) : text
  const flat = head.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max)}…` : flat
}
