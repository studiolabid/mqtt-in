import { describe, expect, it } from 'vitest'
import {
  encodePayload,
  formatJsonc,
  jsonLineCommentStart,
  stripJsonComments,
  toHex,
  utf8Decode
} from '@shared/payload'

describe('stripJsonComments', () => {
  it('returns the same text when there is nothing to remove', () => {
    const text = '{"url":"http://a/b","list":[1,2]}'
    expect(stripJsonComments(text)).toBe(text)
  })

  it('removes whole-line comments with their line', () => {
    const text = '{\n  "id": 4,\n  // "min": 5,\n  "cmd": "timer"\n}'
    expect(stripJsonComments(text)).toBe('{\n  "id": 4,\n  "cmd": "timer"\n}')
  })

  it('removes a comment after a value and keeps the line break', () => {
    expect(stripJsonComments('{"a": 1, // note\n"b": 2}')).toBe('{"a": 1,\n"b": 2}')
  })

  it('removes trailing commas left by a commented-out last entry', () => {
    const text = '{\n  "id": 4,\n  "cmd": "timer",\n  // "min": 5\n}'
    expect(JSON.parse(stripJsonComments(text))).toEqual({ id: 4, cmd: 'timer' })
    expect(stripJsonComments('[1, 2, ]')).toBe('[1, 2 ]')
  })

  it('ignores // and commas inside strings', () => {
    const text = '{"a": "x // y", "b": "q,]", "c": "\\"//"}'
    expect(stripJsonComments(text)).toBe(text)
  })

  it('treats # like // (a whole line or after a value)', () => {
    const text = '{\n  "id": 4,\n  # "min": 5,\n  "cmd": "timer" # note\n}'
    expect(stripJsonComments(text)).toBe('{\n  "id": 4,\n  "cmd": "timer"\n}')
    expect(stripJsonComments('#\n[1]')).toBe('[1]')
    expect(stripJsonComments('{"tag": "#1"}')).toBe('{"tag": "#1"}')
  })

  it('handles CRLF and a commented-out whole payload', () => {
    expect(stripJsonComments('// {"a":1}\r\n{"b":2}')).toBe('{"b":2}')
    expect(stripJsonComments('// {"a":1}')).toBe('')
  })
})

describe('jsonLineCommentStart', () => {
  it('finds the comment of one line, skipping strings', () => {
    expect(jsonLineCommentStart('  // "min": 5')).toBe(2)
    expect(jsonLineCommentStart('"u": "http://x", // c')).toBe(17)
    expect(jsonLineCommentStart('"u": "http://x"')).toBe(-1)
    expect(jsonLineCommentStart('"open // string')).toBe(-1)
    expect(jsonLineCommentStart('  # {"a":1}')).toBe(2)
    expect(jsonLineCommentStart('"#": 1')).toBe(-1)
  })
})

describe('encodePayload with comments', () => {
  it('publishes JSON without the commented-out lines', () => {
    const text = '{\n  "id": 4,\n  "cmd": "timer",\n  // "min": 5\n}'
    expect(utf8Decode(encodePayload(text, 'json'))).toBe('{\n  "id": 4,\n  "cmd": "timer"\n}')
  })

  it('sends an empty payload when everything is commented out', () => {
    expect(encodePayload('// {"id":4}', 'json')).toHaveLength(0)
  })

  it('still rejects invalid JSON', () => {
    expect(() => encodePayload('{"a": // 1\n}', 'json')).toThrow(/Invalid JSON/)
  })

  it('strips comments for MessagePack too', () => {
    expect(toHex(encodePayload('{"a":1, // "b":2\n}', 'msgpack'), '')).toBe('81a16101')
  })
})

describe('formatJsonc', () => {
  it('keeps comments on their own lines and after values', () => {
    const text = '{"id":4,\n// "min":5\n"cmd":"timer", // why\n"n":[1,2]}'
    expect(formatJsonc(text)).toBe(
      '{\n  "id": 4,\n  // "min":5\n  "cmd": "timer", // why\n  "n": [\n    1,\n    2\n  ]\n}'
    )
  })

  it('keeps a commented-out last entry and drops the trailing comma', () => {
    const text = '{"id":4,"cmd":"timer",\n// "min":5\n}'
    expect(formatJsonc(text)).toBe('{\n  "id": 4,\n  "cmd": "timer"\n  // "min":5\n}')
  })

  it('keeps # comments as written', () => {
    expect(formatJsonc('{"a":1,\n# "b":2\n}')).toBe('{\n  "a": 1\n  # "b":2\n}')
  })

  it('keeps a leading comment', () => {
    expect(formatJsonc('// header\n{"a":1}')).toBe('// header\n{\n  "a": 1\n}')
  })

  it('formats its own output identically', () => {
    const once = formatJsonc('{"a":{"b":1, // c\n"d":[]},\n// e\n"f":null}')
    expect(formatJsonc(once)).toBe(once)
  })

  it('throws on invalid JSON', () => {
    expect(() => formatJsonc('{"a": // 1\n}')).toThrow(/Invalid JSON/)
  })
})
