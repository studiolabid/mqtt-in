/**
 * Nodes of the live topic tree (pure, no Vue): the node shape, its display snapshot and the
 * constants that bound it. Import them from `./topic-tree`, which re-exports this module.
 */
import type { MqttMessage } from '@shared/models'

/**
 * Levels materialized per topic. Deeper topics keep the rest (slashes included) in the node at
 * the last level, which bounds the work and memory a pathological 64 KB topic can cause.
 */
export const MAX_TREE_DEPTH = 64

/** Payload bytes kept of a node's last message once the ring buffer evicted it (64 KiB). */
export const LAST_PAYLOAD_CAP_BYTES = 64 * 1024

export interface TopicNode {
  /**
   * Level name (`''` for an empty level, e.g. the first level of `/a`). At depth
   * `MAX_TREE_DEPTH - 1` it holds the remaining levels of deeper topics.
   */
  name: string
  /** Full topic of this node (levels joined with `/`). */
  topic: string
  /** `topic` in lower case (the topic search), computed once when the node is created. */
  lowerTopic: string
  parent?: TopicNode
  children: Map<string, TopicNode>
  /** Messages received on exactly this topic. */
  messageCount: number
  /** Messages received on this topic and every descendant. */
  totalMessages: number
  /** Distinct topics with at least one message in this subtree, including this node. */
  topicCount: number
  /**
   * Last message received on exactly this topic. After the ring buffer evicted it, a message
   * with a payload over `LAST_PAYLOAD_CAP_BYTES` is replaced by a copy holding only the first
   * `LAST_PAYLOAD_CAP_BYTES` (compare `payload.byteLength` with `lastPayloadBytes`).
   */
  lastMessage?: MqttMessage
  /** Original payload size of `lastMessage`, in bytes (CT-22). */
  lastPayloadBytes: number
  /**
   * The broker (very likely) holds a retained message for this topic: set by a retained message
   * with a payload, cleared by an empty payload (the MQTT way to delete a retained message).
   * Non-retained messages with a payload leave it unchanged.
   */
  retained: boolean
  /** Epoch ms of the newest message in this subtree (0 = never). */
  updatedAt: number
  /** 0 for first-level nodes; the root is -1. */
  depth: number
}

/** Plain copy of a node's display data (a new object, safe to expose through computeds). */
export interface TopicNodeSnapshot {
  name: string
  topic: string
  depth: number
  messageCount: number
  totalMessages: number
  topicCount: number
  /** May hold a 64 KiB copy of the payload: see `TopicNode.lastMessage`. */
  lastMessage?: MqttMessage
  /** Original payload size of `lastMessage`, in bytes. */
  lastPayloadBytes: number
  retained: boolean
  updatedAt: number
  childCount: number
}

/** Copies the display data of a (live, mutated in place) node. */
export function snapshotTopicNode(node: TopicNode): TopicNodeSnapshot {
  return {
    name: node.name,
    topic: node.topic,
    depth: node.depth,
    messageCount: node.messageCount,
    totalMessages: node.totalMessages,
    topicCount: node.topicCount,
    lastMessage: node.lastMessage,
    lastPayloadBytes: node.lastPayloadBytes,
    retained: node.retained,
    updatedAt: node.updatedAt,
    childCount: node.children.size
  }
}

/** A node without messages (the tree links it to its parent). */
export function createNode(
  name: string,
  topic: string,
  lowerTopic: string,
  parent: TopicNode | undefined,
  depth: number
): TopicNode {
  return {
    name,
    topic,
    lowerTopic,
    parent,
    children: new Map(),
    messageCount: 0,
    totalMessages: 0,
    topicCount: 0,
    lastMessage: undefined,
    lastPayloadBytes: 0,
    retained: false,
    updatedAt: 0,
    depth
  }
}
