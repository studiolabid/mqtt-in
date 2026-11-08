/**
 * Flattening of a `TopicTree` into display rows (pure, no Vue). Used through
 * `TopicTree.flatten()` / `flattenView()`; split out to keep the tree itself small.
 *
 * Every row carries its position among the siblings shown with it (`posInSet` / `setSize`, for
 * `aria-posinset` / `aria-setsize`): all children of the parent without a search, the matching
 * (visible) children with one.
 */
import type { TopicNode } from './topic-node'
import type { TopicTree } from './topic-tree'

/** One visible line of the flattened tree. */
export interface TopicRow {
  node: TopicNode
  depth: number
  hasChildren: boolean
  expanded: boolean
  /** 1-based index among the siblings shown with this row. */
  posInSet: number
  /** Number of siblings shown with this row (this row included). */
  setSize: number
}

/** Rows plus the number of topics matching the search. */
export interface TopicTreeView {
  rows: TopicRow[]
  /**
   * Topics with messages whose topic contains the search term; `topicCount` of the tree when
   * there is no search.
   */
  matchCount: number
}

/** Depth-first stack of nodes with their sibling position (parallel arrays: no allocations). */
class SiblingStack {
  private readonly nodes: TopicNode[] = []
  private readonly positions: number[] = []
  private readonly sizes: number[] = []
  position = 0
  size = 0

  /** Pushes `siblings` so that they pop in order. */
  pushAll(siblings: readonly TopicNode[]): void {
    for (let i = siblings.length - 1; i >= 0; i--) {
      this.nodes.push(siblings[i])
      this.positions.push(i + 1)
      this.sizes.push(siblings.length)
    }
  }

  /** The next node (its sibling position in `position` / `size`), or undefined when empty. */
  pop(): TopicNode | undefined {
    const node = this.nodes.pop()
    this.position = this.positions.pop() ?? 0
    this.size = this.sizes.pop() ?? 0
    return node
  }
}

/** Rows of the expanded tree: children of nodes whose topic is in `expanded`. */
export function flattenExpanded(tree: TopicTree, expanded: ReadonlySet<string>): TopicRow[] {
  const rows: TopicRow[] = []
  const stack = new SiblingStack()
  stack.pushAll(tree.childrenOf(tree.root))
  for (let node = stack.pop(); node; node = stack.pop()) {
    const hasChildren = node.children.size > 0
    const isExpanded = hasChildren && expanded.has(node.topic)
    rows.push({
      node,
      depth: node.depth,
      hasChildren,
      expanded: isExpanded,
      posInSet: stack.position,
      setSize: stack.size
    })
    if (isExpanded) stack.pushAll(tree.childrenOf(node))
  }
  return rows
}

/**
 * Rows of the nodes whose topic contains `term` (lower case) and their ancestors, ancestors
 * expanded; `matchCount` counts the matching topics that received messages.
 */
export function flattenMatches(tree: TopicTree, term: string): TopicTreeView {
  const included = new Set<TopicNode>()
  const root = tree.root
  let matchCount = 0
  for (const node of tree.nodes()) {
    if (!node.lowerTopic.includes(term)) continue
    if (node.messageCount > 0) matchCount++
    for (
      let current: TopicNode | undefined = node;
      current && current !== root && !included.has(current);
      current = current.parent
    ) {
      included.add(current)
    }
  }

  const rows: TopicRow[] = []
  if (included.size === 0) return { rows, matchCount }
  const visible = (node: TopicNode): boolean => included.has(node)
  const stack = new SiblingStack()
  stack.pushAll(tree.childrenOf(root).filter(visible))
  for (let node = stack.pop(); node; node = stack.pop()) {
    const children = tree.childrenOf(node).filter(visible)
    rows.push({
      node,
      depth: node.depth,
      hasChildren: node.children.size > 0,
      expanded: children.length > 0,
      posInSet: stack.position,
      setSize: stack.size
    })
    stack.pushAll(children)
  }
  return { rows, matchCount }
}
