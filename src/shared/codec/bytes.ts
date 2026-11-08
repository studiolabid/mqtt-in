/**
 * Low level byte converters: UTF-8 (strict and lenient), printable-text detection, hex and
 * base64. Pure and environment agnostic (Node and the browser — no Buffer).
 */
import { PayloadError } from './errors'

const utf8Encoder = new TextEncoder()
const utf8Lenient = new TextDecoder('utf-8', { fatal: false })
const utf8Strict = new TextDecoder('utf-8', { fatal: true })

export function utf8Encode(text: string): Uint8Array {
  return utf8Encoder.encode(text)
}

/** Lenient: invalid sequences become U+FFFD. A leading BOM is dropped. */
export function utf8Decode(bytes: Uint8Array): string {
  return utf8Lenient.decode(bytes)
}

export function isValidUtf8(bytes: Uint8Array): boolean {
  try {
    utf8Strict.decode(bytes)
    return true
  } catch {
    return false
  }
}

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/

/** True when the bytes are valid UTF-8 without control characters (tabs/newlines allowed). */
export function isPrintableText(bytes: Uint8Array): boolean {
  if (bytes.length === 0) return true
  try {
    return !CONTROL_CHARS.test(utf8Strict.decode(bytes))
  } catch {
    return false
  }
}

/** Length of the UTF-8 sequence announced by a lead byte (1 for ASCII and invalid leads). */
function utf8SequenceLength(lead: number): number {
  if (lead >= 0xc2 && lead <= 0xdf) return 2
  if (lead >= 0xe0 && lead <= 0xef) return 3
  if (lead >= 0xf0 && lead <= 0xf4) return 4
  return 1
}

/** Length of `bytes` without a trailing multi-byte character that was cut off (by `maxBytes`). */
export function completeUtf8Length(bytes: Uint8Array): number {
  let start = bytes.length - 1
  // Walk back over at most 3 continuation bytes (10xxxxxx) to the lead byte.
  while (start > 0 && bytes.length - start < 4 && (bytes[start] & 0xc0) === 0x80) start--
  if (start < 0) return 0
  return bytes.length - start < utf8SequenceLength(bytes[start]) ? start : bytes.length
}

const HEX = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, '0'))

/** Lower-case hex. `bytesPerLine` > 0 inserts line breaks (implies a space separator). */
export function toHex(bytes: Uint8Array, separator = ' ', bytesPerLine = 0): string {
  if (bytesPerLine > 0) {
    const lines: string[] = []
    for (let i = 0; i < bytes.length; i += bytesPerLine) {
      const line = Array.from(bytes.subarray(i, i + bytesPerLine), (b) => HEX[b])
      lines.push(line.join(separator || ' '))
    }
    return lines.join('\n')
  }
  let out = ''
  for (let i = 0; i < bytes.length; i++) {
    out += (i > 0 ? separator : '') + HEX[bytes[i]]
  }
  return out
}

/** Accepts `0x` prefixes and whitespace / `:` / `,` / `-` separators. */
export function fromHex(input: string): Uint8Array {
  const clean = input.replace(/0x/gi, '').replace(/[\s:,-]/g, '')
  if (!/^[0-9a-fA-F]*$/.test(clean)) {
    throw new PayloadError('Invalid hex: only 0-9 and a-f are allowed')
  }
  if (clean.length % 2 !== 0) throw new PayloadError('Invalid hex: odd number of digits')
  const out = new Uint8Array(clean.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16)
  return out
}

/** Standard base64 with padding. */
export function toBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

/** Accepts standard and URL-safe alphabets, with or without padding / whitespace. */
export function fromBase64(input: string): Uint8Array {
  let clean = input.replace(/\s/g, '').replace(/-/g, '+').replace(/_/g, '/')
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(clean)) throw new PayloadError('Invalid base64 string')
  clean = clean.replace(/=+$/, '')
  if (clean.length % 4 === 1) throw new PayloadError('Invalid base64 length')
  clean += '='.repeat((4 - (clean.length % 4)) % 4)
  let binary: string
  try {
    binary = atob(clean)
  } catch {
    throw new PayloadError('Invalid base64 string')
  }
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}
