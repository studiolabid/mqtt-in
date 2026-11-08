import { describe, expect, it } from 'vitest'
import {
  LAST_PAYLOAD_CAP_BYTES,
  MAX_TREE_DEPTH,
  TopicTree,
  type TopicRow
} from '@/utils/topic-tree'
import { message, utf8 } from './helpers'

function topicsOf(rows: TopicRow[]): string[] {
  return rows.map((row) => row.node.topic)
}

function treeWith(...topics: string[]): TopicTree {
  const tree = new TopicTree()
  for (const topic of topics) tree.add(message({ topic }))
  return tree
}

describe('TopicTree.add', () => {
  it('creates one node per level with the full topic', () => {
    const tree = treeWith('home/kitchen/temp')
    expect(tree.get('home')?.name).toBe('home')
    expect(tree.get('home/kitchen')?.topic).toBe('home/kitchen')
    const leaf = tree.get('home/kitchen/temp')
    expect(leaf?.name).toBe('temp')
    expect(leaf?.depth).toBe(2)
    expect(leaf?.parent?.topic).toBe('home/kitchen')
    expect(tree.root.depth).toBe(-1)
    expect(tree.size).toBe(3)
  })

  it('counts exact messages, subtree messages and distinct topics', () => {
    const tree = treeWith('a/b', 'a/b', 'a/c', 'a', 'x')
    const a = tree.get('a')
    expect(a?.messageCount).toBe(1)
    expect(a?.totalMessages).toBe(4)
    expect(a?.topicCount).toBe(3)
    expect(tree.get('a/b')?.messageCount).toBe(2)
    expect(tree.get('a/b')?.topicCount).toBe(1)
    expect(tree.root.totalMessages).toBe(5)
    expect(tree.topicCount).toBe(4)
  })

  it('keeps the last message and the newest timestamp along the path', () => {
    const tree = new TopicTree()
    const first = message({ topic: 'a/b', timestamp: 100 })
    const second = message({ topic: 'a/b', timestamp: 300 })
    tree.add(first)
    tree.add(message({ topic: 'a/c', timestamp: 200 }))
    tree.add(second)
    expect(tree.get('a/b')?.lastMessage).toBe(second)
    expect(tree.get('a')?.updatedAt).toBe(300)
    expect(tree.get('a/c')?.updatedAt).toBe(200)
    // An older message (e.g. a retained one) never moves updatedAt backwards.
    tree.add(message({ topic: 'a/c', timestamp: 50 }))
    expect(tree.get('a/c')?.updatedAt).toBe(200)
  })

  it('handles an empty first level ("/a")', () => {
    const tree = treeWith('/a')
    const empty = tree.get('')
    expect(empty?.name).toBe('')
    expect(empty?.depth).toBe(0)
    expect(tree.get('/a')?.parent).toBe(empty)
    expect(tree.get('/a')?.messageCount).toBe(1)
  })

  it('handles empty inner levels ("a//b") and trailing slashes', () => {
    const tree = treeWith('a//b', 'a/')
    expect(tree.get('a/')?.name).toBe('')
    expect(tree.get('a/')?.messageCount).toBe(1)
    expect(tree.get('a//b')?.parent?.topic).toBe('a/')
    expect(tree.topicCount).toBe(2)
  })

  it('handles $SYS topics like any other level', () => {
    const tree = treeWith('$SYS/broker/uptime', '$SYS/broker/clients/connected')
    expect(tree.get('$SYS')?.topicCount).toBe(2)
    expect(tree.get('$SYS/broker/uptime')?.name).toBe('uptime')
  })

  it('tracks retained messages and clears them with an empty payload', () => {
    const tree = new TopicTree()
    tree.add(message({ topic: 't', retain: true, payload: utf8('on') }))
    expect(tree.get('t')?.retained).toBe(true)
    // A live (non-retained) message does not tell anything about the retained one.
    tree.add(message({ topic: 't', retain: false, payload: utf8('off') }))
    expect(tree.get('t')?.retained).toBe(true)
    // An empty payload deletes the retained message on the broker.
    tree.add(message({ topic: 't', retain: false, payload: new Uint8Array(0) }))
    expect(tree.get('t')?.retained).toBe(false)
    tree.add(message({ topic: 't', retain: true, payload: utf8('again') }))
    tree.add(message({ topic: 't', retain: true, payload: new Uint8Array(0) }))
    expect(tree.get('t')?.retained).toBe(false)
  })

  it('uses outgoing retained messages only to update the retained flag of known topics', () => {
    const tree = treeWith('known')
    expect(tree.add(message({ direction: 'out', topic: 'unknown', retain: true }))).toBeUndefined()
    expect(tree.get('unknown')).toBeUndefined()

    tree.add(message({ direction: 'out', topic: 'known', retain: true, payload: utf8('x') }))
    expect(tree.get('known')?.retained).toBe(true)
    expect(tree.get('known')?.messageCount).toBe(1)
    tree.add(message({ direction: 'out', topic: 'known', retain: true, payload: new Uint8Array() }))
    expect(tree.get('known')?.retained).toBe(false)
    // Non-retained outgoing messages are ignored completely.
    expect(tree.add(message({ direction: 'out', topic: 'known' }))).toBeUndefined()
    expect(tree.root.totalMessages).toBe(1)
  })

  it('caps the depth of pathological topics (rest kept in the last level)', () => {
    const topic = Array.from({ length: 30_000 }, (_, i) => `l${i}`).join('/')
    const tree = treeWith(topic)
    const leaf = tree.get(topic)
    expect(leaf?.depth).toBe(MAX_TREE_DEPTH - 1)
    expect(leaf?.messageCount).toBe(1)
    expect(leaf?.name.startsWith(`l${MAX_TREE_DEPTH - 1}/l${MAX_TREE_DEPTH}/`)).toBe(true)
    expect(tree.size).toBe(MAX_TREE_DEPTH)
    const expanded = new Set<string>()
    for (let node = leaf?.parent; node && node.depth >= 0; node = node.parent) {
      expanded.add(node.topic)
    }
    expect(tree.flatten(expanded)).toHaveLength(MAX_TREE_DEPTH)
    expect(tree.flatten(new Set(), 'l29999')).toHaveLength(MAX_TREE_DEPTH)
  })

  it('keeps topics of exactly MAX_TREE_DEPTH levels level by level', () => {
    const topic = Array.from({ length: MAX_TREE_DEPTH }, (_, i) => `l${i}`).join('/')
    const leaf = treeWith(topic).get(topic)
    expect(leaf?.name).toBe(`l${MAX_TREE_DEPTH - 1}`)
    expect(leaf?.parent?.topic).toBe(topic.slice(0, topic.lastIndexOf('/')))
  })
})

describe('TopicTree.flatten', () => {
  const tree = treeWith('sensor10/x', 'sensor2/x', 'Alpha', 'beta/one', 'beta/two/deep', 'beta/Two')

  it('shows first-level nodes sorted naturally when nothing is expanded', () => {
    expect(topicsOf(tree.flatten(new Set()))).toEqual(['Alpha', 'beta', 'sensor2', 'sensor10'])
  })

  it('reports children and expansion per row', () => {
    const rows = tree.flatten(new Set(['beta']))
    // Natural order is case-insensitive; exact ties put upper case first.
    expect(topicsOf(rows)).toEqual([
      'Alpha',
      'beta',
      'beta/one',
      'beta/Two',
      'beta/two',
      'sensor2',
      'sensor10'
    ])
    const beta = rows[1]
    expect(beta).toMatchObject({ depth: 0, hasChildren: true, expanded: true })
    expect(rows[0]).toMatchObject({ hasChildren: false, expanded: false })
    expect(rows.find((row) => row.node.topic === 'beta/two')).toMatchObject({
      depth: 1,
      hasChildren: true,
      expanded: false
    })
  })

  it('ignores expanded topics whose ancestors are collapsed', () => {
    expect(topicsOf(tree.flatten(new Set(['beta/two'])))).not.toContain('beta/two/deep')
  })

  it('shows matches and their (expanded) ancestors when searching', () => {
    const rows = tree.flatten(new Set(), 'DEEP')
    expect(topicsOf(rows)).toEqual(['beta', 'beta/two', 'beta/two/deep'])
    expect(rows.map((row) => row.expanded)).toEqual([true, true, false])
  })

  it('matches on the full topic path, so descendants of a match are shown', () => {
    expect(topicsOf(tree.flatten(new Set(), 'beta/two'))).toEqual([
      'beta',
      'beta/Two',
      'beta/two',
      'beta/two/deep'
    ])
  })

  it('returns no rows when nothing matches', () => {
    expect(tree.flatten(new Set(), 'nothing-like-this')).toEqual([])
  })

  it('invalidates the sorted children cache when a child is added', () => {
    const local = treeWith('b')
    expect(topicsOf(local.flatten(new Set()))).toEqual(['b'])
    local.add(message({ topic: 'a' }))
    expect(topicsOf(local.flatten(new Set()))).toEqual(['a', 'b'])
  })
})

describe('TopicTree.topics / clear', () => {
  it('lists topics with messages, most recent first, with a limit', () => {
    const tree = new TopicTree()
    tree.add(message({ topic: 'a/old', timestamp: 1 }))
    tree.add(message({ topic: 'a/new', timestamp: 3 }))
    tree.add(message({ topic: 'b', timestamp: 2 }))
    expect(tree.topics()).toEqual(['a/new', 'b', 'a/old'])
    expect(tree.topics(2)).toEqual(['a/new', 'b'])
    expect(tree.topics(0)).toEqual([])
  })

  it('clears every node', () => {
    const tree = treeWith('a/b', 'c')
    tree.clear()
    expect(tree.get('a')).toBeUndefined()
    expect(tree.topicCount).toBe(0)
    expect(tree.root.children.size).toBe(0)
    expect(tree.flatten(new Set())).toEqual([])
    tree.add(message({ topic: 'a/b' }))
    expect(tree.topicCount).toBe(1)
  })
})

describe('TopicTree memory (evicted large payloads)', () => {
  const MIB = 1024 * 1024

  it('replaces an evicted 1 MB lastMessage by a 64 KiB copy and keeps its size', () => {
    const tree = new TopicTree()
    const big = message({ topic: 'cam/frame', payload: new Uint8Array(MIB).fill(7) })
    tree.add(big)
    const node = tree.get('cam/frame')
    expect(node?.lastPayloadBytes).toBe(MIB)

    const copies = tree.releaseEvicted([big])
    expect(copies).toHaveLength(1)
    const copy = node?.lastMessage
    expect(copy).toBe(copies[0])
    expect(copy).not.toBe(big)
    expect(copy?.payload.byteLength).toBe(LAST_PAYLOAD_CAP_BYTES)
    expect(copy?.payload.byteLength).toBe(65_536)
    // A real copy: it does not keep the 1 MB buffer alive.
    expect(copy?.payload.buffer).not.toBe(big.payload.buffer)
    expect(copy?.payload.buffer.byteLength).toBe(65_536)
    expect(copy?.payload[0]).toBe(7)
    expect({ ...copy, payload: undefined }).toEqual({ ...big, payload: undefined })
    expect(node?.lastPayloadBytes).toBe(1_048_576)
  })

  it('keeps small payloads, newer messages and outgoing ones as they are', () => {
    const tree = new TopicTree()
    const small = message({ topic: 's', payload: new Uint8Array(LAST_PAYLOAD_CAP_BYTES) })
    tree.add(small)
    expect(tree.releaseEvicted([small])).toEqual([])
    expect(tree.get('s')?.lastMessage).toBe(small)

    const old = message({ topic: 'b', payload: new Uint8Array(MIB) })
    const newer = message({ topic: 'b', payload: new Uint8Array(MIB) })
    tree.add(old)
    tree.add(newer)
    expect(tree.releaseEvicted([old])).toEqual([])
    expect(tree.get('b')?.lastMessage).toBe(newer)

    const out = message({ topic: 'b', direction: 'out', payload: new Uint8Array(MIB) })
    expect(tree.releaseEvicted([out])).toEqual([])
    expect(tree.get('b')?.lastPayloadBytes).toBe(MIB)
  })

  it('records the payload size of every message', () => {
    const tree = new TopicTree()
    tree.add(message({ topic: 't', payload: utf8('12345') }))
    expect(tree.get('t')?.lastPayloadBytes).toBe(5)
    tree.add(message({ topic: 't', payload: new Uint8Array(0) }))
    expect(tree.get('t')?.lastPayloadBytes).toBe(0)
  })
})

describe('TopicTree.retainedBelow', () => {
  function retainedTree(): TopicTree {
    const tree = new TopicTree()
    tree.add(message({ topic: 'a/b/c', retain: true, payload: utf8('1') }))
    // An empty retained payload deletes the retained message: not retained.
    tree.add(message({ topic: 'a/b/d', retain: true, payload: new Uint8Array(0) }))
    tree.add(message({ topic: 'a/x', retain: true, payload: utf8('2') }))
    tree.add(message({ topic: 'a/live', payload: utf8('3') }))
    tree.add(message({ topic: 'z', retain: true, payload: utf8('4') }))
    return tree
  }

  it('lists the known-retained topics of a subtree, sorted', () => {
    const tree = retainedTree()
    expect(tree.retainedBelow('a')).toEqual(['a/b/c', 'a/x'])
    expect(tree.retainedBelow('a/b')).toEqual(['a/b/c'])
  })

  it('includes the topic itself and returns [] for an unknown topic', () => {
    const tree = retainedTree()
    expect(tree.retainedBelow('a/x')).toEqual(['a/x'])
    expect(tree.retainedBelow('nope')).toEqual([])
    expect(tree.retainedBelow('a/live')).toEqual([])
  })

  it('follows outgoing clears of retained messages', () => {
    const tree = retainedTree()
    tree.add(message({ topic: 'a/x', direction: 'out', retain: true, payload: new Uint8Array(0) }))
    expect(tree.retainedBelow('a')).toEqual(['a/b/c'])
  })
})
