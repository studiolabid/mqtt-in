/**
 * Matches a topic filter against the live topic tree (pure, no Vue): counts the known topics
 * and received messages it covers, walking only the branches the filter can match.
 */
import { stripSharePrefix, topicMatches } from '@shared/topic'
import { MAX_TREE_DEPTH, type TopicNode, type TopicTree } from '@/utils/topic-tree'

export interface FilterMatch {
  /** Distinct known topics (at least one received message) matching the filter. */
  topics: number
  /** Messages received on those topics (since the last clear). */
  messages: number
  /** The first matching topics in natural tree order (at most `sampleLimit`). */
  samples: string[]
}

/**
 * Same semantics as `topicMatches`: `#` also matches the parent level, wildcards at the first
 * level skip `$` topics and shared-subscription prefixes are ignored.
 */
export function matchFilter(tree: TopicTree, filter: string, sampleLimit = 0): FilterMatch {
  const result: FilterMatch = { topics: 0, messages: 0, samples: [] }
  const effective = stripSharePrefix(filter)
  if (effective.length === 0) return result
  const levels = effective.split('/')
  // Sorted children only matter for the samples; counting uses the cheaper insertion order.
  const childrenOf = (node: TopicNode): Iterable<TopicNode> =>
    sampleLimit > 0 ? tree.childrenOf(node) : node.children.values()

  const addExact = (node: TopicNode): void => {
    if (node.messageCount === 0) return
    result.topics += 1
    result.messages += node.messageCount
    if (result.samples.length < sampleLimit) result.samples.push(node.topic)
  }

  const addSubtree = (node: TopicNode): void => {
    result.topics += node.topicCount
    result.messages += node.totalMessages
    if (result.samples.length < sampleLimit) collectSamples(tree, node, result.samples, sampleLimit)
  }

  const walk = (node: TopicNode, index: number): void => {
    const level = levels[index]
    const atRoot = index === 0
    if (level === '#') {
      if (!atRoot) return addSubtree(node)
      for (const child of childrenOf(node)) if (!child.name.startsWith('$')) addSubtree(child)
      return
    }
    if (index >= MAX_TREE_DEPTH - 1) {
      // Deeper topics are folded into leaves at the last tree level: match those one by one.
      for (const child of childrenOf(node)) {
        if (topicMatches(effective, child.topic)) addExact(child)
      }
      return
    }
    const last = index === levels.length - 1
    const visit = (child: TopicNode): void => (last ? addExact(child) : walk(child, index + 1))
    if (level === '+') {
      for (const child of childrenOf(node)) {
        if (!atRoot || !child.name.startsWith('$')) visit(child)
      }
      return
    }
    const child = node.children.get(level)
    if (child) visit(child)
  }

  walk(tree.root, 0)
  return result
}

/** Topics with messages in the subtree of `start` (depth first, natural order). */
function collectSamples(tree: TopicTree, start: TopicNode, out: string[], limit: number): void {
  const stack: TopicNode[] = [start]
  for (let node = stack.pop(); node && out.length < limit; node = stack.pop()) {
    if (node.messageCount > 0) out.push(node.topic)
    const children = tree.childrenOf(node)
    for (let i = children.length - 1; i >= 0; i--) stack.push(children[i])
  }
}
