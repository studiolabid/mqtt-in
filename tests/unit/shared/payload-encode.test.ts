import { decode as msgpackDecode, encode as msgpackEncode } from '@msgpack/msgpack'
import { decode as cborDecode } from 'cborg'
import { describe, expect, it } from 'vitest'
import type { PayloadFormat } from '@shared/models'
import {
  encodePayload,
  PAYLOAD_FORMATS,
  PayloadError,
  toHex,
  utf8Decode,
  VIEW_FORMATS
} from '@shared/payload'
import { bytes, utf8 } from './helpers'

describe('format lists', () => {
  it('lists every payload format once with its binary flag', () => {
    expect(PAYLOAD_FORMATS.map((f) => [f.value, f.binary])).toEqual([
      ['json', false],
      ['text', false],
      ['hex', true],
      ['base64', true],
      ['msgpack', true],
      ['cbor', true]
    ])
    expect(PAYLOAD_FORMATS.every((f) => f.label.length > 0)).toBe(true)
  })

  it('offers auto first, then every payload format as a view format', () => {
    expect(VIEW_FORMATS.map((f) => f.value)).toEqual([
      'auto',
      ...PAYLOAD_FORMATS.map((f) => f.value)
    ])
  })
})

describe('encodePayload', () => {
  describe('text', () => {
    it('encodes UTF-8 and keeps whitespace', () => {
      expect(encodePayload(' héllo\n', 'text')).toEqual(utf8(' héllo\n'))
      expect(encodePayload('', 'text')).toEqual(new Uint8Array(0))
    })

    it('does not interpret template-like or JSON-like text', () => {
      expect(utf8Decode(encodePayload('{not json', 'text'))).toBe('{not json')
    })
  })

  describe('json', () => {
    it('keeps the authored text byte for byte', () => {
      const input = '{\n  "a": 1,\n  "big": 12345678901234567890\n}'
      expect(utf8Decode(encodePayload(input, 'json'))).toBe(input)
    })

    it.each(['42', '"str"', 'true', 'null', '[]', ' {} '])('accepts the JSON value %j', (input) => {
      expect(encodePayload(input, 'json')).toEqual(utf8(input))
    })

    it.each(['', '   ', '\n\t'])('encodes blank input %j as an empty payload', (input) => {
      expect(encodePayload(input, 'json')).toEqual(new Uint8Array(0))
    })

    it.each(['{"a":}', '{a:1}', "{'a':1}", '[1,]', 'undefined', '{"a":1} x'])(
      'rejects %j with a friendly PayloadError',
      (input) => {
        expect(() => encodePayload(input, 'json')).toThrow(PayloadError)
        expect(() => encodePayload(input, 'json')).toThrow(/^Invalid JSON: /)
      }
    )
  })

  describe('hex', () => {
    it('parses hex with separators', () => {
      expect(encodePayload('0xde ad:be-ef', 'hex')).toEqual(bytes(0xde, 0xad, 0xbe, 0xef))
      expect(encodePayload('', 'hex')).toEqual(new Uint8Array(0))
    })

    it('rejects invalid hex', () => {
      expect(() => encodePayload('xyz', 'hex')).toThrow(PayloadError)
      expect(() => encodePayload('abc', 'hex')).toThrow('Invalid hex: odd number of digits')
    })
  })

  describe('base64', () => {
    it('parses standard and URL-safe base64', () => {
      expect(encodePayload('aGk=', 'base64')).toEqual(utf8('hi'))
      expect(encodePayload('-__-', 'base64')).toEqual(bytes(0xfb, 0xff, 0xfe))
    })

    it('rejects invalid base64', () => {
      expect(() => encodePayload('a', 'base64')).toThrow(PayloadError)
      expect(() => encodePayload('$$$$', 'base64')).toThrow('Invalid base64 string')
    })
  })

  describe('msgpack', () => {
    it('encodes JSON text as MessagePack', () => {
      const out = encodePayload('{"a":1,"b":[true,"x"]}', 'msgpack')
      expect(toHex(out, '')).toBe('82a16101a16292c3a178')
      expect(msgpackDecode(out)).toEqual({ a: 1, b: [true, 'x'] })
    })

    it.each<[string, string]>([
      ['42', '2a'],
      ['-1', 'ff'],
      ['1.5', 'cb3ff8000000000000'],
      ['"x"', 'a178'],
      ['true', 'c3'],
      ['null', 'c0'],
      ['[]', '90'],
      ['{}', '80']
    ])('encodes the JSON value %j as 0x%s', (input, hex) => {
      expect(toHex(encodePayload(input, 'msgpack'), '')).toBe(hex)
    })

    it('encodes blank input as nil (debatable: the json format sends an empty payload)', () => {
      expect(encodePayload('  ', 'msgpack')).toEqual(bytes(0xc0))
    })

    it('rejects invalid JSON with a format-specific message', () => {
      expect(() => encodePayload('{oops}', 'msgpack')).toThrow(PayloadError)
      expect(() => encodePayload('{oops}', 'msgpack')).toThrow(
        /^MessagePack payloads are written as JSON: /
      )
    })

    it('writes the bytes @msgpack/msgpack writes for every JSON value it encodes exactly', () => {
      const ints = [0, 127, 128, 255, 256, 65_535, 65_536, 4_294_967_295, 4_294_967_296]
      const negatives = [-1, -32, -33, -128, -129, -32_768, -32_769, -2_147_483_648]
      const corpus: unknown[] = [
        ...ints,
        ...negatives,
        -2_147_483_649,
        Number.MAX_SAFE_INTEGER,
        Number.MIN_SAFE_INTEGER,
        1.5,
        -0.25,
        1e300,
        true,
        false,
        null,
        ...[0, 31, 32, 255, 256, 65_535, 65_536].map((n) => 'a'.repeat(n)),
        '€'.repeat(11), // 33 bytes
        Array.from({ length: 15 }, (_, i) => i),
        Array.from({ length: 16 }, (_, i) => i),
        Array.from({ length: 65_536 }, () => 0),
        Object.fromEntries(Array.from({ length: 15 }, (_, i) => [`k${i}`, i])),
        Object.fromEntries(Array.from({ length: 16 }, (_, i) => [`k${i}`, [i, { x: 'y' }]])),
        { 'ü-key': { nested: [null, true, 'é'] }, 2: 'two', 1: 'one' }
      ]
      for (const value of corpus) {
        const json = JSON.stringify(value)
        expect(toHex(encodePayload(json, 'msgpack'), '')).toBe(
          toHex(msgpackEncode(JSON.parse(json)), '')
        )
      }
    })

    it('limits nesting like @msgpack/msgpack (100 levels)', () => {
      const nested = (depth: number): string => '['.repeat(depth) + ']'.repeat(depth)
      expect(() => encodePayload(nested(100), 'msgpack')).not.toThrow()
      expect(() => msgpackEncode(JSON.parse(nested(100)))).not.toThrow()
      expect(() => encodePayload(nested(101), 'msgpack')).toThrow(/Too deeply nested/)
      expect(() => msgpackEncode(JSON.parse(nested(101)))).toThrow()
    })
  })

  describe('cbor', () => {
    it('encodes JSON text as CBOR', () => {
      const out = encodePayload('{"a":1,"b":[true,"x"]}', 'cbor')
      expect(toHex(out, '')).toBe('a2616101616282f56178')
      expect(cborDecode(out)).toEqual({ a: 1, b: [true, 'x'] })
    })

    it.each<[string, string]>([
      ['42', '182a'],
      ['-1', '20'],
      ['1.5', 'f93e00'],
      ['"x"', '6178'],
      ['false', 'f4'],
      ['null', 'f6'],
      ['[]', '80'],
      ['{}', 'a0']
    ])('encodes the JSON value %j as 0x%s', (input, hex) => {
      expect(toHex(encodePayload(input, 'cbor'), '')).toBe(hex)
    })

    it('sorts map keys canonically (debatable: authored key order is not kept)', () => {
      expect(Object.keys(cborDecode(encodePayload('{"zz":1,"a":2,"b":3}', 'cbor')))).toEqual([
        'a',
        'b',
        'zz'
      ])
    })

    it('encodes blank input as null (debatable: the json format sends an empty payload)', () => {
      expect(encodePayload('', 'cbor')).toEqual(bytes(0xf6))
    })

    it('rejects invalid JSON with a format-specific message', () => {
      expect(() => encodePayload('[1,', 'cbor')).toThrow(PayloadError)
      expect(() => encodePayload('[1,', 'cbor')).toThrow(/^CBOR payloads are written as JSON: /)
    })
  })

  it('handles every advertised payload format', () => {
    const samples: Record<PayloadFormat, string> = {
      text: 'hi',
      json: '{"a":1}',
      hex: '6869',
      base64: 'aGk=',
      msgpack: '{"a":1}',
      cbor: '{"a":1}'
    }
    for (const { value } of PAYLOAD_FORMATS) {
      const out = encodePayload(samples[value], value)
      expect(out).toBeInstanceOf(Uint8Array)
      // Payloads cross IPC, where structured clone copies the whole backing buffer: no views.
      expect([value, out.byteOffset, out.buffer.byteLength]).toEqual([value, 0, out.byteLength])
      expect(out.length).toBeGreaterThan(0)
    }
  })
})
