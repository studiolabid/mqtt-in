import { describe, expect, it, vi } from 'vitest'
import {
  alignSeries,
  chartStructureKey,
  summarizeSeries
} from '@/components/common/lib/chart/align'
import {
  decimalsOf,
  formatNumberTicks,
  formatReadout,
  formatTimeTick,
  TIME_INCRS
} from '@/components/common/lib/chart/format'
import { minimalChange } from '@/components/common/lib/editor/extensions'
import { holdSharedClock, sharedClock } from '@/components/common/lib/ticker'

describe('alignSeries', () => {
  it('merges independent timestamps with null gaps', () => {
    const data = alignSeries([
      {
        name: 'a',
        color: '#f00',
        points: [
          [1, 10],
          [3, 30]
        ]
      },
      {
        name: 'b',
        color: '#0f0',
        points: [
          [2, 20],
          [3, 31],
          [4, 40]
        ]
      }
    ])
    expect(data).toEqual([
      [1, 2, 3, 4],
      [10, null, 30, null],
      [null, 20, 31, 40]
    ])
  })

  it('drops non-finite values, sorts defensively and keeps the last duplicate', () => {
    const data = alignSeries([
      {
        name: 'a',
        color: '#f00',
        points: [
          [5, 1],
          [2, NaN],
          [1, 7],
          [5, 2],
          [NaN, 3]
        ]
      }
    ])
    expect(data).toEqual([
      [1, 5],
      [7, 2]
    ])
  })

  it('handles no series / empty series', () => {
    expect(alignSeries([])).toEqual([[]])
    expect(alignSeries([{ name: 'a', color: '#f00', points: [] }])).toEqual([[], []])
  })

  it('keys the structure on names, colors and label only', () => {
    const a = [{ name: 'a', color: '#f00', points: [[1, 1]] as Array<[number, number]> }]
    const b = [{ name: 'a', color: '#f00', points: [[2, 2]] as Array<[number, number]> }]
    expect(chartStructureKey(a)).toBe(chartStructureKey(b))
    expect(chartStructureKey(a, 'y')).not.toBe(chartStructureKey(a))
  })

  it('summarizes series', () => {
    const [s] = summarizeSeries([
      {
        name: 'a',
        color: '#f00',
        points: [
          [1, 4],
          [2, NaN],
          [3, -2],
          [4, 9]
        ]
      }
    ])
    expect(s).toEqual({ name: 'a', count: 3, min: -2, max: 9, last: [4, 9] })
  })
})

describe('chart format', () => {
  it('computes decimals without float noise', () => {
    expect(decimalsOf(1)).toBe(0)
    expect(decimalsOf(0.25)).toBe(2)
    expect(decimalsOf(0.1 + 0.2)).toBe(1)
    expect(decimalsOf(2.5e-7)).toBe(8)
  })

  it('formats y ticks with consistent precision and compacts large axes', () => {
    const fmt = new Intl.NumberFormat(undefined, {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1
    })
    expect(formatNumberTicks([0, 0.5, 1, 1.5], 0.5)).toEqual(
      [0, 0.5, 1, 1.5].map((v) => fmt.format(v))
    )
    expect(formatNumberTicks([-0, 2, 4], 2)).toEqual(['0', '2', '4'])
    const compact = formatNumberTicks([10_000, 12_500, 15_000], 2_500)
    expect(compact[1]).toMatch(/12[.,]5\s?K/i)
  })

  it('formats time ticks at second resolution or coarser', () => {
    const t = new Date(2026, 10, 8, 14, 3, 7).getTime()
    expect(formatTimeTick(t, 1000)).toBe('14:03:07')
    expect(formatTimeTick(t, 60_000)).toBe('14:03')
    expect(formatTimeTick(new Date(2026, 10, 8).getTime(), 1000)).not.toMatch(/:/)
    expect(Math.min(...TIME_INCRS)).toBe(1000)
  })

  it('formats readout values', () => {
    expect(formatReadout(null)).toBe('—')
    expect(formatReadout(NaN)).toBe('—')
    expect(formatReadout(0.123456)).toBe(
      new Intl.NumberFormat(undefined, { maximumFractionDigits: 4 }).format(0.1235)
    )
  })
})

describe('minimalChange', () => {
  it('returns null for equal text and a tight range otherwise', () => {
    expect(minimalChange('abc', 'abc')).toBeNull()
    expect(minimalChange('hello world', 'hello brave world')).toEqual({
      from: 6,
      to: 6,
      insert: 'brave '
    })
    expect(minimalChange('aaa', 'aa')).toEqual({ from: 2, to: 3, insert: '' })
    expect(minimalChange('', 'x')).toEqual({ from: 0, to: 0, insert: 'x' })
  })

  it('never splits surrogate pairs', () => {
    const change = minimalChange('a😀', 'a😁')
    expect(change).toEqual({ from: 1, to: 3, insert: '😁' })
  })

  it('produces a change that reconstructs the target', () => {
    const cases: Array<[string, string]> = [
      ['{"a":1}', '{\n  "a": 1\n}'],
      ['xyz', ''],
      ['abcabc', 'abc'],
      ['😀😀', '😀']
    ]
    for (const [before, after] of cases) {
      const c = minimalChange(before, after)
      const applied = c ? before.slice(0, c.from) + c.insert + before.slice(c.to) : before
      expect(applied).toBe(after)
    }
  })
})

describe('shared ticker', () => {
  it('runs one interval while held and refreshes on start', () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(1_000_000)
      const releaseA = holdSharedClock()
      const releaseB = holdSharedClock()
      expect(sharedClock.fast.value).toBe(1_000_000)
      expect(vi.getTimerCount()).toBe(1)
      vi.advanceTimersByTime(1000)
      expect(sharedClock.fast.value).toBe(1_001_000)
      expect(sharedClock.slow.value).toBe(1_000_000)
      vi.advanceTimersByTime(29_000)
      expect(sharedClock.slow.value).toBe(1_030_000)
      releaseA()
      releaseA()
      expect(vi.getTimerCount()).toBe(1)
      releaseB()
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })
})
