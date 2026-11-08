import { encode as msgpackEncode } from '@msgpack/msgpack'
import { encode as cborEncode } from 'cborg'
import { describe, expect, it } from 'vitest'
import { decodePayload, payloadPreview } from '@shared/payload'
import { bytes, concat, utf8 } from './helpers'

describe('decodePayload with maxBytes', () => {
  it('only reports truncation when the payload is longer than maxBytes', () => {
    expect(decodePayload(utf8('hello'), 'text', { maxBytes: 5 }).truncated).toBe(false)
    expect(decodePayload(utf8('hello'), 'text', { maxBytes: 100 }).truncated).toBe(false)
    expect(decodePayload(utf8('hello!'), 'text', { maxBytes: 5 }).truncated).toBe(true)
  })

  describe('text', () => {
    it('decodes the prefix', () => {
      expect(decodePayload(utf8('hello world'), 'text', { maxBytes: 5 })).toEqual({
        format: 'text',
        text: 'hello',
        json: false,
        truncated: true
      })
    })

    it('drops a multi-byte character cut in half instead of showing U+FFFD', () => {
      // 'a€b' = 61 e2 82 ac 62: the cut after 3 bytes splits the euro sign
      expect(decodePayload(utf8('a€b'), 'text', { maxBytes: 3 }).text).toBe('a')
      expect(decodePayload(utf8('a😀b'), 'text', { maxBytes: 4 }).text).toBe('a')
      expect(decodePayload(utf8('a€b'), 'text', { maxBytes: 4 }).text).toBe('a€')
    })

    it('keeps genuinely invalid bytes visible as U+FFFD', () => {
      expect(decodePayload(bytes(0x61, 0xff, 0x62, 0x63), 'text', { maxBytes: 3 }).text).toBe('a�b')
    })
  })

  describe('json', () => {
    it('returns the raw prefix without validating it (no error, not highlighted)', () => {
      expect(decodePayload(utf8('{"a":"bcdef"}'), 'json', { maxBytes: 6 })).toEqual({
        format: 'json',
        text: '{"a":"',
        json: false,
        truncated: true
      })
    })
  })

  describe('auto', () => {
    it('detects JSON from the first character of a truncated document', () => {
      expect(decodePayload(utf8('  [1,2,3,4]'), 'auto', { maxBytes: 4 })).toEqual({
        format: 'json',
        text: '  [1',
        json: false,
        truncated: true
      })
    })

    it('detects text on a truncated prefix', () => {
      expect(decodePayload(utf8('hello world'), 'auto', { maxBytes: 5 })).toMatchObject({
        format: 'text',
        text: 'hello'
      })
    })

    it('does not mistake a character cut at the boundary for binary', () => {
      expect(decodePayload(utf8('aaa€€'), 'auto', { maxBytes: 5 })).toMatchObject({
        format: 'text',
        text: 'aaa',
        truncated: true
      })
    })

    it('detects binary anywhere in the prefix, including its last bytes', () => {
      const data = concat(utf8('abc'), bytes(0x00, 0x01, 0x02), utf8('xyz'))
      expect(decodePayload(data, 'auto', { maxBytes: 6 })).toMatchObject({
        format: 'hex',
        text: '61 62 63 00 01 02',
        truncated: true
      })
    })

    it('detects binary at the start of the prefix', () => {
      expect(decodePayload(bytes(0xff, 0x61, 0x62, 0x63), 'auto', { maxBytes: 3 }).format).toBe(
        'hex'
      )
    })
  })

  it('hex: encodes the prefix only', () => {
    expect(decodePayload(bytes(1, 2, 3, 4), 'hex', { maxBytes: 2 })).toEqual({
      format: 'hex',
      text: '01 02',
      json: false,
      truncated: true
    })
  })

  it('base64: encodes the prefix only', () => {
    expect(decodePayload(utf8('hello'), 'base64', { maxBytes: 3 })).toEqual({
      format: 'base64',
      text: 'aGVs',
      json: false,
      truncated: true
    })
  })

  it.each<['msgpack' | 'cbor', Uint8Array, string]>([
    ['msgpack', msgpackEncode({ a: 1 }), 'MessagePack'],
    ['cbor', cborEncode({ a: 1 }), 'CBOR']
  ])('%s: falls back to hex of the prefix with an error', (format, data, name) => {
    expect(decodePayload(data, format, { maxBytes: 2 })).toEqual({
      format,
      text: Array.from(data.subarray(0, 2), (b) => b.toString(16).padStart(2, '0')).join(' '),
      json: false,
      error: `Payload truncated — ${name} cannot be partially decoded`,
      truncated: true
    })
  })

  it('maxBytes 0 yields an empty, truncated result', () => {
    expect(decodePayload(utf8('abc'), 'auto', { maxBytes: 0 })).toEqual({
      format: 'text',
      text: '',
      json: false,
      truncated: true
    })
  })

  it('cuts text at every position without splitting characters', () => {
    const text = 'aé€😀b温度 😀'
    const data = utf8(text)
    for (let max = 0; max <= data.length; max++) {
      const decoded = decodePayload(data, 'text', { maxBytes: max }).text
      expect(text.startsWith(decoded)).toBe(true)
      expect(decoded).not.toContain('�')
      // at most one (up to 4-byte) character is dropped
      expect(utf8(decoded).length).toBeGreaterThan(max - 4)
      expect(decodePayload(data, 'auto', { maxBytes: max }).format).toBe('text')
    }
  })

  it('treats a negative maxBytes like 0', () => {
    expect(decodePayload(utf8('abc'), 'text', { maxBytes: -2 })).toMatchObject({
      text: '',
      truncated: true
    })
  })
})

describe('payloadPreview', () => {
  it('returns an empty string for an empty payload', () => {
    expect(payloadPreview(new Uint8Array(0), 'auto')).toBe('')
  })

  it('collapses whitespace runs and trims', () => {
    expect(payloadPreview(utf8('  line 1\n\n\tline 2  \r\n'), 'auto')).toBe('line 1 line 2')
  })

  it('keeps JSON on one line as authored', () => {
    expect(payloadPreview(utf8('{\n  "a": 1,\n  "b": [1, 2]\n}'), 'auto')).toBe(
      '{ "a": 1, "b": [1, 2] }'
    )
  })

  it('previews binary as single-line hex', () => {
    expect(
      payloadPreview(
        Uint8Array.from({ length: 20 }, (_, i) => i),
        'auto'
      )
    ).toBe('00 01 02 03 04 05 06 07 08 09 0a 0b 0c 0d 0e 0f 10 11 12 13')
  })

  it('previews MessagePack and CBOR as compact JSON', () => {
    expect(payloadPreview(msgpackEncode({ a: [1, 2] }), 'msgpack')).toBe('{"a":[1,2]}')
    expect(payloadPreview(cborEncode({ a: [1, 2] }), 'cbor')).toBe('{"a":[1,2]}')
  })

  it('cuts off at maxChars with an ellipsis', () => {
    expect(payloadPreview(utf8('abcdefghij'), 'text', 5)).toBe('abcde…')
    expect(payloadPreview(utf8('abcde'), 'text', 5)).toBe('abcde')
  })

  it('uses 240 characters by default', () => {
    expect(payloadPreview(utf8('x'.repeat(500)), 'text')).toBe(`${'x'.repeat(240)}…`)
  })

  it('cuts after collapsing whitespace', () => {
    expect(payloadPreview(utf8(`a${' '.repeat(50)}b${'\n'.repeat(50)}c`), 'text', 5)).toBe('a b c')
  })

  it('only decodes a bounded prefix of huge payloads', () => {
    const huge = new Uint8Array(4 * 1024 * 1024).fill(0x61)
    expect(payloadPreview(huge, 'auto')).toBe(`${'a'.repeat(240)}…`)
  })

  it('previews large MessagePack payloads as hex (prefix cannot be decoded; debatable)', () => {
    const data = msgpackEncode({ data: 'x'.repeat(2000) })
    expect(payloadPreview(data, 'msgpack', 20)).toBe('81 a4 64 61 74 61 da…')
  })
})
