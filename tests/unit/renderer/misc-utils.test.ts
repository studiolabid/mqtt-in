import { afterEach, describe, expect, it, vi } from 'vitest'
import { reactive, ref } from 'vue'
import type { LogEntry } from '@shared/models'
import { compareNatural } from '@/utils/compare'
import { countLogLevels, filterLogEntries, LOG_LEVELS, logLevelRank } from '@/utils/logs'
import { toPlain } from '@/utils/plain'
import { throttle } from '@/utils/throttle'

describe('compareNatural', () => {
  it('sorts numbers naturally and ignores case', () => {
    expect(['b10', 'B2', 'a', 'b1'].sort(compareNatural)).toEqual(['a', 'b1', 'B2', 'b10'])
  })

  it('is total for strings that only differ in case', () => {
    expect(compareNatural('A', 'a')).toBeLessThan(0)
    expect(compareNatural('a', 'A')).toBeGreaterThan(0)
    expect(compareNatural('a', 'a')).toBe(0)
  })
})

describe('toPlain', () => {
  it('turns reactive proxies into structured-clone friendly data', () => {
    const state = reactive({
      name: 'x',
      nested: { list: [1, { deep: true }] },
      bytes: new Uint8Array([1, 2]),
      when: new Date(5),
      skip: undefined,
      fn: () => 1
    })
    const plain = toPlain(state)
    expect(() => structuredClone(plain)).not.toThrow()
    expect(plain).toEqual({
      name: 'x',
      nested: { list: [1, { deep: true }] },
      bytes: new Uint8Array([1, 2]),
      when: new Date(5)
    })
    expect(plain).not.toHaveProperty('skip')
    expect(plain).not.toHaveProperty('fn')
    expect(plain.bytes).toBe(state.bytes)
    expect(() => structuredClone(state)).toThrow()
  })

  it('copies refs values, maps and sets', () => {
    const value = ref({ map: new Map([['a', { b: 1 }]]), set: new Set([1, 2]) })
    const plain = toPlain(value.value)
    expect(plain.map.get('a')).toEqual({ b: 1 })
    expect(Array.from(plain.set)).toEqual([1, 2])
  })

  it('keeps primitives and top-level functions unchanged', () => {
    const fn = (): number => 1
    expect(toPlain(fn)).toBe(fn)
    expect(toPlain(3)).toBe(3)
    expect(toPlain(null)).toBeNull()
  })

  it('refuses cyclic data', () => {
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    expect(() => toPlain(cyclic)).toThrow(/nested too deeply/)
  })
})

describe('throttle', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('runs the first call synchronously and coalesces calls within the interval', () => {
    vi.useFakeTimers()
    let now = 1_000
    const fn = vi.fn()
    const throttled = throttle(fn, 100, () => now)
    throttled()
    expect(fn).toHaveBeenCalledTimes(1)
    throttled()
    throttled()
    expect(fn).toHaveBeenCalledTimes(1)
    now += 100
    vi.advanceTimersByTime(100)
    expect(fn).toHaveBeenCalledTimes(2)
    now += 500
    throttled()
    expect(fn).toHaveBeenCalledTimes(3)
  })

  it('flushes and cancels a pending call', () => {
    vi.useFakeTimers()
    const now = 0
    const fn = vi.fn()
    const throttled = throttle(fn, 100, () => now)
    throttled()
    throttled()
    throttled.flush()
    expect(fn).toHaveBeenCalledTimes(2)
    throttled.flush()
    expect(fn).toHaveBeenCalledTimes(2)
    throttled()
    throttled.cancel()
    vi.advanceTimersByTime(1_000)
    expect(fn).toHaveBeenCalledTimes(2)
  })
})

describe('log helpers', () => {
  function entry(level: LogEntry['level'], message: string, detail?: string): LogEntry {
    return { id: 1, connectionId: 'c', level, message, detail, timestamp: 0 }
  }
  const entries = [
    entry('debug', 'PUBLISH sent'),
    entry('info', 'Connected'),
    entry('warn', 'Reconnecting', 'ECONNRESET'),
    entry('error', 'Not authorized')
  ]

  it('ranks levels', () => {
    expect(LOG_LEVELS.map(logLevelRank)).toEqual([0, 1, 2, 3])
  })

  it('returns the same array when nothing filters', () => {
    expect(filterLogEntries(entries, {})).toBe(entries)
    expect(filterLogEntries(entries, { levels: [], search: '  ' })).toBe(entries)
  })

  it('filters by levels, minimum level and text (message or detail)', () => {
    expect(filterLogEntries(entries, { levels: ['info', 'error'] }).map((e) => e.level)).toEqual([
      'info',
      'error'
    ])
    expect(filterLogEntries(entries, { minLevel: 'warn' }).map((e) => e.level)).toEqual([
      'warn',
      'error'
    ])
    expect(filterLogEntries(entries, { search: 'econnreset' }).map((e) => e.message)).toEqual([
      'Reconnecting'
    ])
    expect(filterLogEntries(entries, { search: 'CONNECTED' })).toHaveLength(1)
  })

  it('counts entries per level', () => {
    expect(countLogLevels(entries)).toEqual({ debug: 1, info: 1, warn: 1, error: 1 })
    expect(countLogLevels([])).toEqual({ debug: 0, info: 0, warn: 0, error: 0 })
  })
})
