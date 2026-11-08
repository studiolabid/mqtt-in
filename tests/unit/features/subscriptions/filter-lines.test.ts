import { describe, expect, it } from 'vitest'
import {
  appendLine,
  firstLine,
  insertWildcard,
  lineRange,
  parseFilterLines
} from '@/features/subscriptions/utils/filter-lines'

describe('parseFilterLines (Add multiple)', () => {
  it('reads one trimmed filter per line, ignoring blank lines', () => {
    expect(parseFilterLines('a/#\n\n  b/+/c  \r\n\n', new Set())).toEqual({
      filters: ['a/#', 'b/+/c'],
      existing: [],
      invalid: null
    })
  })

  it('drops repeated lines', () => {
    expect(parseFilterLines('a/#\na/#\n a/# ', new Set()).filters).toEqual(['a/#'])
  })

  it('skips filters the connection already has', () => {
    expect(parseFilterLines('a/#\nb/#', new Set(['a/#']))).toEqual({
      filters: ['b/#'],
      existing: ['a/#'],
      invalid: null
    })
  })

  it('reports the first invalid line with its 1-based number', () => {
    const result = parseFilterLines('ok/#\n\nbad#\nalso/bad#', new Set())
    expect(result.invalid).toEqual({
      line: 3,
      filter: 'bad#',
      error: "'#' must be the last level and occupy the whole level"
    })
    expect(result.filters).toEqual(['ok/#'])
  })

  it('reports a filter with an unpaired surrogate (MQTT-18), like the main process', () => {
    expect(parseFilterLines('ok/😀\nbad/\uD800/#', new Set())).toEqual({
      filters: ['ok/😀'],
      existing: [],
      invalid: {
        line: 2,
        filter: 'bad/\uD800/#',
        error: 'Topic filter contains an unpaired surrogate'
      }
    })
  })

  it('accepts shared subscriptions and $SYS filters', () => {
    expect(parseFilterLines('$share/group/a/#\n$SYS/#', new Set()).filters).toEqual([
      '$share/group/a/#',
      '$SYS/#'
    ])
  })

  it('handles an empty input', () => {
    expect(parseFilterLines('', new Set())).toEqual({ filters: [], existing: [], invalid: null })
  })
})

describe('filter text helpers', () => {
  it('firstLine skips blank lines', () => {
    expect(firstLine('\n  \n  a/b  \nc')).toBe('a/b')
    expect(firstLine('')).toBe('')
  })

  it('lineRange selects a line (CRLF aware)', () => {
    const text = 'one\r\ntwo\nthree'
    expect(lineRange(text, 1)).toEqual([0, 3])
    expect(lineRange(text, 2)).toEqual([5, 8])
    expect(lineRange(text, 3)).toEqual([9, 14])
    expect(lineRange(text, 9)).toEqual([text.length, text.length])
  })

  it('insertWildcard adds separators only where needed', () => {
    expect(insertWildcard('sensors', 7, 7, '#')).toEqual({ value: 'sensors/#', caret: 9 })
    expect(insertWildcard('a//c', 2, 2, '+')).toEqual({ value: 'a/+/c', caret: 3 })
    expect(insertWildcard('ab', 1, 1, '+')).toEqual({ value: 'a/+/b', caret: 3 })
    expect(insertWildcard('a/xyz/c', 2, 5, '+')).toEqual({ value: 'a/+/c', caret: 3 })
  })

  it('appendLine adds a last line and drops trailing blank lines', () => {
    expect(appendLine('a/#\n\n', 'b/#')).toEqual({ value: 'a/#\nb/#', caret: 7 })
    expect(appendLine('', 'b/#')).toEqual({ value: 'b/#', caret: 3 })
  })
})
