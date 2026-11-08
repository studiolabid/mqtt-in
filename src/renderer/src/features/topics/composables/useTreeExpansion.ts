/**
 * Expand / collapse operations on a connection's topic tree (the expanded set lives in the
 * explorer state). Any explicit collapse turns the "small trees open themselves" behavior off.
 */
import { toValue, type MaybeRefOrGetter } from 'vue'
import { useMessagesStore } from '@/stores/messages'
import type { TopicNode } from '@/utils/topic-tree'
import { topicExplorerState, type TopicExplorerState } from './explorer-state'

/** Trees with at most this many topics are expanded automatically (until the user collapses). */
export const AUTO_EXPAND_TOPICS = 24

export interface TreeExpansion {
  setExpanded(topic: string, expand: boolean): void
  toggle(topic: string): void
  /** Expands every branch of the tree. */
  expandAll(): void
  /** Expands a branch and everything below it. */
  expandBranch(topic: string): void
  collapseAll(): void
  /** Expands everything while the tree is small and the user never collapsed anything. */
  autoExpand(topicCount: number): void
}

export function useTreeExpansion(connectionId: MaybeRefOrGetter<string>): TreeExpansion {
  const messages = useMessagesStore()
  const state = (): TopicExplorerState => topicExplorerState(toValue(connectionId))

  /** Calls `visit` for every node with children below `from`. */
  function forEachBranch(from: TopicNode, visit: (node: TopicNode) => void): void {
    const tree = messages.topicTree(toValue(connectionId))
    const stack: TopicNode[] = [from]
    for (let node = stack.pop(); node; node = stack.pop()) {
      for (const child of tree.childrenOf(node)) {
        if (child.children.size === 0) continue
        visit(child)
        stack.push(child)
      }
    }
  }

  function expandAll(): void {
    const expanded = state().expanded
    forEachBranch(messages.topicTree(toValue(connectionId)).root, (node) => {
      if (!expanded.has(node.topic)) expanded.add(node.topic)
    })
  }

  function setExpanded(topic: string, expand: boolean): void {
    const current = state()
    if (expand) current.expanded.add(topic)
    else {
      current.expanded.delete(topic)
      current.autoExpand = false
    }
  }

  return {
    setExpanded,
    toggle: (topic) => setExpanded(topic, !state().expanded.has(topic)),
    expandAll,
    expandBranch(topic) {
      const node = messages.topicTree(toValue(connectionId)).get(topic)
      if (!node) return
      const expanded = state().expanded
      expanded.add(topic)
      forEachBranch(node, (child) => expanded.add(child.topic))
    },
    collapseAll() {
      const current = state()
      current.expanded.clear()
      current.autoExpand = false
    },
    autoExpand(topicCount) {
      if (state().autoExpand && topicCount > 0 && topicCount <= AUTO_EXPAND_TOPICS) expandAll()
    }
  }
}
