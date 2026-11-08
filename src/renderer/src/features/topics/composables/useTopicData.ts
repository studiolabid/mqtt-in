/**
 * Throttled, pause-aware data of one topic for the detail panel: node snapshot, incoming
 * history and child summaries. Message objects are only ever held in shallow refs.
 */
import type { ShallowRef } from 'vue'
import type { MqttMessage } from '@shared/models'
import { useMessagesStore } from '@/stores/messages'
import type { TopicNode, TopicNodeSnapshot } from '@/utils/topic-tree'
import { useLiveValue } from './useLiveValue'

/**
 * Messages kept per topic for history and charts. History and chart must request the same
 * limit: the store keeps one incremental view per topic and rebuilds it when the limit changes.
 */
export const HISTORY_LIMIT = 2000

const EMPTY: readonly MqttMessage[] = Object.freeze([])

function sameSnapshot(a: TopicNodeSnapshot | undefined, b: TopicNodeSnapshot | undefined): boolean {
  if (a === b) return true
  if (!a || !b) return false
  return (
    a.topic === b.topic &&
    a.lastMessage === b.lastMessage &&
    a.messageCount === b.messageCount &&
    a.totalMessages === b.totalMessages &&
    a.topicCount === b.topicCount &&
    a.retained === b.retained &&
    a.updatedAt === b.updatedAt &&
    a.childCount === b.childCount
  )
}

/** Snapshot of the topic's node (`undefined` when the topic is unknown or `null`). */
export function useTopicSnapshot(
  connectionId: () => string,
  topic: () => string | null
): ShallowRef<TopicNodeSnapshot | undefined> {
  const messages = useMessagesStore()
  return useLiveValue(
    connectionId,
    () => {
      const current = topic()
      return current === null ? undefined : messages.topicNode(connectionId(), current)
    },
    { key: topic, equals: sameSnapshot }
  )
}

function onlyIncoming(list: readonly MqttMessage[]): readonly MqttMessage[] {
  return list.every((message) => message.direction === 'in')
    ? list
    : list.filter((message) => message.direction === 'in')
}

/**
 * Received messages of exactly `topic`, oldest first (at most `HISTORY_LIMIT`). The topic tree
 * only counts received messages, so outgoing ones (echoes of our own publishes) are left out.
 */
export function useTopicHistory(
  connectionId: () => string,
  topic: () => string | null
): ShallowRef<readonly MqttMessage[]> {
  const messages = useMessagesStore()
  let source: readonly MqttMessage[] | null = null
  let incoming: readonly MqttMessage[] = EMPTY
  return useLiveValue(
    connectionId,
    () => {
      const current = topic()
      if (current === null) {
        source = null
        incoming = EMPTY
        return incoming
      }
      const next = messages.topicHistory(connectionId(), current, HISTORY_LIMIT)
      if (next !== source) {
        source = next
        incoming = onlyIncoming(next)
      }
      return incoming
    },
    { key: topic }
  )
}

export type ChildSort = 'recent' | 'busiest'

/** Display data of a child node (a plain copy, never the live node). */
export interface ChildSummary {
  name: string
  topic: string
  hasChildren: boolean
  messageCount: number
  totalMessages: number
  topicCount: number
  updatedAt: number
  retained: boolean
  lastMessage?: MqttMessage
}

export interface TopicChildren {
  /** The first `limit` children in `sort` order. */
  items: ChildSummary[]
  /** All children of the node. */
  total: number
  /** Largest `totalMessages` among all children (for proportional bars). */
  maxMessages: number
}

const NO_CHILDREN: TopicChildren = { items: [], total: 0, maxMessages: 0 }

function summarize(node: TopicNode): ChildSummary {
  return {
    name: node.name,
    topic: node.topic,
    hasChildren: node.children.size > 0,
    messageCount: node.messageCount,
    totalMessages: node.totalMessages,
    topicCount: node.topicCount,
    updatedAt: node.updatedAt,
    retained: node.retained,
    lastMessage: node.lastMessage
  }
}

/** Direct children of a node, most recently active or busiest first. */
export function useTopicChildren(
  connectionId: () => string,
  topic: () => string | null,
  sort: () => ChildSort,
  limit = 100
): ShallowRef<TopicChildren> {
  const messages = useMessagesStore()
  return useLiveValue(
    connectionId,
    () => {
      const current = topic()
      if (current === null) return NO_CHILDREN
      const tree = messages.topicTree(connectionId())
      const node = tree.get(current)
      if (!node || node.children.size === 0) return NO_CHILDREN
      const children = Array.from(node.children.values())
      let maxMessages = 0
      for (const child of children) maxMessages = Math.max(maxMessages, child.totalMessages)
      children.sort(
        sort() === 'busiest'
          ? (a, b) => b.totalMessages - a.totalMessages || b.updatedAt - a.updatedAt
          : (a, b) => b.updatedAt - a.updatedAt || b.totalMessages - a.totalMessages
      )
      return {
        items: children.slice(0, limit).map(summarize),
        total: children.length,
        maxMessages
      }
    },
    { key: () => `${topic()}\u0000${sort()}` }
  )
}
