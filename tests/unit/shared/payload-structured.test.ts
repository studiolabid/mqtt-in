import { decode as msgpackDecode, encode as msgpackEncode, ExtData } from '@msgpack/msgpack'
import { encode as cborEncode } from 'cborg'
import { describe, expect, it } from 'vitest'
import { decodePayload, encodePayload, PayloadError, toHex } from '@shared/payload'
import { bytes, hexBytes, utf8 } from './helpers'

const AT = new Date(Date.UTC(2024, 0, 2, 3, 4, 5, 678))

describe('decodePayload: msgpack', () => {
  it('decodes nested values (binary, Date, extension types) as compact JSON', () => {
    const value = {
      str: 'x',
      n: [1, -1, 1.5],
      nested: { ok: true, nil: null },
      bin: bytes(0xca, 0xfe),
      at: AT,
      ext: new ExtData(7, bytes(1))
    }
    expect(decodePayload(msgpackEncode(value), 'msgpack', { pretty: false })).toEqual({
      format: 'msgpack',
      text:
        '{"str":"x","n":[1,-1,1.5],"nested":{"ok":true,"nil":null},"bin":"0xcafe",' +
        '"at":"2024-01-02T03:04:05.678Z","ext":{"$ext":7,"data":"0x01"}}',
      json: true,
      truncated: false
    })
  })

  it('pretty prints with two spaces by default', () => {
    expect(decodePayload(msgpackEncode({ a: [1] }), 'msgpack').text).toBe(
      '{\n  "a": [\n    1\n  ]\n}'
    )
  })

  it('keeps 64-bit integers exact, shown as bare digits', () => {
    const data = hexBytes('93 cf ffffffffffffffff d3 8000000000000000 cf 0000000000000005')
    expect(decodePayload(data, 'msgpack', { pretty: false }).text).toBe(
      '[18446744073709551615,-9223372036854775808,5]'
    )
  })

  it('shows NaN, ±Infinity and -0 as they are (MQ-16)', () => {
    // {v: NaN, w: -0, i: Infinity, n: -Infinity}, all float 64
    const data = hexBytes(
      '84 a176 cb7ff8000000000000 a177 cb8000000000000000 a169 cb7ff0000000000000 a16e cbfff0000000000000'
    )
    const text = decodePayload(data, 'msgpack').text
    expect(text).toContain('"v": NaN')
    expect(text).toContain('"w": -0')
    expect(text).toContain('"i": Infinity')
    expect(text).toContain('"n": -Infinity')
  })

  it('decodes integer map keys', () => {
    expect(decodePayload(hexBytes('82 01 0a 02 a1 62'), 'msgpack', { pretty: false }).text).toBe(
      '{"1":10,"2":"b"}'
    )
  })

  it('round trips what encodePayload writes', () => {
    const json = '{"t":21.5,"tags":["a","b"],"ok":false,"none":null}'
    const decoded = decodePayload(encodePayload(json, 'msgpack'), 'msgpack', { pretty: false })
    expect(JSON.parse(decoded.text)).toEqual(JSON.parse(json))
  })

  it.each<[string, Uint8Array]>([
    ['plain text (trailing bytes)', utf8('hello')],
    ['reserved type byte 0xc1', bytes(0xc1)],
    ['truncated array', bytes(0x92, 0x01)]
  ])('falls back to hex with an error for %s', (_label, data) => {
    const result = decodePayload(data, 'msgpack')
    expect(result.format).toBe('msgpack')
    expect(result.json).toBe(false)
    expect(result.truncated).toBe(false)
    expect(result.text).toBe(Array.from(data, (b) => b.toString(16).padStart(2, '0')).join(' '))
    expect(result.error).toMatch(/^Invalid MessagePack: .+/)
  })

  it('never auto-detects MessagePack (binary shows as hex)', () => {
    expect(decodePayload(msgpackEncode({ a: 1 }), 'auto').format).toBe('hex')
  })
})

describe('decodePayload: cbor', () => {
  it('decodes nested values (binary, bigint, undefined) as compact JSON', () => {
    const value = { str: 'x', n: [1, -1, 1.5], bin: bytes(1, 2), big: 2n ** 64n - 1n, u: undefined }
    const result = decodePayload(cborEncode(value), 'cbor', { pretty: false })
    expect(result).toMatchObject({ format: 'cbor', json: true, truncated: false })
    expect(result.error).toBeUndefined()
    expect(result.text).not.toContain('\n')
    // The unsafe integer is shown as bare digits (not valid for JSON.parse to keep exact).
    expect(result.text).toContain('"big":18446744073709551615')
    expect(JSON.parse(result.text.replace('18446744073709551615', '"u64 max"'))).toEqual({
      str: 'x',
      n: [1, -1, 1.5],
      bin: '0x0102',
      big: 'u64 max',
      u: null
    })
  })

  it('pretty prints with two spaces by default', () => {
    expect(decodePayload(cborEncode({ a: [1] }), 'cbor').text).toBe('{\n  "a": [\n    1\n  ]\n}')
  })

  it('decodes maps with integer keys (SenML / COSE style)', () => {
    // [{-2: "urn:dev:x", 0: "temp", 1: "Cel", 2: 23.5}]
    const senml = hexBytes('81 a4 21 69 75726e3a6465763a78 00 64 74656d70 01 63 43656c 02 f9 4de0')
    const result = decodePayload(senml, 'cbor', { pretty: false })
    expect(result.error).toBeUndefined()
    expect(JSON.parse(result.text)).toEqual([{ '-2': 'urn:dev:x', 0: 'temp', 1: 'Cel', 2: 23.5 }])
  })

  it('decodes nested maps with non-string keys', () => {
    const value = new Map<unknown, unknown>([[1, new Map([[true, 'yes']])]])
    expect(decodePayload(cborEncode(value), 'cbor', { pretty: false }).text).toBe(
      '{"1":{"true":"yes"}}'
    )
  })

  it.each<[string, string, string]>([
    [
      'tag 0 (date/time string)',
      'c0 74 323031332d30332d32315432303a30343a30305a',
      '"2013-03-21T20:04:00Z"'
    ],
    ['tag 1 (epoch seconds)', 'c1 1a 514b67b0', '"2013-03-21T20:04:00.000Z"'],
    ['tag 1 (fractional epoch)', 'c1 fb 41d452d9ec200000', '"2013-03-21T20:04:00.500Z"'],
    ['tag 2 (unsigned bignum)', 'c2 49 010000000000000000', '18446744073709551616'],
    ['tag 3 (negative bignum)', 'c3 49 010000000000000000', '-18446744073709551617'],
    ['tag 2 (small bignum)', 'c2 41 05', '5'],
    ['tag 55799 (self-described CBOR)', 'd9 d9f7 a1 61 61 01', '{"a":1}']
  ])('decodes standard %s', (_label, hex, expected) => {
    const result = decodePayload(hexBytes(hex), 'cbor', { pretty: false })
    expect(result.error).toBeUndefined()
    expect(result.text).toBe(expected)
  })

  it('round trips what encodePayload writes', () => {
    const json = '{"t":21.5,"tags":["a","b"],"ok":false,"none":null}'
    const decoded = decodePayload(encodePayload(json, 'cbor'), 'cbor', { pretty: false })
    expect(JSON.parse(decoded.text)).toEqual(JSON.parse(json))
  })

  it.each<[string, Uint8Array]>([
    ['plain text', utf8('hello')],
    ['truncated array', bytes(0x82, 0x01)],
    ['trailing bytes', bytes(0x01, 0x02)],
    ['unsupported tag 42', hexBytes('d8 2a 45 0001020304')],
    ['bignum tag without a byte string', hexBytes('c2 01')]
  ])('falls back to hex with an error for %s', (_label, data) => {
    const result = decodePayload(data, 'cbor')
    expect(result.format).toBe('cbor')
    expect(result.json).toBe(false)
    expect(result.text).toBe(Array.from(data, (b) => b.toString(16).padStart(2, '0')).join(' '))
    expect(result.error).toMatch(/^Invalid CBOR: .+/)
  })
})

describe('exact numbers in authored MessagePack / CBOR (MQ-16)', () => {
  const formats = ['msgpack', 'cbor'] as const
  const roundTrip = (json: string, format: (typeof formats)[number]): string =>
    decodePayload(encodePayload(json, format), format, { pretty: false }).text

  it.each(formats)('%s: integers beyond 2^53 decode back exactly', (format) => {
    for (const json of [
      '{"id":9007199254740993}',
      '{"big":12345678901234567890}',
      '[18446744073709551615,-9223372036854775808,-9007199254740993]'
    ]) {
      expect(roundTrip(json, format)).toBe(json)
    }
    expect(
      msgpackDecode(encodePayload('{"id":9007199254740993}', 'msgpack'), { useBigInt64: true })
    ).toEqual({ id: 9007199254740993n })
  })

  it('writes them as 64-bit integers, not floats', () => {
    expect(toHex(encodePayload('9007199254740993', 'msgpack'), '')).toBe('cf0020000000000001')
    expect(toHex(encodePayload('9007199254740993', 'cbor'), '')).toBe('1b0020000000000001')
    // Safe integers beyond 32 bits stay integers too (a millisecond timestamp, say).
    expect(toHex(encodePayload('1700000000000', 'msgpack'), '')).toBe('cf0000018bcfe56800')
    expect(toHex(encodePayload('-5000000000', 'msgpack'), '')).toBe('d3fffffffed5fa0e00')
  })

  it('keeps -0 a float', () => {
    expect(toHex(encodePayload('{"z":-0}', 'msgpack'), '')).toBe('81a17acb8000000000000000')
    expect(toHex(encodePayload('{"z":-0}', 'cbor'), '')).toBe('a1617af98000')
    expect(roundTrip('{"z":-0}', 'msgpack')).toBe('{"z":-0}')
    expect(roundTrip('[-0,0]', 'cbor')).toBe('[-0,0]')
  })

  it('refuses an integer MessagePack cannot hold; CBOR writes a bignum', () => {
    expect(() => encodePayload('{"n":18446744073709551616}', 'msgpack')).toThrow(PayloadError)
    expect(() => encodePayload('{"n":18446744073709551616}', 'msgpack')).toThrow(
      'Integer 18446744073709551616 cannot be represented exactly in MessagePack (64 bits at most)'
    )
    expect(toHex(encodePayload('18446744073709551616', 'cbor'), '')).toBe('c249010000000000000000')
    expect(roundTrip('[18446744073709551616,-18446744073709551617]', 'cbor')).toBe(
      '[18446744073709551616,-18446744073709551617]'
    )
  })

  it('follows JSON.parse for duplicate keys, nesting and __proto__ keys', () => {
    const big = '12345678901234567890'
    expect(roundTrip(`{"a":${big},"a":1}`, 'msgpack')).toBe('{"a":1}')
    expect(roundTrip(`{"a":1,"a":${big}}`, 'msgpack')).toBe(`{"a":${big}}`)
    expect(roundTrip(`{"a":{"x":${big}},"a":{"x":2}}`, 'cbor')).toBe('{"a":{"x":2}}')
    expect(roundTrip(`[[1,${big}],{"x":[${big}]},"${big}"]`, 'msgpack')).toBe(
      `[[1,${big}],{"x":[${big}]},"${big}"]`
    )
    // A `__proto__` key stays an own key (the MessagePack decoder refuses to read one back).
    expect(toHex(encodePayload(`{"__proto__":${big}}`, 'msgpack'), '')).toBe(
      '81a95f5f70726f746f5f5fcfab54a98ceb1f0ad2'
    )
    expect(roundTrip(`{"__proto__":${big}}`, 'cbor')).toBe(`{"__proto__":${big}}`)
    expect(roundTrip(`{"k\\"ey":${big}}`, 'msgpack')).toBe(`{"k\\"ey":${big}}`)
    expect(roundTrip(big, 'msgpack')).toBe(big)
  })

  it('keeps floats floats', () => {
    expect(roundTrip('[1e300,1.5,-2.25,12345678901234567890.5]', 'msgpack')).toBe(
      '[1e+300,1.5,-2.25,12345678901234567000]'
    )
  })
})
