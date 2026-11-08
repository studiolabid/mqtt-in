import { describe, expect, it } from 'vitest'
import { PointRing } from '@/utils/point-ring'
import { BARE_NUMBER_FIELD, bareNumber, extractNumbers, numericValue } from '@/utils/numeric'
import { utf8 } from './helpers'

describe('numeric fields of pins', () => {
  it("reads a bare-number payload with the '' field only", () => {
    expect(BARE_NUMBER_FIELD).toBe('')
    expect(bareNumber(utf8(' 23.5 '))).toBe(23.5)
    expect(bareNumber(utf8('TRUE'))).toBe(1)
    expect(bareNumber(utf8('{"value":1}'))).toBeNull()
    expect(bareNumber(utf8('1e999'))).toBeNull()
    expect(bareNumber(new Uint8Array(0))).toBeNull()
    expect(numericValue(utf8('7'), '')).toBe(7)
    expect(numericValue(utf8('{"value":7}'), '')).toBeNull()
  })

  it('reads any other field from extractNumbers (bare numbers are `value` there)', () => {
    expect(extractNumbers(utf8('42'))).toEqual({ value: 42 })
    expect(numericValue(utf8('42'), 'value')).toBe(42)
    expect(numericValue(utf8('{"a":{"b":2}}'), 'a.b')).toBe(2)
    expect(numericValue(utf8('{"a":1}'), 'missing')).toBeNull()
    // Never an inherited property.
    expect(numericValue(utf8('{"a":1}'), 'constructor')).toBeNull()
  })
})

describe('PointRing', () => {
  it('keeps the newest points oldest first and reads back from the newest', () => {
    const ring = new PointRing(3)
    expect(ring.series()).toEqual({
      times: new Float64Array(0),
      values: new Float64Array(0),
      length: 0
    })
    for (let i = 1; i <= 5; i++) ring.push(i * 10, i)
    expect(ring.length).toBe(3)
    const series = ring.series()
    expect(Array.from(series.times)).toEqual([30, 40, 50])
    expect(Array.from(series.values)).toEqual([3, 4, 5])
    expect(ring.at(0)).toEqual({ time: 50, value: 5 })
    expect(ring.at(2)).toEqual({ time: 30, value: 3 })
    expect(ring.at(3)).toBeUndefined()
    ring.clear()
    expect(ring.length).toBe(0)
    expect(ring.at(0)).toBeUndefined()
  })
})
