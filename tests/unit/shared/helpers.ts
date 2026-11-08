/**
 * Helpers shared by the `src/shared` test suites. Node's `Buffer` is only used as an
 * independent reference implementation — the code under test must not depend on it.
 */

const encoder = new TextEncoder()

/** Bytes from numeric values. */
export function bytes(...values: number[]): Uint8Array {
  return Uint8Array.from(values)
}

/** Bytes from a hex string, whitespace ignored (reference parser, not `fromHex`). */
export function hexBytes(hex: string): Uint8Array {
  return Uint8Array.from(Buffer.from(hex.replace(/\s+/g, ''), 'hex'))
}

/** UTF-8 bytes of a string. */
export function utf8(text: string): Uint8Array {
  return encoder.encode(text)
}

/** Concatenates byte arrays. */
export function concat(...parts: Uint8Array[]): Uint8Array {
  return Uint8Array.from(Buffer.concat(parts))
}

/** Every byte value 0x00..0xff once, in order. */
export function allByteValues(): Uint8Array {
  return Uint8Array.from({ length: 256 }, (_, i) => i)
}

/** Deterministic pseudo-random bytes (xorshift32) so failures are reproducible. */
export function pseudoRandomBytes(length: number, seed = 0x2545f491): Uint8Array {
  const out = new Uint8Array(length)
  let state = seed >>> 0 || 1
  for (let i = 0; i < length; i++) {
    state = (state ^ (state << 13)) >>> 0
    state = (state ^ (state >>> 17)) >>> 0
    state = (state ^ (state << 5)) >>> 0
    out[i] = state & 0xff
  }
  return out
}

/** Deterministic random source in [0, 1) (mulberry32) so generated cases are reproducible. */
export function seededRandom(seed = 1): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Fast equality for large byte arrays (avoids element-wise deep equality). */
export function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return Buffer.compare(a, b) === 0
}

/** A deterministic random source returning the given values in order (cycling). */
export function sequence(...values: number[]): () => number {
  let index = 0
  return () => values[index++ % values.length]
}

/** RFC 4122 version 4 UUID. */
export const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
