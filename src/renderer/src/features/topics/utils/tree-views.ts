/**
 * View models of the topic tree that extend the shared ones in `../types` (plain data, built by
 * `TopicTree.vue` for its rows and its context menu).
 */
import type { TopicRow } from '@/utils/topic-tree'
import type { TopicMenuTarget, TopicRowView } from '../types'

/** Display data of one visible tree row, with its sibling position and its pin. */
export interface TreeRowView extends TopicRowView {
  /** 1-based position among the siblings shown with the row (`aria-posinset`). */
  posInSet: number
  /** Siblings shown with the row, itself included (`aria-setsize`). */
  setSize: number
  /** The field a pin of this topic follows; null when its value is not numeric. */
  pinField: string | null
  /** The topic (and `pinField`) is pinned. */
  pinned: boolean
}

/** The row a context menu was opened on, with what its retained actions need. */
export interface TreeMenuTarget extends TopicMenuTarget {
  /** The topic's own last message has a payload (a retained message may exist for it). */
  hasPayload: boolean
  /** Known-retained topics in the subtree, the topic included ('Clear retained below… (N)'). */
  retainedBelow: number
}

/**
 * The display data of a rendered row, read from its live node (counts change in place while
 * the row objects are reused).
 */
export function treeRowView(
  row: TopicRow,
  start: number,
  preview: string,
  pin: { field: string | null; pinned: boolean }
): TreeRowView {
  const { node } = row
  return {
    topic: node.topic,
    name: node.name,
    depth: row.depth,
    start,
    hasChildren: row.hasChildren,
    expanded: row.expanded,
    count: row.hasChildren ? node.totalMessages : node.messageCount,
    topics: node.topicCount,
    retained: node.retained,
    preview,
    updatedAt: node.updatedAt,
    posInSet: row.posInSet,
    setSize: row.setSize,
    pinField: pin.field,
    pinned: pin.pinned
  }
}
