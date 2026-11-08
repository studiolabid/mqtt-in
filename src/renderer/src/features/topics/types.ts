/**
 * View models internal to the topic explorer.
 */

/** The row a context menu was opened on (plain copy of the node's display data). */
export interface TopicMenuTarget {
  topic: string
  hasChildren: boolean
  expanded: boolean
  retained: boolean
}

/** Display data of one visible tree row (props of `TopicTreeRow`). */
export interface TopicRowView {
  topic: string
  name: string
  depth: number
  start: number
  hasChildren: boolean
  expanded: boolean
  count: number
  topics: number
  retained: boolean
  preview: string
  updatedAt: number
}
