/**
 * Helpers promoted to the renderer core during integration: search highlighting, diff folding
 * and line numbers, localStorage preferences, counted nouns.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { diffLineNumbers, foldDiff, lineDiff, type DiffLine } from '@/utils/diff'
import { formatCount } from '@/utils/format'
import { containsTerm, highlightParts, matchRanges } from '@/utils/highlight'
import { finiteOr, isRecord, readPreference, writePreference } from '@/utils/preferences'

const marked = (parts: Array<{ text: string; match: boolean }>): string =>
  parts.map((part) => (part.match ? `[${part.text}]` : part.text)).join('')

describe('highlight', () => {
  it('marks every case-insensitive occurrence of a trimmed term', () => {
    expect(marked(highlightParts('Sensor/temp/sensor', ' SENSOR '))).toBe('[Sensor]/temp/[sensor]')
    expect(marked(highlightParts('aaaa', 'aa'))).toBe('[aa][aa]')
    expect(highlightParts('abc', '')).toEqual([{ text: 'abc', match: false }])
  })

  it('merges overlapping matches of several terms', () => {
    expect(matchRanges('emqx wss broker', ['wss', 'ss b', 'emqx'])).toEqual([
      [0, 4],
      [5, 10]
    ])
    expect(marked(highlightParts('emqx wss broker', ['wss', 'ss b']))).toBe('emqx [wss b]roker')
  })

  it('stops marking after maxMarks', () => {
    expect(marked(highlightParts('a-a-a-a', 'a', 2))).toBe('[a]-[a]-a-a')
  })

  it('marks nothing when lower-casing changes the length', () => {
    // 'İ' lower-cases to two code units: the marks would be misaligned.
    expect(matchRanges('İstanbul', 'stan')).toEqual([])
  })

  it('tells whether a term occurs', () => {
    expect(containsTerm('Connected (session present)', ' SESSION ')).toBe(true)
    expect(containsTerm('anything', '   ')).toBe(false)
  })
})

describe('diff folding', () => {
  const lines = (spec: string): DiffLine[] =>
    spec.split('').map((c, i) => ({
      kind: c === '+' ? 'added' : c === '-' ? 'removed' : 'unchanged',
      text: `line ${i}`
    }))

  it('folds long unchanged runs away from changes, keeping context', () => {
    const blocks = foldDiff(lines('..........+..........'), { context: 2, minFold: 3 })
    expect(blocks.map((b) => [b.kind, b.key, b.lines.length])).toEqual([
      ['fold', 0, 8],
      ['lines', 8, 5],
      ['fold', 13, 8]
    ])
  })

  it('keeps short unchanged runs visible', () => {
    const blocks = foldDiff(lines('..+..'), { context: 0, minFold: 3 })
    expect(blocks).toHaveLength(1)
    expect(blocks[0]).toMatchObject({ kind: 'lines', key: 0 })
  })

  it('numbers removed lines in the old text and the others in the new one', () => {
    const diff = lineDiff('a\nb\nc', 'a\nB\nc\nd')
    expect(diff.map((line) => line.kind)).toEqual([
      'unchanged',
      'removed',
      'added',
      'unchanged',
      'added'
    ])
    expect([...diffLineNumbers(diff)]).toEqual([1, 2, 2, 3, 4])
  })
})

describe('preferences', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('round-trips JSON values through localStorage', () => {
    const data = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => void data.set(key, value)
    })
    writePreference('k', { width: 300 })
    expect(readPreference('k')).toEqual({ width: 300 })
    expect(readPreference('missing')).toBeUndefined()
    data.set('broken', '{nope')
    expect(readPreference('broken')).toBeUndefined()
  })

  it('never throws when storage is unavailable', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('quota')
      }
    })
    expect(() => writePreference('k', 1)).not.toThrow()
    expect(readPreference('k')).toBeUndefined()
  })

  it('narrows stored values', () => {
    expect(isRecord({ a: 1 })).toBe(true)
    expect(isRecord([1])).toBe(false)
    expect(isRecord(null)).toBe(false)
    expect(finiteOr(12, 3)).toBe(12)
    expect(finiteOr(Number.NaN, 3)).toBe(3)
    expect(finiteOr('12', 3)).toBe(3)
  })
})

describe('formatCount', () => {
  it('pluralizes and groups the count', () => {
    expect(formatCount(1, 'message')).toBe('1 message')
    expect(formatCount(0, 'message')).toBe('0 messages')
    expect(formatCount(1234, 'connection')).toMatch(/^1.?234 connections$/)
  })
})
