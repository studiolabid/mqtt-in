/**
 * Hex terms of the message search (pure, no Vue): a term made of hex digits matched as a byte
 * sequence, for the Hex view and for the binary payloads the Auto view shows as hex. See
 * `./message-search`.
 */
import { isPrintableText } from '@shared/payload'

export interface HexTerm {
  /** Whole bytes, in order. */
  bytes: Uint8Array
  /** High nibble the byte after them must have (an odd last digit), -1 for none. */
  nibble: number
}

/**
 * A lower-case term as hex bytes: `0x` prefixes and `:` `,` `-` and whitespace separators are
 * ignored (like `fromHex`). null when it contains anything else or no digit at all.
 */
export function parseHexTerm(term: string): HexTerm | null {
  const digits = term.replace(/0x/g, '').replace(/[\s:,-]/g, '')
  if (digits.length === 0 || !/^[0-9a-f]+$/.test(digits)) return null
  const bytes = new Uint8Array(digits.length >> 1)
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(digits.slice(i * 2, i * 2 + 2), 16)
  const nibble = digits.length % 2 === 1 ? parseInt(digits[digits.length - 1], 16) : -1
  return { bytes, nibble }
}

/** True when the first `maxBytes` bytes contain the hex term's bytes. */
export function bytesIncludeHex(bytes: Uint8Array, hex: HexTerm, maxBytes: number): boolean {
  const needle = hex.bytes
  const n = needle.length
  const tail = hex.nibble >= 0 ? 1 : 0
  const end = Math.min(bytes.length, maxBytes) - n - tail
  outer: for (let i = 0; i <= end; i++) {
    for (let j = 0; j < n; j++) if (bytes[i + j] !== needle[j]) continue outer
    if (tail && bytes[i + n] >> 4 !== hex.nibble) continue
    return true
  }
  return false
}

/**
 * Whether the Auto view shows the first `maxBytes` of the payload as hex: the rule of
 * `decodePayload` (not printable UTF-8; a multi-byte character split by the cut is ignored).
 */
export function showsAsHex(payload: Uint8Array, maxBytes: number): boolean {
  if (payload.length <= maxBytes) return !isPrintableText(payload)
  const prefix = payload.subarray(0, maxBytes)
  return !isPrintableText(prefix.subarray(0, completeUtf8Length(prefix)))
}

/** Length of the UTF-8 sequence announced by a lead byte (1 for ASCII and invalid leads). */
function utf8SequenceLength(lead: number): number {
  if (lead >= 0xc2 && lead <= 0xdf) return 2
  if (lead >= 0xe0 && lead <= 0xef) return 3
  if (lead >= 0xf0 && lead <= 0xf4) return 4
  return 1
}

/** Length of `bytes` without a trailing multi-byte character that the cut split. */
function completeUtf8Length(bytes: Uint8Array): number {
  let start = bytes.length - 1
  // Walk back over at most 3 continuation bytes (10xxxxxx) to the lead byte.
  while (start > 0 && bytes.length - start < 4 && (bytes[start] & 0xc0) === 0x80) start--
  if (start < 0) return 0
  return bytes.length - start < utf8SequenceLength(bytes[start]) ? start : bytes.length
}
