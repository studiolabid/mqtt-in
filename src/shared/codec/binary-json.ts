/**
 * MessagePack and CBOR, authored and displayed as JSON: the codecs, the exact number encoding
 * of authored values (integers beyond 2^53 arrive as bigints from `parseExactJson`; -0 stays a
 * float) and the CBOR tags decoded for display (dates, bignums, the self-described marker).
 */
import { decode as msgpackDecode } from '@msgpack/msgpack'
import {
  decode as cborDecode,
  encode as cborEncode,
  type DecodeOptions as CborDecodeOptions,
  type EncodeOptions as CborEncodeOptions,
  Token,
  Type
} from 'cborg'
import { encodeMsgpackJson } from './msgpack-write'

/** Big-endian unsigned integer of a CBOR bignum byte string (tags 2 and 3). */
function cborBignum(content: unknown): bigint {
  if (!(content instanceof Uint8Array)) throw new Error('bignum tag content must be a byte string')
  let value = 0n
  for (const byte of content) value = (value << 8n) | BigInt(byte)
  return value
}

/** Big-endian bytes of a non-negative bigint (the content of a CBOR bignum). */
function bignumBytes(value: bigint): Uint8Array {
  const hex = value.toString(16)
  const digits = hex.length % 2 === 0 ? hex : `0${hex}`
  const bytes = new Uint8Array(digits.length / 2)
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(digits.slice(i * 2, i * 2 + 2), 16)
  return bytes
}

/** CBOR tag 1 (epoch seconds) as a Date; out-of-range or non-numeric content is kept as is. */
function cborEpochDate(content: unknown): unknown {
  if (typeof content !== 'number') return content
  const date = new Date(content * 1000)
  return Number.isNaN(date.getTime()) ? content : date
}

const CBOR_DECODE_OPTIONS: CborDecodeOptions = {
  // Non-string map keys are common in CBOR (SenML, COSE…); Maps are converted for display.
  useMaps: true,
  // Core RFC 8949 tags. Any other tag is reported as unsupported (hex fallback).
  tags: {
    0: (decode) => decode(), // date/time string
    1: (decode) => cborEpochDate(decode()),
    2: (decode) => cborBignum(decode()),
    3: (decode) => -1n - cborBignum(decode()),
    55799: (decode) => decode() // "self-described CBOR" marker
  }
}

const CBOR_UINT64_MAX = (1n << 64n) - 1n

const CBOR_ENCODE_OPTIONS: CborEncodeOptions = {
  typeEncoders: {
    // cborg writes -0 as the integer 0; as a (half) float it keeps its sign.
    number: (value: unknown) => (Object.is(value, -0) ? [new Token(Type.float, -0)] : null),
    // Beyond 64 bits: a bignum (tag 2 / 3), which the decoder above reads back exactly.
    bigint: (value: unknown) => {
      if (typeof value !== 'bigint') return null
      if (value >= 0n && value <= CBOR_UINT64_MAX) return null
      if (value < 0n && -1n - value <= CBOR_UINT64_MAX) return null
      const positive = value >= 0n
      return [
        new Token(Type.tag, positive ? 2 : 3),
        new Token(Type.bytes, bignumBytes(positive ? value : -1n - value))
      ]
    }
  }
}

export interface BinaryJsonCodec {
  name: string
  /** Encodes an authored value (from `parseExactJson`). */
  encode: (value: unknown) => Uint8Array
  decode: (bytes: Uint8Array) => unknown
}

export const BINARY_JSON_CODECS: Readonly<Record<'msgpack' | 'cbor', BinaryJsonCodec>> = {
  msgpack: {
    name: 'MessagePack',
    encode: encodeMsgpackJson,
    // 64-bit integers decode as bigint so values beyond 2^53 stay exact (see toDisplayJson).
    decode: (bytes: Uint8Array): unknown => msgpackDecode(bytes, { useBigInt64: true })
  },
  cbor: {
    name: 'CBOR',
    encode: (value: unknown): Uint8Array => cborEncode(value, CBOR_ENCODE_OPTIONS),
    decode: (bytes: Uint8Array): unknown => cborDecode(bytes, CBOR_DECODE_OPTIONS)
  }
}
