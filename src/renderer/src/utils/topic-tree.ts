/**
 * Live topic hierarchy built from received messages (pure, no Vue).
 *
 * The tree is mutated in place for speed; views derive rows with `flatten()` / `flattenView()`
 * (see `./topic-tree-rows`) whenever the owning store bumps its revision counter, and can skip
 * that work while `structureVersion` is unchanged (only counts and values changed).
 *
 * Memory: a node keeps its `lastMessage` after the ring buffer evicted it. `releaseEvicted`
 * replaces such a message by a copy with only the first `LAST_PAYLOAD_CAP_BYTES` of a large
 * payload, so evicted multi-megabyte payloads are not pinned by the tree.
 */
import type { MqttMessage } from '@shared/models'
import { compareNatural } from './compare'
import { createNode, LAST_PAYLOAD_CAP_BYTES, MAX_TREE_DEPTH, type TopicNode } from './topic-node'
import {
  flattenExpanded,
  flattenMatches,
  type TopicRow,
  type TopicTreeView
} from './topic-tree-rows'

export type { TopicRow, TopicTreeView } from './topic-tree-rows'
export {
  LAST_PAYLOAD_CAP_BYTES,
  MAX_TREE_DEPTH,
  snapshotTopicNode,
  type TopicNode,
  type TopicNodeSnapshot
} from './topic-node'

const byName = (a: TopicNode, b: TopicNode): number => compareNatural(a.name, b.name)

/** Index at which `child` keeps `list` sorted by name (binary search). */
function insertionIndex(list: readonly TopicNode[], child: TopicNode): number {
  let low = 0
  let high = list.length
  while (low < high) {
    const mid = (low + high) >>> 1
    if (byName(list[mid], child) < 0) low = mid + 1
    else high = mid
  }
  return low
}

export class TopicTree {
  private rootNode: TopicNode = createNode('', '', '', undefined, -1)
  /** Every node by full topic (intermediate levels included). */
  private index = new Map<string, TopicNode>()
  /** Children sorted by name; kept sorted when a child is added (built on first use). */
  private sorted = new WeakMap<TopicNode, TopicNode[]>()
  private version = 0

  /** Synthetic root (depth -1); its children are the first topic levels. */
  get root(): TopicNode {
    return this.rootNode
  }

  /** Distinct topics that received at least one message. */
  get topicCount(): number {
    return this.rootNode.topicCount
  }

  /** Number of nodes, intermediate levels included. */
  get size(): number {
    return this.index.size
  }

  /**
   * Bumps when the rows of a flattened view can change: a node was created, a topic received
   * its first message, or the tree was cleared. Counts, values and retained flags do not bump it.
   */
  get structureVersion(): number {
    return this.version
  }

  /**
   * Records a message. Incoming messages update counts, the last value and the retained flag;
   * outgoing retained messages only update the retained flag of an already known topic
   * (outgoing traffic is not part of the broker's topic view).
   *
   * @returns the node of the message topic, or `undefined` when an outgoing message was ignored.
   */
  add(message: MqttMessage): TopicNode | undefined {
    if (message.direction === 'out') return this.trackOutgoing(message)

    const node = this.ensure(message.topic)
    const isNewTopic = node.messageCount === 0
    if (isNewTopic) this.version++
    node.messageCount++
    node.lastMessage = message
    node.lastPayloadBytes = message.payload.byteLength
    if (message.payload.length === 0) node.retained = false
    else if (message.retain) node.retained = true

    for (let current: TopicNode | undefined = node; current; current = current.parent) {
      current.totalMessages++
      if (isNewTopic) current.topicCount++
      if (message.timestamp > current.updatedAt) current.updatedAt = message.timestamp
    }
    return node
  }

  /**
   * Called with the messages the ring buffer evicted: a node whose `lastMessage` is one of them
   * and whose payload is over `LAST_PAYLOAD_CAP_BYTES` gets a copy with only the first
   * `LAST_PAYLOAD_CAP_BYTES` (a real copy, so the large buffer can be freed).
   *
   * @returns the copies created (the store marks them raw).
   */
  releaseEvicted(messages: readonly MqttMessage[]): MqttMessage[] {
    const copies: MqttMessage[] = []
    for (const message of messages) {
      if (message.direction === 'out' || message.payload.byteLength <= LAST_PAYLOAD_CAP_BYTES) {
        continue
      }
      const node = this.index.get(message.topic)
      if (!node || node.lastMessage !== message) continue
      const copy: MqttMessage = {
        ...message,
        payload: message.payload.slice(0, LAST_PAYLOAD_CAP_BYTES)
      }
      node.lastMessage = copy
      copies.push(copy)
    }
    return copies
  }

  /** Node of an exact topic (intermediate levels included). */
  get(topic: string): TopicNode | undefined {
    return this.index.get(topic)
  }

  /** Every node (intermediate levels included), in creation order. */
  nodes(): IterableIterator<TopicNode> {
    return this.index.values()
  }

  /** Removes every node. */
  clear(): void {
    this.rootNode = createNode('', '', '', undefined, -1)
    this.index = new Map()
    this.sorted = new WeakMap()
    this.version++
  }

  /** Children of a node sorted naturally by name (a live list: do not keep or mutate it). */
  childrenOf(node: TopicNode): readonly TopicNode[] {
    let list = this.sorted.get(node)
    if (!list) {
      list = Array.from(node.children.values()).sort(byName)
      this.sorted.set(node, list)
    }
    return list
  }

  /**
   * Visible rows in display order. Without a search term, children of nodes whose topic is in
   * `expanded` are shown. With a search term (case-insensitive substring of the full topic) the
   * matching nodes and their ancestors are shown, ancestors expanded.
   */
  flatten(expanded: ReadonlySet<string>, search = ''): TopicRow[] {
    return this.flattenView(expanded, search).rows
  }

  /** `flatten()` plus the number of topics matching the search (`topicCount` without one). */
  flattenView(expanded: ReadonlySet<string>, search = ''): TopicTreeView {
    const term = search.trim().toLowerCase()
    if (term) return flattenMatches(this, term)
    return { rows: flattenExpanded(this, expanded), matchCount: this.topicCount }
  }

  /**
   * Known-retained topics in the subtree of `topic` (the topic itself included), in natural
   * order. `[]` for an unknown topic.
   */
  retainedBelow(topic: string): string[] {
    const start = this.index.get(topic)
    if (!start) return []
    const out: string[] = []
    const stack: TopicNode[] = [start]
    for (let node = stack.pop(); node; node = stack.pop()) {
      if (node.retained) out.push(node.topic)
      for (const child of node.children.values()) stack.push(child)
    }
    return out.sort(compareNatural)
  }

  /** Topics that received messages, most recently updated first. */
  topics(limit = Number.POSITIVE_INFINITY): string[] {
    const nodes: TopicNode[] = []
    for (const node of this.index.values()) if (node.messageCount > 0) nodes.push(node)
    nodes.sort((a, b) => (b.lastMessage?.timestamp ?? 0) - (a.lastMessage?.timestamp ?? 0))
    const count = Math.min(nodes.length, Math.max(0, limit))
    const out: string[] = new Array(count)
    for (let i = 0; i < count; i++) out[i] = nodes[i].topic
    return out
  }

  private ensure(topic: string): TopicNode {
    const known = this.index.get(topic)
    if (known) return known

    // One lower-casing per topic; prefixes are slices of it (unless lower-casing changed the
    // length, e.g. 'İ', in which case every prefix is lower-cased on its own).
    const lower = topic.toLowerCase()
    const sameLength = lower.length === topic.length
    let node = this.rootNode
    let start = 0
    for (let depth = 0; ; depth++) {
      const slash = depth < MAX_TREE_DEPTH - 1 ? topic.indexOf('/', start) : -1
      const end = slash === -1 ? topic.length : slash
      const name = topic.slice(start, end)
      let child = node.children.get(name)
      if (!child) {
        // Prefix slices of the topic share its memory (no quadratic string growth).
        const prefix = topic.slice(0, end)
        child = createNode(
          name,
          prefix,
          sameLength ? lower.slice(0, end) : prefix.toLowerCase(),
          node,
          depth
        )
        node.children.set(name, child)
        const siblings = this.sorted.get(node)
        if (siblings) siblings.splice(insertionIndex(siblings, child), 0, child)
        this.index.set(child.topic, child)
        this.version++
      }
      node = child
      if (slash === -1) return node
      start = slash + 1
    }
  }

  private trackOutgoing(message: MqttMessage): TopicNode | undefined {
    if (!message.retain) return undefined
    const node = this.index.get(message.topic)
    if (node) node.retained = message.payload.length > 0
    return node
  }
}
