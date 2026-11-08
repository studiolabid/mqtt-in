import { describe, expect, it } from 'vitest'
import { extractNumbers, NUMERIC_LIMITS } from '@/utils/numeric'
import { utf8 } from './helpers'

function extract(text: string): Record<string, number> | null {
  return extractNumbers(utf8(text))
}

describe('extractNumbers', () => {
  it.each([
    ['23.5', 23.5],
    [' -4 ', -4],
    ['+7', 7],
    ['1e3', 1000],
    ['.5', 0.5],
    ['42', 42],
    ['0', 0]
  ])('reads numeric text %j', (text, value) => {
    expect(extract(text)).toEqual({ value })
  })

  it('maps true / false (any case) to 1 / 0', () => {
    expect(extract('true')).toEqual({ value: 1 })
    expect(extract(' FALSE ')).toEqual({ value: 0 })
  })

  it.each(['', '   ', 'abc', '0x1A', 'NaN', 'Infinity', '12 apples', '1,5', '"12"', 'null'])(
    'returns null for %j',
    (text) => {
      expect(extract(text)).toBeNull()
    }
  )

  it('returns null for binary or empty payloads', () => {
    expect(extractNumbers(new Uint8Array())).toBeNull()
    expect(extractNumbers(Uint8Array.from([0xff, 0x00, 0x13]))).toBeNull()
  })

  it('flattens JSON objects to dot paths of numbers and booleans', () => {
    const payload = JSON.stringify({
      t: 21.5,
      h: 40,
      on: true,
      name: 'kitchen',
      nested: { a: { b: 1 } },
      arr: [1, 2],
      none: null
    })
    expect(extract(payload)).toEqual({
      t: 21.5,
      h: 40,
      on: 1,
      'nested.a.b': 1,
      'arr.0': 1,
      'arr.1': 2
    })
  })

  it('flattens top-level arrays by index', () => {
    expect(extract('[1, 2, "x", false]')).toEqual({ '0': 1, '1': 2, '3': 0 })
  })

  it('limits the path depth', () => {
    expect(extract('{"a":{"b":{"c":{"d":{"e":1}}}}}')).toEqual({ 'a.b.c.d.e': 1 })
    expect(extract('{"a":{"b":{"c":{"d":{"e":{"f":1}}}}}}')).toBeNull()
  })

  it('limits the number of fields', () => {
    const many = Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`k${i}`, i]))
    const result = extract(JSON.stringify(many))
    expect(Object.keys(result ?? {})).toHaveLength(NUMERIC_LIMITS.maxFields)
    expect(result?.k0).toBe(0)
  })

  it('ignores non-finite numbers and JSON without numbers', () => {
    expect(extract('{"big": 1e400, "ok": 1}')).toEqual({ ok: 1 })
    expect(extract('{"a": "x", "b": [], "c": {}}')).toBeNull()
    expect(extract('{"a": 1')).toBeNull()
  })

  it('keeps keys such as __proto__ as own properties', () => {
    const result = extract('{"__proto__": 5}')
    expect(Object.prototype.hasOwnProperty.call(result, '__proto__')).toBe(true)
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype)
  })

  it('skips payloads above the size limit', () => {
    const big = `[${'1,'.repeat(NUMERIC_LIMITS.maxBytes)}1]`
    expect(extract(big)).toBeNull()
  })
})
