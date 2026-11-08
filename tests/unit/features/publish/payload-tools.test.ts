/**
 * HEALTH-05: the publish helpers that change what is sent — template-aware JSON formatting and
 * the conversion between authoring formats.
 */
import { describe, expect, it } from 'vitest'
import { encodePayload, PayloadError } from '@shared/payload'
import {
  convertPayload,
  editorLanguage,
  FORMAT_META,
  isJsonAuthored,
  previewText,
  reformatJson
} from '@/features/publish/utils/payload-tools'

describe('reformatJson', () => {
  it('pretty prints and minifies plain JSON, keeping values as written', () => {
    expect(reformatJson('{"a":1,"b":[1.50,true]}', 'pretty')).toBe(
      '{\n  "a": 1,\n  "b": [\n    1.50,\n    true\n  ]\n}'
    )
    expect(reformatJson('{\n  "a" : 1 ,\n "b": "x y"\n}', 'minify')).toBe('{"a":1,"b":"x y"}')
  })

  it('keeps {{template}} tokens, bare and inside strings, exactly as written', () => {
    const source = '{"id":"{{uuid}}","temp":{{random(18,25)}},"at":{{timestamp}}}'
    const pretty = reformatJson(source, 'pretty')
    expect(pretty).toBe(
      '{\n  "id": "{{uuid}}",\n  "temp": {{random(18,25)}},\n  "at": {{timestamp}}\n}'
    )
    expect(reformatJson(pretty, 'minify')).toBe(source)
  })

  it('leaves look-alike numbers alone', () => {
    const source = '{"n":-0.123456789,"t":{{counter}}}'
    expect(reformatJson(source, 'minify')).toBe(source)
  })

  it('throws a human error for invalid JSON', () => {
    expect(() => reformatJson('{"a":', 'pretty')).toThrow(PayloadError)
    expect(() => reformatJson('{"a":', 'pretty')).toThrow(/^Invalid JSON/)
    expect(() => reformatJson('{"a": {{x}}', 'minify')).toThrow(/^Invalid JSON/)
  })
})

describe('convertPayload', () => {
  /** `text` authored in `from`, converted to `to` and back. */
  function roundTrip(
    text: string,
    from: 'text' | 'json' | 'msgpack',
    to: 'hex' | 'base64'
  ): { converted: string | null; back: string | null } {
    const converted = convertPayload(text, from, to)
    expect(converted).not.toBeNull()
    return { converted, back: convertPayload(converted ?? '', to, from) }
  }

  it('round-trips text through hex and base64', () => {
    expect(convertPayload('Hello', 'text', 'hex')).toBe('48 65 6c 6c 6f')
    expect(convertPayload('Hello', 'text', 'base64')).toBe('SGVsbG8=')
    expect(roundTrip('Grüße €', 'text', 'hex').back).toBe('Grüße €')
    expect(roundTrip('Grüße €', 'text', 'base64').back).toBe('Grüße €')
  })

  it('round-trips JSON and MessagePack through bytes', () => {
    expect(roundTrip('{"a":1}', 'json', 'hex').back).toBe('{"a":1}')
    const msgpack = roundTrip('{"a":1,"b":"x"}', 'msgpack', 'base64')
    expect(JSON.parse(msgpack.back ?? '')).toEqual({ a: 1, b: 'x' })
    // The bytes are the MessagePack encoding of the value.
    expect(convertPayload('{"a":1}', 'msgpack', 'hex')).toBe('81 a1 61 01')
  })

  it('sends the same bytes after converting', () => {
    const converted = convertPayload('{"temp":21.5}', 'json', 'base64') ?? ''
    expect(Array.from(encodePayload(converted, 'base64'))).toEqual(
      Array.from(encodePayload('{"temp":21.5}', 'json'))
    )
  })

  it('needs no conversion between formats authored as JSON', () => {
    expect(convertPayload('{"a":1}', 'json', 'msgpack')).toBeNull()
    expect(convertPayload('{"a":1}', 'cbor', 'json')).toBeNull()
    expect(convertPayload('abc', 'text', 'text')).toBeNull()
  })

  it('refuses what cannot be expressed or is invalid', () => {
    expect(convertPayload('zz', 'hex', 'text')).toBeNull() // not hex
    expect(convertPayload('{"a":', 'json', 'hex')).toBeNull() // invalid JSON
    expect(convertPayload('ff fe', 'hex', 'text')).toBeNull() // not UTF-8
    expect(convertPayload('not json', 'text', 'json')).toBeNull()
  })

  it('refuses MessagePack and CBOR values that JSON cannot write (NaN, ±Infinity)', () => {
    const msgpack = {
      nan: 'cb 7f f8 00 00 00 00 00 00',
      infinity: 'cb 7f f0 00 00 00 00 00 00',
      minusInfinity: 'cb ff f0 00 00 00 00 00 00',
      float32Nan: 'ca 7f c0 00 00',
      nanInMap: '81 a1 78 cb 7f f8 00 00 00 00 00 00' // {"x": NaN}
    }
    for (const [name, hex] of Object.entries(msgpack)) {
      expect(convertPayload(hex, 'hex', 'msgpack'), name).toBeNull()
    }
    const cbor = {
      nan: 'f9 7e 00',
      infinity: 'f9 7c 00',
      minusInfinity: 'f9 fc 00',
      nanInArray: '82 01 f9 7e 00' // [1, NaN]
    }
    for (const [name, hex] of Object.entries(cbor)) {
      expect(convertPayload(hex, 'hex', 'cbor'), name).toBeNull()
    }
  })

  it('still converts big integers and -0, which JSON can write, to the same bytes', () => {
    const big = 'cf 00 20 00 00 00 00 00 01' // uint64 9007199254740993 (above 2^53)
    const text = convertPayload(big, 'hex', 'msgpack')
    expect(text).toBe('9007199254740993')
    expect(convertPayload(text ?? '', 'msgpack', 'hex')).toBe(big)

    const negativeZero = 'cb 80 00 00 00 00 00 00 00'
    expect(convertPayload(negativeZero, 'hex', 'msgpack')).toBe('-0')
    expect(convertPayload('-0', 'msgpack', 'hex')).toBe(negativeZero)
    expect(convertPayload('a1 61 6e f9 3e 00', 'hex', 'cbor')).toBe('{\n  "n": 1.5\n}')
  })
})

describe('format metadata and previews', () => {
  it('authors MessagePack and CBOR as JSON', () => {
    expect(['json', 'msgpack', 'cbor'].every((f) => isJsonAuthored(f as 'json'))).toBe(true)
    expect(isJsonAuthored('text')).toBe(false)
    expect(editorLanguage('cbor')).toBe('json')
    expect(editorLanguage('hex')).toBe('text')
    expect(FORMAT_META.msgpack.short).toBe('MsgPack')
  })

  it('collapses whitespace and cuts long previews', () => {
    expect(previewText('  a\n\n  b\tc ')).toBe('a b c')
    expect(previewText('x'.repeat(200), 10)).toBe(`${'x'.repeat(10)}…`)
  })
})
