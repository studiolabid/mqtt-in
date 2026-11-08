import { ExtData } from '@msgpack/msgpack'
import { describe, expect, it } from 'vitest'
import { formatJson, minifyJson, PayloadError, toDisplayJson, tryParseJson } from '@shared/payload'
import { bytes, seededRandom } from './helpers'

const SAMPLE = '{"a":1,"b":[true,null,{"c":"x"}],"d":{},"e":[],"f":{"g":[[]]}}'

/** Characters that stress the JSON scanner (escapes, structural chars, unicode, controls). */
const CHARS = [
  'a',
  'Z',
  '7',
  ' ',
  '"',
  '\\',
  '/',
  '{',
  '}',
  '[',
  ']',
  ',',
  ':',
  '\n',
  'é',
  '😀',
  '\u0001'
]

function randomString(rand: () => number): string {
  const length = Math.floor(rand() * 6)
  return Array.from({ length }, () => CHARS[Math.floor(rand() * CHARS.length)]).join('')
}

/** A random JSON-compatible value (objects / arrays nest up to 4 levels). */
function randomJsonValue(rand: () => number, depth = 0): unknown {
  switch (Math.floor(rand() * (depth >= 4 ? 4 : 6))) {
    case 0:
      return null
    case 1:
      return rand() < 0.5
    case 2:
      return rand() < 0.5 ? Math.floor(rand() * 2e9) - 1e9 : (rand() - 0.5) * 1e6
    case 3:
      return randomString(rand)
    case 4:
      return Array.from({ length: Math.floor(rand() * 4) }, () => randomJsonValue(rand, depth + 1))
    default:
      return Object.fromEntries(
        Array.from({ length: Math.floor(rand() * 4) }, (_, i) => [
          `${randomString(rand)}${i}`,
          randomJsonValue(rand, depth + 1)
        ])
      )
  }
}

describe('tryParseJson', () => {
  it('returns the parsed value', () => {
    expect(tryParseJson('{"a":[1,2]}')).toEqual({ ok: true, value: { a: [1, 2] } })
    expect(tryParseJson(' 42 ')).toEqual({ ok: true, value: 42 })
  })

  it('returns the parser message on failure', () => {
    const result = tryParseJson('{')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.length).toBeGreaterThan(0)
  })
})

describe('formatJson', () => {
  it('pretty prints with two spaces by default (same layout as JSON.stringify)', () => {
    expect(formatJson(SAMPLE)).toBe(JSON.stringify(JSON.parse(SAMPLE), null, 2))
  })

  it('supports a custom indent', () => {
    expect(formatJson('{"a":[1]}', 4)).toBe('{\n    "a": [\n        1\n    ]\n}')
  })

  it('minifies with indent 0', () => {
    expect(formatJson('{ "a" : [ 1 ] }', 0)).toBe('{"a":[1]}')
  })

  it('formats top-level scalars and trims surrounding whitespace', () => {
    expect(formatJson(' 42 ')).toBe('42')
    expect(formatJson('\n"x"\n')).toBe('"x"')
    expect(formatJson('null')).toBe('null')
  })

  it('is idempotent', () => {
    const once = formatJson(SAMPLE)
    expect(formatJson(once)).toBe(once)
  })

  it('keeps integers beyond 2^53 exactly', () => {
    expect(formatJson('{"id":12345678901234567890,"ns":1699999999999999999}')).toBe(
      '{\n  "id": 12345678901234567890,\n  "ns": 1699999999999999999\n}'
    )
  })

  it('keeps number literals and string escapes as written', () => {
    expect(formatJson('[1.50,1e3,-0,"caf\\u00e9","a\\"b","\\/"]')).toBe(
      '[\n  1.50,\n  1e3,\n  -0,\n  "caf\\u00e9",\n  "a\\"b",\n  "\\/"\n]'
    )
  })

  it('keeps key order (including integer-like keys) and duplicate keys', () => {
    expect(formatJson('{"b":1,"1":2,"b":3}')).toBe('{\n  "b": 1,\n  "1": 2,\n  "b": 3\n}')
  })

  it('does not touch structural characters inside strings', () => {
    expect(formatJson('{"k":"{[a, b]: c}","e":"\\\\"}')).toBe(
      '{\n  "k": "{[a, b]: c}",\n  "e": "\\\\"\n}'
    )
  })

  it('handles runs of escaped backslashes before quotes', () => {
    // JSON text ["\\\"",1]: an escaped backslash followed by an escaped quote
    expect(formatJson('["\\\\\\"",1]')).toBe('[\n  "\\\\\\"",\n  1\n]')
  })

  it('collapses whitespace inside empty containers', () => {
    expect(formatJson('{ "a": [ ], "b": { \n } }')).toBe('{\n  "a": [],\n  "b": {}\n}')
  })

  it('handles deep nesting', () => {
    const deep = `${'['.repeat(500)}{"a":1}${']'.repeat(500)}`
    expect(formatJson(deep)).toBe(JSON.stringify(JSON.parse(deep), null, 2))
  })

  it('matches JSON.stringify for generated documents (2 and 4 spaces, minified)', () => {
    const rand = seededRandom(42)
    for (let i = 0; i < 300; i++) {
      const value = randomJsonValue(rand)
      const compact = JSON.stringify(value)
      expect(formatJson(compact)).toBe(JSON.stringify(value, null, 2))
      expect(formatJson(compact, 4)).toBe(JSON.stringify(value, null, 4))
      expect(minifyJson(JSON.stringify(value, null, 2))).toBe(compact)
    }
  })

  it('throws a PayloadError for invalid JSON', () => {
    expect(() => formatJson('{a:1}')).toThrow(PayloadError)
    expect(() => formatJson('{a:1}')).toThrow(/^Invalid JSON: /)
    expect(() => formatJson('')).toThrow(/^Invalid JSON: /)
  })
})

describe('minifyJson', () => {
  it('removes whitespace outside strings only', () => {
    expect(minifyJson('{\n  "a b": [ 1, 2 ],\n  "c": "x  y"\n}')).toBe('{"a b":[1,2],"c":"x  y"}')
  })

  it('matches JSON.stringify for ordinary documents', () => {
    expect(minifyJson(formatJson(SAMPLE))).toBe(JSON.stringify(JSON.parse(SAMPLE)))
  })

  it('keeps big integers and number literals exactly', () => {
    expect(minifyJson('{ "id" : 12345678901234567890, "v": 1.0 }')).toBe(
      '{"id":12345678901234567890,"v":1.0}'
    )
  })

  it('throws a PayloadError for invalid JSON', () => {
    expect(() => minifyJson('[1,]')).toThrow(PayloadError)
    expect(() => minifyJson('[1,]')).toThrow(/^Invalid JSON: /)
  })
})

describe('toDisplayJson', () => {
  it('pretty prints with two spaces by default and compacts with indent 0', () => {
    expect(toDisplayJson({ a: [1] })).toBe('{\n  "a": [\n    1\n  ]\n}')
    expect(toDisplayJson({ a: [1] }, 0)).toBe('{"a":[1]}')
  })

  it('uses the default indent when indent is undefined', () => {
    expect(toDisplayJson({ a: 1 }, undefined)).toBe('{\n  "a": 1\n}')
  })

  it('renders safe bigints as numbers and unsafe ones as exact bare digits', () => {
    const value = { small: 42n, max: 2n ** 53n - 1n, big: 2n ** 64n - 1n, neg: -(2n ** 63n) }
    expect(toDisplayJson(value, 0)).toBe(
      '{"small":42,"max":9007199254740991,"big":18446744073709551615,"neg":-9223372036854775808}'
    )
  })

  it('renders binary as 0x-prefixed hex', () => {
    expect(toDisplayJson({ b: bytes(0xde, 0xad), e: new Uint8Array(0) }, 0)).toBe(
      '{"b":"0xdead","e":"0x"}'
    )
  })

  it('renders MessagePack extension values', () => {
    expect(toDisplayJson([new ExtData(5, bytes(1, 2))], 0)).toBe('[{"$ext":5,"data":"0x0102"}]')
  })

  it('converts Maps (nested, non-string keys) and Sets', () => {
    const value = new Map<unknown, unknown>([
      [1, 'one'],
      ['nested', new Map([['x', new Set([1, 2])]])],
      ['list', [new Map([[true, null]])]]
    ])
    expect(toDisplayJson(value, 0)).toBe('{"1":"one","nested":{"x":[1,2]},"list":[{"true":null}]}')
  })

  it('renders byte-string Map keys as hex', () => {
    expect(toDisplayJson(new Map([[bytes(0xab, 0xcd), 1]]), 0)).toBe('{"0xabcd":1}')
  })

  it('renders Dates as ISO strings (invalid dates as null)', () => {
    const at = new Date(Date.UTC(2024, 0, 2, 3, 4, 5, 678))
    expect(toDisplayJson({ at, bad: new Date(NaN) }, 0)).toBe(
      '{"at":"2024-01-02T03:04:05.678Z","bad":null}'
    )
  })

  it('renders undefined as null at the root, in objects and in arrays', () => {
    expect(toDisplayJson(undefined)).toBe('null')
    expect(toDisplayJson({ a: undefined }, 0)).toBe('{"a":null}')
    expect(toDisplayJson([undefined], 0)).toBe('[null]')
  })

  it('falls back to "null" for root values JSON cannot represent', () => {
    expect(toDisplayJson(() => 1)).toBe('null')
    expect(toDisplayJson(Symbol('x'))).toBe('null')
  })

  it('shows NaN, ±Infinity and -0 as they are (display only, not valid JSON)', () => {
    expect(toDisplayJson([NaN, Infinity, -Infinity, -0, 0], 0)).toBe(
      '[NaN,Infinity,-Infinity,-0,0]'
    )
    expect(toDisplayJson({ v: NaN, nested: new Map([['w', -0]]) })).toBe(
      '{\n  "v": NaN,\n  "nested": {\n    "w": -0\n  }\n}'
    )
    expect(toDisplayJson(NaN)).toBe('NaN')
    expect(toDisplayJson(2n ** 70n)).toBe('1180591620717411303424')
  })

  it('never mistakes a string for one of its number placeholders', () => {
    const strings = { a: '__mqttin_x_0__', b: '"__mqttin_0__"', n: NaN }
    expect(toDisplayJson(strings, 0)).toBe(
      '{"a":"__mqttin_x_0__","b":"\\"__mqttin_0__\\"","n":NaN}'
    )
  })
})
