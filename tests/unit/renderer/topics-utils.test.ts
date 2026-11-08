/**
 * Topic explorer helpers (promoted from the feature's own scratch suite during integration).
 */
import { describe, expect, it } from 'vitest'
import type { MqttMessage } from '@shared/models'
import { TopicTree } from '@/utils/topic-tree'
import { foldDiff, lineDiff } from '@/utils/diff'
import { highlightParts } from '@/utils/highlight'
import {
  buildFieldData,
  discoverFields,
  numbersOf,
  scalesDiffer,
  type FieldStats
} from '@/features/topics/utils/chart-data'
import { formatStat } from '@/features/topics/utils/format'
import { freeSlot, MAX_SERIES, seriesColor } from '@/features/topics/utils/palette'
import { ancestorTopics, subtreeFilter, topicLevels } from '@/features/topics/utils/topic-path'
import { indexOfTopic, parentIndex, treeKeyAction } from '@/features/topics/utils/tree-nav'

const enc = new TextEncoder()
let id = 0
function msg(topic: string, payload: string, timestamp = 1000 + id): MqttMessage {
  return {
    id: ++id,
    connectionId: 'c',
    direction: 'in',
    topic,
    payload: enc.encode(payload),
    qos: 0,
    retain: false,
    dup: false,
    timestamp
  }
}

const opts = (pageSize = 5, searching = false): { searching: boolean; pageSize: number } => ({
  searching,
  pageSize
})

describe('palette', () => {
  it('assigns the lowest free slot and caps at 8', () => {
    expect(freeSlot([])).toBe(0)
    expect(freeSlot([0, 2])).toBe(1)
    expect(freeSlot([0, 1, 2, 3, 4, 5, 6, 7])).toBeNull()
    expect(MAX_SERIES).toBe(8)
    expect(seriesColor(0, false)).toBe('#2a78d6')
    expect(seriesColor(0, true)).toBe('#3987e5')
    expect(seriesColor(99, false)).toBe('#e34948')
  })
})

describe('chart data', () => {
  it('discovers fields in first-seen order and builds windowed points', () => {
    const list = [
      msg('t', '{"a":1,"b":{"c":2}}', 1000),
      msg('t', 'hello', 2000),
      msg('t', '{"a":3,"d":true}', 3000)
    ]
    expect(discoverFields(list)).toEqual(['a', 'b.c', 'd'])
    expect(numbersOf(list[1])).toBeNull()
    const all = buildFieldData(list, ['a', 'd', 'toString'], 0)
    expect(all[0].points).toEqual([
      [1000, 1],
      [3000, 3]
    ])
    expect(all[0].stats).toMatchObject({ count: 2, last: 3, min: 1, max: 3, avg: 2 })
    expect(all[1].points).toEqual([[3000, 1]])
    expect(all[2].points).toEqual([])
    expect(all[2].stats.last).toBeNull()
    const recent = buildFieldData(list, ['a'], 2500)
    expect(recent[0].points).toEqual([[3000, 3]])
  })

  it('flags very different scales', () => {
    const s = (min: number, max: number): FieldStats => ({
      count: 2,
      last: max,
      min,
      max,
      avg: (min + max) / 2
    })
    expect(scalesDiffer([s(0, 1), s(1000, 1013)])).toBe(true)
    expect(scalesDiffer([s(20, 25), s(30, 60)])).toBe(false)
    expect(scalesDiffer([s(20, 25)])).toBe(false)
  })
})

describe('topic path', () => {
  it('splits like the tree', () => {
    expect(topicLevels('a/b/c').map((l) => l.topic)).toEqual(['a', 'a/b', 'a/b/c'])
    expect(topicLevels('/x').map((l) => l.name)).toEqual(['', 'x'])
    expect(ancestorTopics('a/b/c')).toEqual(['a', 'a/b'])
    expect(ancestorTopics('a')).toEqual([])
    const deep = Array.from({ length: 70 }, (_, i) => `l${i}`).join('/')
    expect(topicLevels(deep)).toHaveLength(64)
    const tree = new TopicTree()
    tree.add(msg(deep, '1'))
    for (const t of ancestorTopics(deep)) expect(tree.get(t)).toBeDefined()
    expect(tree.get(topicLevels(deep)[63].topic)).toBeDefined()
    expect(subtreeFilter('a/b')).toBe('a/b/#')
    expect(subtreeFilter('')).toBe('/#')
  })

  it('highlights matches', () => {
    expect(highlightParts('Temperature', 'temp')).toEqual([
      { text: 'Temp', match: true },
      { text: 'erature', match: false }
    ])
    expect(highlightParts('abcabc', 'bc')).toEqual([
      { text: 'a', match: false },
      { text: 'bc', match: true },
      { text: 'a', match: false },
      { text: 'bc', match: true }
    ])
    expect(highlightParts('abc', '')).toEqual([{ text: 'abc', match: false }])
  })
})

describe('tree navigation', () => {
  const tree = new TopicTree()
  for (const t of ['a/x', 'a/y/z', 'b']) tree.add(msg(t, '1'))

  it('moves, expands, collapses and goes to parents', () => {
    let rows = tree.flatten(new Set())
    expect(rows.map((r) => r.node.topic)).toEqual(['a', 'b'])
    expect(treeKeyAction('ArrowDown', rows, -1, opts())).toEqual({ kind: 'select', index: 0 })
    expect(treeKeyAction('ArrowUp', rows, -1, opts())).toEqual({ kind: 'select', index: 1 })
    expect(treeKeyAction('ArrowRight', rows, 0, opts())).toEqual({
      kind: 'toggle',
      index: 0,
      expand: true
    })
    expect(treeKeyAction('ArrowRight', rows, 1, opts())).toBeNull()
    rows = tree.flatten(new Set(['a', 'a/y']))
    expect(rows.map((r) => r.node.topic)).toEqual(['a', 'a/x', 'a/y', 'a/y/z', 'b'])
    expect(treeKeyAction('ArrowRight', rows, 0, opts())).toEqual({ kind: 'select', index: 1 })
    expect(treeKeyAction('ArrowLeft', rows, 3, opts())).toEqual({ kind: 'select', index: 2 })
    expect(treeKeyAction('ArrowLeft', rows, 2, opts())).toEqual({
      kind: 'toggle',
      index: 2,
      expand: false
    })
    expect(treeKeyAction('Enter', rows, 4, opts())).toEqual({ kind: 'select', index: 4 })
    expect(treeKeyAction('End', rows, 0, opts())).toEqual({ kind: 'select', index: 4 })
    expect(treeKeyAction('PageDown', rows, 0, opts(2))).toEqual({ kind: 'select', index: 2 })
    expect(treeKeyAction('x', rows, 0, opts())).toBeNull()
    expect(parentIndex(rows, 3)).toBe(2)
    expect(parentIndex(rows, 4)).toBe(-1)
    expect(indexOfTopic(rows, 'a/y/z')).toBe(3)
    expect(indexOfTopic(rows, null)).toBe(-1)
  })

  it('does not toggle while searching', () => {
    const rows = tree.flatten(new Set(), 'z')
    expect(rows.map((r) => r.node.topic)).toEqual(['a', 'a/y', 'a/y/z'])
    expect(treeKeyAction('ArrowLeft', rows, 1, opts(5, true))).toEqual({ kind: 'select', index: 0 })
    expect(treeKeyAction('ArrowRight', rows, 1, opts(5, true))).toEqual({
      kind: 'select',
      index: 2
    })
    expect(treeKeyAction('Enter', rows, 1, opts(5, true))).toEqual({ kind: 'select', index: 1 })
  })
})

describe('diff folding', () => {
  it('keeps context around changes and folds long unchanged runs', () => {
    const before = Array.from({ length: 30 }, (_, i) => `line ${i}`).join('\n')
    const after = before.replace('line 15', 'LINE 15')
    const lines = lineDiff(before, after)
    const blocks = foldDiff(lines)
    expect(blocks.map((b) => b.kind)).toEqual(['fold', 'lines', 'fold'])
    expect(blocks.reduce((n, b) => n + b.lines.length, 0)).toBe(lines.length)
    const shown = blocks[1].lines
    expect(shown.filter((l) => l.kind !== 'unchanged')).toHaveLength(2)
    expect(shown).toHaveLength(8)
    expect(foldDiff(lineDiff('a\nb', 'a\nc')).map((b) => b.kind)).toEqual(['lines'])
    expect(foldDiff([])).toEqual([])
  })
})

describe('format', () => {
  it('formats stats', () => {
    const nf = (digits: number, value: number, compact = false): string =>
      new Intl.NumberFormat(undefined, {
        maximumFractionDigits: digits,
        notation: compact ? 'compact' : 'standard'
      }).format(value)
    expect(formatStat(null)).toBe('—')
    expect(formatStat(23.4567)).toBe(nf(3, 23.4567))
    expect(formatStat(0.012345)).toBe(nf(4, 0.012345))
    expect(formatStat(1234.56)).toBe(nf(1, 1234.56))
    expect(formatStat(2_500_000)).toBe(nf(2, 2_500_000, true))
    expect(formatStat(Number.NaN)).toBe('—')
  })
})
