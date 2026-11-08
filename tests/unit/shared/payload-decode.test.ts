import { encode as msgpackEncode } from '@msgpack/msgpack'
import { describe, expect, it } from 'vitest'
import type { PayloadFormat } from '@shared/models'
import { decodePayload, detectFormat, VIEW_FORMATS } from '@shared/payload'
import { bytes, concat, pseudoRandomBytes, seededRandom, utf8 } from './helpers'

describe('detectFormat', () => {
  it.each<[string, Uint8Array, PayloadFormat]>([
    ['empty payload', new Uint8Array(0), 'text'],
    ['JSON object', utf8('{"a":1}'), 'json'],
    ['JSON array', utf8('[1,2,3]'), 'json'],
    ['JSON with leading whitespace', utf8('\n  {"a":1}  '), 'json'],
    ['JSON with a UTF-8 BOM', concat(bytes(0xef, 0xbb, 0xbf), utf8('{"a":1}')), 'json'],
    ['number', utf8('42'), 'text'],
    ['negative float', utf8('-1.5e3'), 'text'],
    ['JSON string', utf8('"hello"'), 'text'],
    ['boolean', utf8('true'), 'text'],
    ['null', utf8('null'), 'text'],
    ['plain text', utf8('hello world'), 'text'],
    ['broken JSON object', utf8('{"a":'), 'text'],
    ['text starting with a bracket', utf8('[INFO] started'), 'text'],
    ['multi-line text', utf8('line 1\nline 2\r\n\tindented'), 'text'],
    ['NUL byte', bytes(0x00), 'hex'],
    ['binary', bytes(0xde, 0xad, 0xbe, 0xef), 'hex'],
    ['MessagePack', msgpackEncode({ a: 1 }), 'hex'],
    ['text with a control character', utf8('abc\u0007'), 'hex']
  ])('%s → %s', (_label, input, expected) => {
    expect(detectFormat(input)).toBe(expected)
  })
})

describe('decodePayload', () => {
  describe('auto', () => {
    it('pretty prints detected JSON', () => {
      expect(decodePayload(utf8('{"a":1,"b":[1,2]}'), 'auto')).toEqual({
        format: 'json',
        text: '{\n  "a": 1,\n  "b": [\n    1,\n    2\n  ]\n}',
        json: true,
        truncated: false
      })
    })

    it('keeps the original JSON text when pretty is false', () => {
      expect(decodePayload(utf8('{ "a" : 1 }'), 'auto', { pretty: false })).toEqual({
        format: 'json',
        text: '{ "a" : 1 }',
        json: true,
        truncated: false
      })
    })

    it('shows text and number text as text', () => {
      expect(decodePayload(utf8('hello\nworld'), 'auto')).toEqual({
        format: 'text',
        text: 'hello\nworld',
        json: false,
        truncated: false
      })
      expect(decodePayload(utf8('23.5'), 'auto').format).toBe('text')
    })

    it('shows binary as hex: 16-byte lines when pretty, one line when compact', () => {
      const data = Uint8Array.from({ length: 20 }, (_, i) => i)
      const pretty = decodePayload(data, 'auto')
      expect(pretty.format).toBe('hex')
      expect(pretty.text.split('\n')).toEqual([
        '00 01 02 03 04 05 06 07 08 09 0a 0b 0c 0d 0e 0f',
        '10 11 12 13'
      ])
      expect(pretty.error).toBeUndefined()
      expect(decodePayload(data, 'auto', { pretty: false }).text).not.toContain('\n')
    })

    it('strips a UTF-8 BOM from detected JSON', () => {
      const result = decodePayload(concat(bytes(0xef, 0xbb, 0xbf), utf8('{"a":1}')), 'auto')
      expect(result).toMatchObject({ format: 'json', text: '{\n  "a": 1\n}', json: true })
    })
  })

  describe('text', () => {
    it('decodes UTF-8', () => {
      expect(decodePayload(utf8('温度 23°C'), 'text')).toEqual({
        format: 'text',
        text: '温度 23°C',
        json: false,
        truncated: false
      })
    })

    it('decodes binary leniently with U+FFFD and no error', () => {
      expect(decodePayload(bytes(0x61, 0xff), 'text')).toEqual({
        format: 'text',
        text: 'a�',
        json: false,
        truncated: false
      })
    })

    it('ignores the pretty option', () => {
      expect(decodePayload(utf8('{"a":1}'), 'text', { pretty: true }).text).toBe('{"a":1}')
    })
  })

  describe('json', () => {
    it('pretty prints valid JSON (including scalars)', () => {
      expect(decodePayload(utf8('[1,{"b":null}]'), 'json')).toEqual({
        format: 'json',
        text: '[\n  1,\n  {\n    "b": null\n  }\n]',
        json: true,
        truncated: false
      })
      expect(decodePayload(utf8('42'), 'json')).toMatchObject({ text: '42', json: true })
    })

    it('keeps the original text when pretty is false', () => {
      expect(decodePayload(utf8('{ "a":1 }'), 'json', { pretty: false }).text).toBe('{ "a":1 }')
    })

    it('keeps big integers, number literals and key order exactly when pretty printing', () => {
      expect(decodePayload(utf8('{"z":1.0,"id":12345678901234567890,"1":0}'), 'json').text).toBe(
        '{\n  "z": 1.0,\n  "id": 12345678901234567890,\n  "1": 0\n}'
      )
    })

    it('reports invalid JSON and keeps the raw text', () => {
      const result = decodePayload(utf8('{"a":'), 'json')
      expect(result).toMatchObject({ format: 'json', text: '{"a":', json: false, truncated: false })
      expect(result.error).toMatch(/^Invalid JSON: /)
    })
  })

  describe('hex', () => {
    it('shows any payload as hex', () => {
      expect(decodePayload(utf8('hi'), 'hex')).toEqual({
        format: 'hex',
        text: '68 69',
        json: false,
        truncated: false
      })
    })

    it('wraps every 16 bytes when pretty and stays on one line when compact', () => {
      const data = new Uint8Array(17)
      expect(decodePayload(data, 'hex').text.split('\n')).toHaveLength(2)
      expect(decodePayload(data, 'hex', { pretty: false }).text.split('\n')).toHaveLength(1)
    })
  })

  describe('base64', () => {
    it('shows any payload as base64', () => {
      expect(decodePayload(utf8('hi'), 'base64')).toEqual({
        format: 'base64',
        text: 'aGk=',
        json: false,
        truncated: false
      })
      expect(decodePayload(bytes(0xff, 0xfe), 'base64').text).toBe('//4=')
    })
  })

  it('never throws for random bytes, any view format, pretty or not, any maxBytes', () => {
    const rand = seededRandom(7)
    for (let i = 0; i < 300; i++) {
      const data = pseudoRandomBytes(Math.floor(rand() * 64), i + 1)
      const maxBytes = rand() < 0.5 ? undefined : Math.floor(rand() * 80)
      for (const { value } of VIEW_FORMATS) {
        const result = decodePayload(data, value, { pretty: rand() < 0.5, maxBytes })
        expect(typeof result.text).toBe('string')
        expect(result.truncated).toBe(maxBytes !== undefined && data.length > maxBytes)
        if (value !== 'auto') expect(result.format).toBe(value)
      }
    }
  })

  describe('empty payloads', () => {
    it.each(VIEW_FORMATS.map((f) => f.value))('%s → empty text without an error', (format) => {
      const result = decodePayload(new Uint8Array(0), format)
      expect(result.text).toBe('')
      expect(result.error).toBeUndefined()
      expect(result.json).toBe(false)
      expect(result.truncated).toBe(false)
      expect(result.format).toBe(format === 'auto' ? 'text' : format)
    })
  })
})
