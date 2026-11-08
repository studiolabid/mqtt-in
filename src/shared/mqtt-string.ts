/**
 * MQTT UTF-8 strings (MQTT 5 §1.5.4, MQTT 3.1.1 §1.5.3): a two-byte length prefix, so at most
 * 65,535 bytes, of well-formed UTF-8.
 *
 * JavaScript strings are UTF-16: `length` is not the wire size (one '€' is 1 unit but 3 bytes),
 * and an unpaired surrogate cannot be encoded at all (`TextEncoder` and `Buffer` silently write
 * U+FFFD instead). mqtt-packet throws in the middle of a packet for an over-long string, which
 * leaves a broken packet on the socket, so every MQTT string is checked before it is sent.
 * Pure and environment agnostic (no `Buffer`, no `TextEncoder`).
 */

/** Largest MQTT UTF-8 string (or binary data field, such as the password), in bytes. */
export const MQTT_STRING_MAX_BYTES = 65_535

const TOO_LONG = `is too long (max ${MQTT_STRING_MAX_BYTES} bytes)`
const UNPAIRED_SURROGATE = 'contains an unpaired surrogate'

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff
}

/**
 * UTF-8 size of `value` in bytes, exactly as `TextEncoder` / `Buffer.byteLength` count it: an
 * unpaired surrogate counts 3 bytes (it is written as U+FFFD).
 */
export function utf8ByteLength(value: string): number {
  let bytes = 0
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i)
    if (code < 0x80) bytes += 1
    else if (code < 0x800) bytes += 2
    else if (isHighSurrogate(code) && isLowSurrogate(value.charCodeAt(i + 1))) {
      bytes += 4
      i++
    } else bytes += 3
  }
  return bytes
}

/** True when `value` holds a UTF-16 surrogate without its partner (not encodable as UTF-8). */
export function hasUnpairedSurrogate(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i)
    if (code < 0xd800 || code > 0xdfff) continue
    if (isHighSurrogate(code) && isLowSurrogate(value.charCodeAt(i + 1))) {
      i++
      continue
    }
    return true
  }
  return false
}

/**
 * Why `value` cannot be sent as an MQTT UTF-8 string, or `null` when it can. The reason is
 * lower case, for the caller to prefix with the field label ("Content type " + reason):
 * `'is too long (max 65535 bytes)'` or `'contains an unpaired surrogate'`.
 *
 * Use it for every MQTT UTF-8 string: properties, user property keys and values, client id,
 * user name, will strings. Binary fields (password, correlation data) only have the byte limit:
 * `utf8ByteLength(value) <= MQTT_STRING_MAX_BYTES`.
 */
export function mqttStringProblem(value: string): string | null {
  // Every UTF-16 unit takes at least one byte, so a longer string never fits.
  if (value.length > MQTT_STRING_MAX_BYTES || utf8ByteLength(value) > MQTT_STRING_MAX_BYTES) {
    return TOO_LONG
  }
  return hasUnpairedSurrogate(value) ? UNPAIRED_SURROGATE : null
}
