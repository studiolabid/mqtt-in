import { describe, expect, it } from 'vitest'
import {
  fromBase64,
  fromHex,
  isPrintableText,
  isValidUtf8,
  PayloadError,
  toBase64,
  toHex,
  utf8Decode,
  utf8Encode
} from '@shared/payload'
import { allByteValues, bytes, pseudoRandomBytes, sameBytes, utf8 } from './helpers'

const ONE_MB = 1024 * 1024

describe('utf8Encode / utf8Decode', () => {
  it('round trips multilingual text, emoji and whitespace', () => {
    const text = 'héllo wörld · 日本語 · 😀👍🏽 · \t\r\n'
    expect(utf8Decode(utf8Encode(text))).toBe(text)
    expect(utf8Encode('€')).toEqual(bytes(0xe2, 0x82, 0xac))
  })

  it('maps the empty string to zero bytes and back', () => {
    expect(utf8Encode('')).toEqual(new Uint8Array(0))
    expect(utf8Decode(new Uint8Array(0))).toBe('')
  })

  it('decodes invalid sequences leniently with U+FFFD', () => {
    expect(utf8Decode(bytes(0x61, 0xff, 0x62))).toBe('a�b')
    expect(utf8Decode(bytes(0x61, 0xe2, 0x82))).toBe('a�')
  })
})

describe('isValidUtf8', () => {
  it.each<[string, Uint8Array, boolean]>([
    ['empty', new Uint8Array(0), true],
    ['ascii', utf8('hello'), true],
    ['multi-byte', utf8('日本語 😀'), true],
    ['invalid byte 0xff', bytes(0xff), false],
    ['lone continuation byte', bytes(0x80), false],
    ['truncated sequence', bytes(0xe2, 0x82), false],
    ['overlong encoding', bytes(0xc0, 0x80), false],
    ['encoded surrogate', bytes(0xed, 0xa0, 0x80), false]
  ])('%s → %s', (_label, input, expected) => {
    expect(isValidUtf8(input)).toBe(expected)
  })
})

describe('isPrintableText', () => {
  it.each<[string, Uint8Array, boolean]>([
    ['empty payload', new Uint8Array(0), true],
    ['plain text', utf8('hello world'), true],
    ['tabs and newlines', utf8('a\tb\r\nc\n'), true],
    ['emoji and CJK', utf8('温度 23°C 🌡️'), true],
    ['NUL', bytes(0x61, 0x00), false],
    ['BEL', bytes(0x07), false],
    ['vertical tab', bytes(0x0b), false],
    ['form feed', bytes(0x0c), false],
    ['escape', bytes(0x1b, 0x5b, 0x30, 0x6d), false],
    ['DEL', bytes(0x7f), false],
    ['invalid UTF-8', bytes(0x61, 0xff), false],
    ['truncated multi-byte character', bytes(0x61, 0xe2, 0x82), false],
    // Debatable: C1 controls (U+0080..U+009F) are not treated as control characters.
    ['C1 control U+0085 (accepted)', bytes(0xc2, 0x85), true]
  ])('%s → %s', (_label, input, expected) => {
    expect(isPrintableText(input)).toBe(expected)
  })
})

describe('toHex', () => {
  it('returns an empty string for no bytes', () => {
    expect(toHex(new Uint8Array(0))).toBe('')
    expect(toHex(new Uint8Array(0), ' ', 16)).toBe('')
  })

  it('encodes all 256 byte values in lower case', () => {
    const all = allByteValues()
    expect(toHex(all, '')).toBe(Buffer.from(all).toString('hex'))
  })

  it('separates bytes with a space by default', () => {
    expect(toHex(bytes(0xde, 0xad, 0xbe, 0xef))).toBe('de ad be ef')
  })

  it('supports custom separators', () => {
    expect(toHex(bytes(0x00, 0x0f, 0xff), ':')).toBe('00:0f:ff')
  })

  it('wraps lines every bytesPerLine bytes', () => {
    const lines = toHex(
      Uint8Array.from({ length: 33 }, (_, i) => i),
      ' ',
      16
    ).split('\n')
    expect(lines).toHaveLength(3)
    expect(lines[0]).toBe('00 01 02 03 04 05 06 07 08 09 0a 0b 0c 0d 0e 0f')
    expect(lines[1].split(' ')).toHaveLength(16)
    expect(lines[2]).toBe('20')
  })

  it('uses a space when wrapping with an empty separator', () => {
    expect(toHex(bytes(1, 2, 3), '', 2)).toBe('01 02\n03')
  })
})

describe('fromHex', () => {
  it('parses an empty or whitespace-only string as zero bytes', () => {
    expect(fromHex('')).toEqual(new Uint8Array(0))
    expect(fromHex(' \n\t ')).toEqual(new Uint8Array(0))
  })

  it('round trips all 256 byte values in lower and upper case', () => {
    const all = allByteValues()
    expect(fromHex(toHex(all))).toEqual(all)
    expect(fromHex(toHex(all, '').toUpperCase())).toEqual(all)
  })

  it('round trips a 1 MB buffer', () => {
    const big = pseudoRandomBytes(ONE_MB)
    const text = toHex(big, '')
    expect(text).toHaveLength(ONE_MB * 2)
    expect(sameBytes(fromHex(text), big)).toBe(true)
    expect(sameBytes(fromHex(toHex(big, ' ', 16)), big)).toBe(true)
  })

  it.each([
    '0xDE 0xAD 0xBE 0xEF',
    '0xdeadbeef',
    'de:ad:be:ef',
    'de-ad-be-ef',
    'de,ad,be,ef',
    'DE AD\nBE\tEF',
    '0XdeAD 0xbEeF',
    '  deadbeef  '
  ])('tolerates prefixes and separators in %j', (input) => {
    expect(fromHex(input)).toEqual(bytes(0xde, 0xad, 0xbe, 0xef))
  })

  it('rejects non-hex characters with a PayloadError', () => {
    expect(() => fromHex('zz')).toThrow(PayloadError)
    expect(() => fromHex('12 3g')).toThrow('Invalid hex: only 0-9 and a-f are allowed')
    expect(() => fromHex('de ad;')).toThrow('Invalid hex: only 0-9 and a-f are allowed')
  })

  it('rejects an odd number of digits', () => {
    expect(() => fromHex('abc')).toThrow(PayloadError)
    expect(() => fromHex('0xa')).toThrow('Invalid hex: odd number of digits')
  })

  it('names its errors PayloadError', () => {
    try {
      fromHex('x')
      expect.unreachable()
    } catch (err) {
      expect(err).toBeInstanceOf(Error)
      expect((err as Error).name).toBe('PayloadError')
    }
  })
})

describe('toBase64 / fromBase64', () => {
  it('handles empty input', () => {
    expect(toBase64(new Uint8Array(0))).toBe('')
    expect(fromBase64('')).toEqual(new Uint8Array(0))
  })

  it('matches the reference encoding for all 256 byte values and round trips', () => {
    const all = allByteValues()
    const text = toBase64(all)
    expect(text).toBe(Buffer.from(all).toString('base64'))
    expect(fromBase64(text)).toEqual(all)
  })

  it('round trips a 1 MB buffer (larger than one encoder chunk)', () => {
    const big = pseudoRandomBytes(ONE_MB + 7)
    const text = toBase64(big)
    expect(text).toBe(Buffer.from(big).toString('base64'))
    expect(sameBytes(fromBase64(text), big)).toBe(true)
  })

  it.each<[string, string]>([
    ['YQ==', 'a'],
    ['YQ', 'a'],
    ['YWI=', 'ab'],
    ['YWI', 'ab'],
    ['YWJj', 'abc'],
    ['YWJjZA', 'abcd']
  ])('decodes %j with or without padding', (input, expected) => {
    expect(utf8Decode(fromBase64(input))).toBe(expected)
  })

  it('accepts the URL-safe alphabet', () => {
    const data = bytes(0xfb, 0xff, 0xfe, 0x3e, 0x3f)
    const standard = toBase64(data)
    expect(standard).toBe('+//+Pj8=')
    expect(fromBase64('-__-Pj8')).toEqual(data)
    expect(fromBase64('-__-Pj8=')).toEqual(data)
  })

  it('ignores whitespace and line breaks (MIME style)', () => {
    expect(utf8Decode(fromBase64(' aGVs\nbG8g\r\nd29y bGQ= '))).toBe('hello world')
  })

  it.each<[string, string]>([
    ['a', 'Invalid base64 length'],
    ['abcde', 'Invalid base64 length'],
    ['@@@@', 'Invalid base64 string'],
    ['YQ==YQ==', 'Invalid base64 string'],
    ['YQ===', 'Invalid base64 string'],
    ['YQ*=', 'Invalid base64 string']
  ])('rejects %j', (input, message) => {
    expect(() => fromBase64(input)).toThrow(PayloadError)
    expect(() => fromBase64(input)).toThrow(message)
  })

  it('round trips buffers of every length 0..64 (all padding cases, URL-safe, unpadded)', () => {
    for (let length = 0; length <= 64; length++) {
      const data = pseudoRandomBytes(length, length + 1)
      const text = toBase64(data)
      expect(text).toBe(Buffer.from(data).toString('base64'))
      expect(fromBase64(text)).toEqual(data)
      expect(fromBase64(Buffer.from(data).toString('base64url'))).toEqual(data)
      expect(fromHex(toHex(data, ':'))).toEqual(data)
    }
  })

  it('is lenient about padding-only input (debatable: decodes to zero bytes)', () => {
    expect(fromBase64('=')).toEqual(new Uint8Array(0))
    expect(fromBase64('==')).toEqual(new Uint8Array(0))
  })
})
