import { describe, expect, it } from 'vitest'
import { TopicTree, type TopicRow } from '@/utils/topic-tree'
import { message } from './helpers'

function treeWith(...topics: string[]): TopicTree {
  const tree = new TopicTree()
  for (const topic of topics) tree.add(message({ topic }))
  return tree
}

function positions(rows: TopicRow[]): Array<[string, number, number]> {
  return rows.map((row) => [row.node.topic, row.posInSet, row.setSize])
}

describe('TopicTree rows: position info (aria-posinset / aria-setsize)', () => {
  const tree = treeWith('b/1', 'b/2', 'b/3', 'a', 'c')

  it('numbers every row among its siblings', () => {
    expect(positions(tree.flatten(new Set(['b'])))).toEqual([
      ['a', 1, 3],
      ['b', 2, 3],
      ['b/1', 1, 3],
      ['b/2', 2, 3],
      ['b/3', 3, 3],
      ['c', 3, 3]
    ])
  })

  it('counts only the matching siblings while searching', () => {
    expect(positions(tree.flatten(new Set(), 'b/'))).toEqual([
      ['b', 1, 1],
      ['b/1', 1, 3],
      ['b/2', 2, 3],
      ['b/3', 3, 3]
    ])
    expect(positions(tree.flatten(new Set(), '2'))).toEqual([
      ['b', 1, 1],
      ['b/2', 1, 1]
    ])
  })
})

describe('TopicTree.flattenView: match count', () => {
  it('counts the matching topics that received messages', () => {
    // 'home' and 'home/kitchen' are intermediate levels without messages of their own.
    const tree = treeWith('home/kitchen/temp', 'home/kitchen/hum', 'home/garage', 'office')
    const view = tree.flattenView(new Set(), 'KITCHEN')
    expect(view.rows.map((row) => row.node.topic)).toEqual([
      'home',
      'home/kitchen',
      'home/kitchen/hum',
      'home/kitchen/temp'
    ])
    expect(view.matchCount).toBe(2)
    const filtered = view.rows.filter(
      (row) => row.node.messageCount > 0 && row.node.topic.toLowerCase().includes('kitchen')
    )
    expect(view.matchCount).toBe(filtered.length)
    expect(tree.flattenView(new Set(), 'nothing').matchCount).toBe(0)
  })

  it('equals the topic count without a search', () => {
    const tree = treeWith('a/b', 'a/c', 'd')
    expect(tree.flattenView(new Set(), '  ').matchCount).toBe(3)
    expect(tree.flatten(new Set())).toEqual(tree.flattenView(new Set()).rows)
  })

  it('searches the lower-cased topic stored on each node', () => {
    const tree = treeWith('Plant/Line-A/Sensor')
    expect(tree.get('Plant/Line-A')?.lowerTopic).toBe('plant/line-a')
    expect(tree.flattenView(new Set(), 'line-a/sen').matchCount).toBe(1)
    // Lower-casing that changes the length (İ → i̇) still finds the right prefix.
    const turkish = treeWith('İstanbul/a')
    expect(turkish.get('İstanbul')?.lowerTopic).toBe('İstanbul'.toLowerCase())
  })
})

describe('TopicTree.structureVersion', () => {
  it('bumps for new nodes, first messages and clears; not for counts or values', () => {
    const tree = treeWith('a/b')
    const created = tree.structureVersion
    tree.add(message({ topic: 'a/b' }))
    tree.add(message({ topic: 'a/b', retain: true }))
    expect(tree.structureVersion).toBe(created)
    tree.add(message({ topic: 'a' })) // existing node, first message: matches can change
    expect(tree.structureVersion).toBeGreaterThan(created)
    const before = tree.structureVersion
    tree.add(message({ topic: 'a/c' }))
    expect(tree.structureVersion).toBeGreaterThan(before)
    const beforeClear = tree.structureVersion
    tree.clear()
    expect(tree.structureVersion).toBeGreaterThan(beforeClear)
  })

  it('keeps the sorted children in order when children are added later', () => {
    const tree = treeWith('p/10', 'p/2')
    expect(tree.childrenOf(tree.get('p') ?? tree.root).map((n) => n.name)).toEqual(['2', '10'])
    tree.add(message({ topic: 'p/1' }))
    tree.add(message({ topic: 'p/11' }))
    tree.add(message({ topic: 'p/3' }))
    expect(tree.childrenOf(tree.get('p') ?? tree.root).map((n) => n.name)).toEqual([
      '1',
      '2',
      '3',
      '10',
      '11'
    ])
  })
})

describe('TopicTree performance guard', () => {
  it('flattens 20k expanded topics (and searches them) within budget', () => {
    const tree = new TopicTree()
    const expanded = new Set<string>()
    for (let i = 0; i < 20_000; i++) {
      const group = `site/${i % 200}`
      expanded.add('site').add(group)
      tree.add(message({ topic: `${group}/sensor${i}` }))
    }
    // A parent with many children: adding one more must not re-sort them all.
    const many = tree.get('site') ?? tree.root
    tree.childrenOf(many)
    const start = performance.now()
    const rows = tree.flatten(expanded)
    const searched = tree.flattenView(expanded, 'sensor1')
    const elapsed = performance.now() - start
    expect(rows).toHaveLength(1 + 200 + 20_000)
    expect(searched.matchCount).toBe(11_111)
    // ≈ 15–30 ms on a desktop; generous for loaded CI machines.
    expect(elapsed).toBeLessThan(1_500)
  })
})
