import { describe, expect, it } from 'vitest'
import { diffSummary, lineDiff } from '@/utils/diff'

describe('lineDiff', () => {
  it('reports identical texts as unchanged lines', () => {
    expect(lineDiff('a\nb', 'a\nb')).toEqual([
      { kind: 'unchanged', text: 'a' },
      { kind: 'unchanged', text: 'b' }
    ])
  })

  it('reports one entry per changed line', () => {
    expect(lineDiff('a\nb\nc', 'a\nB\nc\nd')).toEqual([
      { kind: 'unchanged', text: 'a' },
      { kind: 'removed', text: 'b' },
      { kind: 'added', text: 'B' },
      { kind: 'unchanged', text: 'c' },
      { kind: 'added', text: 'd' }
    ])
  })

  it('diffs pretty-printed JSON payloads line by line', () => {
    const before = JSON.stringify({ t: 21, h: 40 }, null, 2)
    const after = JSON.stringify({ t: 22, h: 40 }, null, 2)
    const lines = lineDiff(before, after)
    expect(lines.filter((l) => l.kind === 'removed').map((l) => l.text)).toEqual(['  "t": 21,'])
    expect(lines.filter((l) => l.kind === 'added').map((l) => l.text)).toEqual(['  "t": 22,'])
  })

  it('ignores a missing newline at the end and CRLF line breaks', () => {
    expect(lineDiff('a\nb', 'a\nb\n').every((line) => line.kind === 'unchanged')).toBe(true)
    expect(lineDiff('a\r\nb\r\n', 'a\nb\n')).toEqual([
      { kind: 'unchanged', text: 'a' },
      { kind: 'unchanged', text: 'b' }
    ])
  })

  it('handles empty texts', () => {
    expect(lineDiff('', '')).toEqual([])
    expect(lineDiff('', 'x\ny')).toEqual([
      { kind: 'added', text: 'x' },
      { kind: 'added', text: 'y' }
    ])
    expect(lineDiff('x', '')).toEqual([{ kind: 'removed', text: 'x' }])
  })

  it('keeps empty lines', () => {
    expect(lineDiff('a\n\nb', 'a\n\nc')).toEqual([
      { kind: 'unchanged', text: 'a' },
      { kind: 'unchanged', text: '' },
      { kind: 'removed', text: 'b' },
      { kind: 'added', text: 'c' }
    ])
  })
})

describe('diffSummary', () => {
  it('counts added and removed lines', () => {
    expect(diffSummary(lineDiff('a\nb\nc', 'a\nx\ny\nc'))).toEqual({ added: 2, removed: 1 })
    expect(diffSummary([])).toEqual({ added: 0, removed: 0 })
  })
})
