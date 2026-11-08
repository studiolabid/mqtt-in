/**
 * Keyboard navigation of the flattened topic tree (pure). Selection follows the keyboard
 * (single-select tree, WAI-ARIA tree pattern).
 */
import type { TopicRow } from '@/utils/topic-tree'

export type TreeAction =
  { kind: 'select'; index: number } | { kind: 'toggle'; index: number; expand: boolean }

export interface TreeKeyOptions {
  /** Search results are expanded by the search itself: expand / collapse do not apply. */
  searching: boolean
  /** Rows per page for PageUp / PageDown. */
  pageSize: number
}

/** Index of the row of `topic`, or -1. */
export function indexOfTopic(rows: readonly TopicRow[], topic: string | null): number {
  if (topic === null) return -1
  for (let i = 0; i < rows.length; i++) if (rows[i].node.topic === topic) return i
  return -1
}

/** Index of the closest row above `index` that is its parent, or -1 for first-level rows. */
export function parentIndex(rows: readonly TopicRow[], index: number): number {
  const depth = rows[index]?.depth ?? 0
  for (let i = index - 1; i >= 0; i--) if (rows[i].depth < depth) return i
  return -1
}

/**
 * What a key does on the tree: ↑ ↓ Home End PageUp PageDown move, → expands or enters the first
 * child, ← collapses or goes to the parent, Enter / Space toggle a branch (and select).
 *
 * @param current index of the selected row (-1 when the selection is not visible).
 */
export function treeKeyAction(
  key: string,
  rows: readonly TopicRow[],
  current: number,
  options: TreeKeyOptions
): TreeAction | null {
  const last = rows.length - 1
  if (last < 0) return null
  const select = (index: number): TreeAction => ({
    kind: 'select',
    index: Math.min(last, Math.max(0, index))
  })
  const page = Math.max(1, options.pageSize)

  if (current < 0 || current > last) {
    if (key === 'ArrowUp' || key === 'End') return select(last)
    const moves = ['ArrowDown', 'Home', 'PageDown', 'PageUp', 'ArrowRight', 'ArrowLeft']
    return moves.includes(key) ? select(0) : null
  }

  const row = rows[current]
  switch (key) {
    case 'ArrowDown':
      return select(current + 1)
    case 'ArrowUp':
      return select(current - 1)
    case 'Home':
      return select(0)
    case 'End':
      return select(last)
    case 'PageDown':
      return select(current + page)
    case 'PageUp':
      return select(current - page)
    case 'ArrowRight': {
      if (!row.hasChildren) return null
      if (!row.expanded && !options.searching) {
        return { kind: 'toggle', index: current, expand: true }
      }
      const next = rows[current + 1]
      return next && next.depth > row.depth ? select(current + 1) : null
    }
    case 'ArrowLeft': {
      if (row.hasChildren && row.expanded && !options.searching) {
        return { kind: 'toggle', index: current, expand: false }
      }
      const parent = parentIndex(rows, current)
      return parent >= 0 ? select(parent) : null
    }
    case 'Enter':
    case ' ':
      return row.hasChildren && !options.searching
        ? { kind: 'toggle', index: current, expand: !row.expanded }
        : select(current)
    default:
      return null
  }
}
